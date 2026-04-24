// Pure-JS camera calibration — Zhang's method
// Assumes: square pixels (fx=fy), centered principal point (cx=W/2, cy=H/2),
// no lens distortion, no skew.

// ── Linear algebra ────────────────────────────────────────────────────────────

function zeros(m, n) {
  return Array.from({ length: m }, () => new Array(n).fill(0));
}

function transpose(A) {
  const m = A.length, n = A[0].length;
  const B = zeros(n, m);
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++)
      B[j][i] = A[i][j];
  return B;
}

function matMul(A, B) {
  const m = A.length, p = B.length, n = B[0].length;
  const C = zeros(m, n);
  for (let i = 0; i < m; i++)
    for (let k = 0; k < p; k++) {
      if (A[i][k] === 0) continue;
      for (let j = 0; j < n; j++)
        C[i][j] += A[i][k] * B[k][j];
    }
  return C;
}

function matMulVec(A, v) {
  return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
}

// Gaussian elimination with partial pivoting — solves Ax = b
function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-14) continue;

    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / pivot;
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i] || 1;
  }
  return x;
}

function cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}

function vecNorm(v) { return Math.hypot(...v); }

// ── Hartley normalization ─────────────────────────────────────────────────────

function normalizePoints(pts) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const meanDist = pts.reduce((s, p) => s + Math.hypot(p[0]-mx, p[1]-my), 0) / n || 1;
  const s = Math.SQRT2 / meanDist;
  const T = [[s, 0, -s*mx], [0, s, -s*my], [0, 0, 1]];
  return [pts.map(([x, y]) => [s*(x-mx), s*(y-my)]), T];
}

function invertSimilarity(T) {
  const s = T[0][0], tx = T[0][2], ty = T[1][2];
  return [[1/s, 0, -tx/s], [0, 1/s, -ty/s], [0, 0, 1]];
}

// ── Homography via normalized DLT ─────────────────────────────────────────────

function computeHomography(srcPts, dstPts) {
  const [srcN, Ts] = normalizePoints(srcPts);
  const [dstN, Td] = normalizePoints(dstPts);
  const n = srcN.length;

  // Build 2n×8 system (h9 = 1 fixed)
  const A = [], bv = [];
  for (let i = 0; i < n; i++) {
    const [X, Y] = srcN[i];
    const [u, v] = dstN[i];
    A.push([X, Y, 1, 0, 0, 0, -u*X, -u*Y]); bv.push(u);
    A.push([0, 0, 0, X, Y, 1, -v*X, -v*Y]); bv.push(v);
  }

  const At  = transpose(A);
  const h   = solveLinear(matMul(At, A), matMulVec(At, bv));
  const Hn  = [[h[0],h[1],h[2]], [h[3],h[4],h[5]], [h[6],h[7],1]];

  // Denormalize: H = Td^{-1} · Hn · Ts
  return matMul(matMul(invertSimilarity(Td), Hn), Ts);
}

// ── Focal length from homographies (Zhang's constraints) ──────────────────────

function estimateFocalLength(Hs, cx, cy) {
  const f2s = [];
  for (const H of Hs) {
    const h1 = [H[0][0], H[1][0], H[2][0]];
    const h2 = [H[0][1], H[1][1], H[2][1]];

    // Centre-shift: p = h - [cx,cy,0]*hz
    const p1 = [h1[0] - cx*h1[2], h1[1] - cy*h1[2], h1[2]];
    const p2 = [h2[0] - cx*h2[2], h2[1] - cy*h2[2], h2[2]];

    // Orthogonality:  (p1x·p2x + p1y·p2y)/f² + p1z·p2z = 0
    const n1 = -(p1[0]*p2[0] + p1[1]*p2[1]);
    const d1 = p1[2]*p2[2];
    if (d1 !== 0 && n1/d1 > 0) f2s.push(n1/d1);

    // Equal norms: (|p1xy|²-|p2xy|²)/f² + p1z²-p2z² = 0
    const n2 = -(p1[0]**2 + p1[1]**2 - p2[0]**2 - p2[1]**2);
    const d2 = p1[2]**2 - p2[2]**2;
    if (d2 !== 0 && n2/d2 > 0) f2s.push(n2/d2);
  }
  if (f2s.length === 0) return NaN;
  f2s.sort((a, b) => a - b);
  return Math.sqrt(f2s[Math.floor(f2s.length / 2)]);
}

// ── Pose recovery from H and K ────────────────────────────────────────────────

function extractRT(H, f, cx, cy) {
  const kinv = ([hx, hy, hz]) => [(hx - cx*hz)/f, (hy - cy*hz)/f, hz];

  const r1raw = kinv([H[0][0], H[1][0], H[2][0]]);
  const scale = vecNorm(r1raw);
  const r1 = r1raw.map(v => v/scale);
  const r2 = kinv([H[0][1], H[1][1], H[2][1]]).map(v => v/scale);
  const r3 = cross(r1, r2);
  const t  = kinv([H[0][2], H[1][2], H[2][2]]).map(v => v/scale);

  return {
    R: [[r1[0],r2[0],r3[0]], [r1[1],r2[1],r3[1]], [r1[2],r2[2],r3[2]]],
    t,
  };
}

// ── Project board points to image plane ───────────────────────────────────────

function projectPts(objPts, R, t, f, cx, cy) {
  return objPts.map(([X, Y]) => {
    const Xc = R[0][0]*X + R[0][1]*Y + t[0];
    const Yc = R[1][0]*X + R[1][1]*Y + t[1];
    const Zc = R[2][0]*X + R[2][1]*Y + t[2];
    return [f*Xc/Zc + cx, f*Yc/Zc + cy];
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function calibrateCamera({ snapshots, boardCols, boardRows, squareSize, feedW, feedH }) {
  const cx = feedW / 2, cy = feedH / 2;
  const N = boardCols * boardRows;

  const objPts = [];
  for (let r = 0; r < boardRows; r++)
    for (let c = 0; c < boardCols; c++)
      objPts.push([c * squareSize, r * squareSize]);

  const imgPtsAll = snapshots.map(s => {
    const pts = [];
    for (let i = 0; i < s.imgPts.length / 2; i++)
      pts.push([s.imgPts[i*2], s.imgPts[i*2+1]]);
    return pts;
  });

  const Hs = imgPtsAll.map(imgPts => computeHomography(objPts, imgPts));
  const f  = estimateFocalLength(Hs, cx, cy);

  if (!isFinite(f) || f <= 0) {
    throw new Error('Focal length estimation failed — try different view angles');
  }

  let totalSqErr = 0;
  let reprojected = [], lastImgPts = [];

  for (let s = 0; s < snapshots.length; s++) {
    const { R, t } = extractRT(Hs[s], f, cx, cy);
    const reproj   = projectPts(objPts, R, t, f, cx, cy);

    for (let i = 0; i < N; i++) {
      const dx = reproj[i][0] - imgPtsAll[s][i][0];
      const dy = reproj[i][1] - imgPtsAll[s][i][1];
      totalSqErr += dx*dx + dy*dy;
    }

    if (s === snapshots.length - 1) {
      reprojected = reproj;
      lastImgPts  = imgPtsAll[s].flat();
    }
  }

  const rms = Math.sqrt(totalSqErr / (snapshots.length * N));

  return { rms, fx: f, fy: f, cx, cy, dist: [0, 0, 0, 0], reprojected, lastImgPts };
}
