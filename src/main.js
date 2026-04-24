import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';

// ── Board geometry constants ──────────────────────────────────────────────────
const BOARD_COLS = 9;    // inner corners (horizontal)
const BOARD_ROWS = 6;    // inner corners (vertical)
const SQUARE = 0.03;     // 30 mm per square (meters)
const TOT_COLS = BOARD_COLS + 1;
const TOT_ROWS = BOARD_ROWS + 1;
const BOARD_W = TOT_COLS * SQUARE;
const BOARD_D = TOT_ROWS * SQUARE;

// ── Feed resolution ───────────────────────────────────────────────────────────
const FEED_W = 640;
const FEED_H = 480;

// ── Renderers ─────────────────────────────────────────────────────────────────
const mainCanvas = document.getElementById('main');
const mainRenderer = new THREE.WebGLRenderer({ canvas: mainCanvas, antialias: true });
mainRenderer.setPixelRatio(window.devicePixelRatio);
mainRenderer.shadowMap.enabled = true;

const feedCanvas = document.getElementById('feed');
const feedRenderer = new THREE.WebGLRenderer({ canvas: feedCanvas, antialias: true });
feedRenderer.setSize(FEED_W, FEED_H);
feedRenderer.shadowMap.enabled = true;

const overlayCanvas = document.getElementById('overlay');
const ctx2d = overlayCanvas.getContext('2d');

// ── Scene ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2E3440);

// Lighting
const sunLight = new THREE.DirectionalLight(0xECEFF4, 2.5);
sunLight.position.set(0.3, 0.8, 0.5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x81A1C1, 0.8));

// Reference grid
const grid = new THREE.GridHelper(1, 30, 0x434C5E, 0x3B4252);
grid.position.y = -0.001;
scene.add(grid);

// Axes helper
scene.add(new THREE.AxesHelper(0.05));

// ── Chessboard ────────────────────────────────────────────────────────────────
const boardGroup = new THREE.Group();
const matWhite = new THREE.MeshLambertMaterial({ color: 0xECEFF4 });
const matBlack = new THREE.MeshLambertMaterial({ color: 0x2E3440 });
const sqGeo = new THREE.PlaneGeometry(SQUARE, SQUARE);

for (let r = 0; r < TOT_ROWS; r++) {
  for (let c = 0; c < TOT_COLS; c++) {
    const mesh = new THREE.Mesh(sqGeo, (r + c) % 2 === 0 ? matWhite : matBlack);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    mesh.position.set(
      c * SQUARE - BOARD_W / 2 + SQUARE / 2,
      0,
      r * SQUARE - BOARD_D / 2 + SQUARE / 2
    );
    boardGroup.add(mesh);
  }
}

// Thin border frame
const frameMat = new THREE.MeshLambertMaterial({ color: 0xD08770 });
const frameGeo = new THREE.BoxGeometry(BOARD_W + 0.004, 0.001, BOARD_D + 0.004);
boardGroup.add(new THREE.Mesh(frameGeo, frameMat));

scene.add(boardGroup);

// ── Inner corner positions (Three.js world space) ─────────────────────────────
// Row-major order: row 0..BOARD_ROWS-1, col 0..BOARD_COLS-1
const corners3D = [];
for (let r = 0; r < BOARD_ROWS; r++) {
  for (let c = 0; c < BOARD_COLS; c++) {
    corners3D.push(new THREE.Vector3(
      c * SQUARE - BOARD_W / 2 + SQUARE,   // skip first square, land on inner corner
      0,
      r * SQUARE - BOARD_D / 2 + SQUARE
    ));
  }
}

// Board-frame object points for OpenCV (Z=0 plane, row-major)
const objPtsFlat = [];
for (let r = 0; r < BOARD_ROWS; r++) {
  for (let c = 0; c < BOARD_COLS; c++) {
    objPtsFlat.push(c * SQUARE, r * SQUARE, 0);
  }
}

// Corner dot indicators in main view
const dotGeo = new THREE.SphereGeometry(0.0018, 8, 8);
const dotMat = new THREE.MeshBasicMaterial({ color: 0xEBCB8B });
const cornerDots = corners3D.map(p => {
  const d = new THREE.Mesh(dotGeo, dotMat);
  d.position.copy(p);
  scene.add(d);
  return d;
});

// ── Virtual camera (the calibration camera being simulated) ───────────────────
const virtualCam = new THREE.PerspectiveCamera(60, FEED_W / FEED_H, 0.005, 50);

// Camera body (hidden during feed render)
const bodyMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.042, 0.028, 0.060),
  new THREE.MeshLambertMaterial({ color: 0x88C0D0 })
);
const lensMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.010, 0.012, 0.020, 16),
  new THREE.MeshLambertMaterial({ color: 0x4C566A })
);
lensMesh.rotation.x = Math.PI / 2;
lensMesh.position.z = -0.040;
virtualCam.add(bodyMesh, lensMesh);
scene.add(virtualCam);

const camHelper = new THREE.CameraHelper(virtualCam);
scene.add(camHelper);

// ── Navigation camera + OrbitControls ─────────────────────────────────────────
const mainCam = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
mainCam.position.set(0.05, 0.42, 0.60);
mainCam.lookAt(0, 0, 0);

const orbit = new OrbitControls(mainCam, mainCanvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.07;
orbit.target.set(0, 0, 0);

// ── Reprojection error lines (shown in main 3D view) ──────────────────────────
const errorLines = new THREE.Group();
scene.add(errorLines);

// ── Project corners → 2D pixel coords ────────────────────────────────────────
function projectCorners() {
  const v = new THREE.Vector3();
  return corners3D.map(p => {
    v.copy(p).project(virtualCam);
    return {
      x: (v.x + 1) * 0.5 * FEED_W,
      y: (1 - v.y) * 0.5 * FEED_H,
      // z > 1 means behind camera
      visible: v.z < 1,
    };
  });
}

function allInFrame(pts) {
  return pts.every(({ x, y, visible }) =>
    visible && x >= 0 && x <= FEED_W && y >= 0 && y <= FEED_H
  );
}

// ── 2D overlay drawing ────────────────────────────────────────────────────────
function clearOverlay() {
  ctx2d.clearRect(0, 0, FEED_W, FEED_H);
}

function drawLiveCorners(pts) {
  clearOverlay();
  const ok = allInFrame(pts);

  // border indicator
  ctx2d.strokeStyle = ok ? '#A3BE8C' : '#BF616A';
  ctx2d.lineWidth = 3;
  ctx2d.strokeRect(1.5, 1.5, FEED_W - 3, FEED_H - 3);

  for (const { x, y, visible } of pts) {
    ctx2d.beginPath();
    ctx2d.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx2d.fillStyle = (visible && ok) ? '#EBCB8B' : '#BF616A66';
    ctx2d.fill();
    if (visible && ok) {
      ctx2d.strokeStyle = '#D08770';
      ctx2d.lineWidth = 1.2;
      ctx2d.stroke();
    }
  }

  // snapshot count badge
  ctx2d.fillStyle = '#3B4252CC';
  ctx2d.fillRect(4, 4, 130, 20);
  ctx2d.fillStyle = '#88C0D0';
  ctx2d.font = '11px monospace';
  ctx2d.fillText(`snapshots: ${snapshots.length}  ${ok ? '✓ ready' : '✗ out of frame'}`, 8, 18);
}

function drawReprojectionOverlay(measured, reprojected) {
  clearOverlay();
  for (let i = 0; i < measured.length; i++) {
    const m = measured[i];
    const r = reprojected[i];
    // error line
    ctx2d.beginPath();
    ctx2d.moveTo(m.x, m.y);
    ctx2d.lineTo(r.x, r.y);
    ctx2d.strokeStyle = '#D0877099';
    ctx2d.lineWidth = 1;
    ctx2d.stroke();
    // measured dot (yellow)
    ctx2d.beginPath();
    ctx2d.arc(m.x, m.y, 4, 0, Math.PI * 2);
    ctx2d.fillStyle = '#EBCB8B';
    ctx2d.fill();
    // reprojected dot (red)
    ctx2d.beginPath();
    ctx2d.arc(r.x, r.y, 3, 0, Math.PI * 2);
    ctx2d.fillStyle = '#BF616A';
    ctx2d.fill();
  }
  ctx2d.fillStyle = '#3B4252CC';
  ctx2d.fillRect(4, 4, 200, 20);
  ctx2d.fillStyle = '#A3BE8C';
  ctx2d.font = '11px monospace';
  ctx2d.fillText('yellow=measured  red=reprojected', 8, 18);
}

// ── Gaussian noise (Box-Muller) ───────────────────────────────────────────────
function randGaussian(sigma) {
  if (sigma <= 0) return 0;
  const u1 = Math.max(1e-12, Math.random());
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
}

// ── Snapshot store ────────────────────────────────────────────────────────────
const snapshots = [];   // [{ imgPts: Float32Array, camState }]

// ── State ─────────────────────────────────────────────────────────────────────
let liveOverlay = true;

// ── UI elements ───────────────────────────────────────────────────────────────
const snapStatusEl = document.getElementById('snap-status');
const resultEl = document.getElementById('result');

function setStatus(msg) {
  snapStatusEl.textContent = `快照：${snapshots.length} 張 | ${msg}`;
}

// ── Virtual camera sync ───────────────────────────────────────────────────────
const params = {
  camX: 0.00, camY: 0.18, camZ: 0.28,
  rotX: -32,  rotY: 0,   rotZ: 0,
  fov: 60,
  noise: 0.5,
};

function syncCam() {
  virtualCam.position.set(params.camX, params.camY, params.camZ);
  virtualCam.rotation.order = 'XYZ';
  virtualCam.rotation.set(
    THREE.MathUtils.degToRad(params.rotX),
    THREE.MathUtils.degToRad(params.rotY),
    THREE.MathUtils.degToRad(params.rotZ),
  );
  virtualCam.fov = params.fov;
  virtualCam.aspect = FEED_W / FEED_H;
  virtualCam.updateProjectionMatrix();
  camHelper.update();
  liveOverlay = true;   // return to live corner mode when camera moves
}
syncCam();

// ── Take snapshot ─────────────────────────────────────────────────────────────
function takeSnapshot() {
  const pts = projectCorners();
  if (!allInFrame(pts)) {
    setStatus('快照失敗：角點不在畫面內');
    return;
  }
  const imgPts = new Float32Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    imgPts[i * 2]     = pts[i].x + randGaussian(params.noise);
    imgPts[i * 2 + 1] = pts[i].y + randGaussian(params.noise);
  }
  snapshots.push({
    imgPts,
    camState: { pos: virtualCam.position.clone(), rot: virtualCam.rotation.clone() },
  });
  liveOverlay = true;
  setStatus(`快照 #${snapshots.length} 已擷取`);
}

// ── OpenCV calibration ────────────────────────────────────────────────────────
function calibrate() {
  if (snapshots.length < 3) {
    setStatus('至少需要 3 張快照');
    return;
  }
  if (typeof cv === 'undefined' || !cv.calibrateCamera) {
    setStatus('OpenCV.js 尚未就緒，請稍候');
    return;
  }

  const N = BOARD_COLS * BOARD_ROWS;
  const objMats = [];
  const imgMats = [];
  const objVec = new cv.MatVector();
  const imgVec = new cv.MatVector();

  for (const snap of snapshots) {
    const om = cv.matFromArray(N, 1, cv.CV_32FC3, objPtsFlat);
    const im = cv.matFromArray(N, 1, cv.CV_32FC2, Array.from(snap.imgPts));
    objMats.push(om);
    imgMats.push(im);
    objVec.push_back(om);
    imgVec.push_back(im);
  }

  const K    = new cv.Mat();
  const dist = new cv.Mat();
  const rvecs = new cv.MatVector();
  const tvecs = new cv.MatVector();

  try {
    const rms = cv.calibrateCamera(
      objVec, imgVec,
      new cv.Size(FEED_W, FEED_H),
      K, dist, rvecs, tvecs
    );

    const kd = K.data64F;
    const dd = dist.data64F;
    const fx = kd[0], fy = kd[4], cx = kd[2], cy = kd[5];

    // Three.js ground truth intrinsics
    const fovRad = THREE.MathUtils.degToRad(virtualCam.fov);
    const fyTrue = (FEED_H / 2) / Math.tan(fovRad / 2);
    const fxTrue = fyTrue;   // square pixels: fx = fy

    const rmsClass = rms < 0.5 ? 'rms-good' : rms < 1.5 ? 'rms-warn' : 'rms-bad';

    resultEl.innerHTML = `
      <div class="${rmsClass}" style="font-size:0.9rem; font-weight:bold; margin-bottom:6px">
        RMS 重投影誤差：${rms.toFixed(4)} px
        ${rms < 0.5 ? '✓ 優秀' : rms < 1.5 ? '△ 可接受' : '✗ 過大'}
      </div>
      <table>
        <tr><th>參數</th><th>估計值</th><th>Ground Truth</th><th>|誤差|</th></tr>
        <tr><td>fx</td>
            <td>${fx.toFixed(2)}</td>
            <td>${fxTrue.toFixed(2)}</td>
            <td>${Math.abs(fx - fxTrue).toFixed(2)}</td></tr>
        <tr><td>fy</td>
            <td>${fy.toFixed(2)}</td>
            <td>${fyTrue.toFixed(2)}</td>
            <td>${Math.abs(fy - fyTrue).toFixed(2)}</td></tr>
        <tr><td>cx</td>
            <td>${cx.toFixed(2)}</td>
            <td>${(FEED_W / 2).toFixed(2)}</td>
            <td>${Math.abs(cx - FEED_W / 2).toFixed(2)}</td></tr>
        <tr><td>cy</td>
            <td>${cy.toFixed(2)}</td>
            <td>${(FEED_H / 2).toFixed(2)}</td>
            <td>${Math.abs(cy - FEED_H / 2).toFixed(2)}</td></tr>
        <tr><td>k₁</td>
            <td>${dd[0].toFixed(5)}</td>
            <td>0.00000</td>
            <td>${Math.abs(dd[0]).toFixed(5)}</td></tr>
        <tr><td>k₂</td>
            <td>${dd[1].toFixed(5)}</td>
            <td>0.00000</td>
            <td>${Math.abs(dd[1]).toFixed(5)}</td></tr>
        <tr><td>p₁</td>
            <td>${dd[2].toFixed(5)}</td>
            <td>0.00000</td>
            <td>${Math.abs(dd[2]).toFixed(5)}</td></tr>
        <tr><td>p₂</td>
            <td>${dd[3].toFixed(5)}</td>
            <td>0.00000</td>
            <td>${Math.abs(dd[3]).toFixed(5)}</td></tr>
      </table>
      <div style="color:var(--nord3); margin-top:8px; font-size:0.7rem">
        $f_y = \\dfrac{H/2}{\\tan(FOV/2)}$ &nbsp;|&nbsp;
        快照數：${snapshots.length}
      </div>
    `;

    // Re-render KaTeX in the new HTML
    if (typeof renderMathInElement === 'function') {
      renderMathInElement(resultEl, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
        ],
      });
    }

    // Show reprojection overlay for last snapshot
    showReprojOverlay(snapshots.length - 1, K, dist, rvecs, tvecs);

    // Draw 3D reprojection error rays in main view
    draw3DErrorRays(K, dist, rvecs, tvecs);

    setStatus(`校正完成！RMS = ${rms.toFixed(4)} px`);

  } catch (e) {
    setStatus('校正失敗：' + e.message);
    console.error(e);
  } finally {
    K.delete(); dist.delete(); rvecs.delete(); tvecs.delete();
    objMats.forEach(m => m.delete());
    imgMats.forEach(m => m.delete());
    objVec.delete();
    imgVec.delete();
  }
}

// ── Show reprojection on overlay (last snapshot) ──────────────────────────────
function showReprojOverlay(snapIdx, K, dist, rvecs, tvecs) {
  const snap = snapshots[snapIdx];
  const N = BOARD_COLS * BOARD_ROWS;
  const objMat   = cv.matFromArray(N, 1, cv.CV_32FC3, objPtsFlat);
  const rvec     = rvecs.get(snapIdx);
  const tvec     = tvecs.get(snapIdx);
  const reproj   = new cv.Mat();

  try {
    cv.projectPoints(objMat, rvec, tvec, K, dist, reproj);
    const rd = reproj.data32F;
    const measured    = [];
    const reprojected = [];
    for (let i = 0; i < N; i++) {
      measured.push({ x: snap.imgPts[i * 2], y: snap.imgPts[i * 2 + 1] });
      reprojected.push({ x: rd[i * 2], y: rd[i * 2 + 1] });
    }
    drawReprojectionOverlay(measured, reprojected);
    liveOverlay = false;
  } finally {
    objMat.delete();
    reproj.delete();
  }
}

// ── Draw reprojection error rays in main 3D view ──────────────────────────────
function draw3DErrorRays(K, dist, rvecs, tvecs) {
  // Clear previous error lines
  while (errorLines.children.length) {
    errorLines.children[0].geometry.dispose();
    errorLines.remove(errorLines.children[0]);
  }

  // For each snapshot, draw small line segments showing extrinsics
  for (let s = 0; s < Math.min(snapshots.length, 5); s++) {
    const N = BOARD_COLS * BOARD_ROWS;
    const objMat = cv.matFromArray(N, 1, cv.CV_32FC3, objPtsFlat);
    const rvec   = rvecs.get(s);
    const tvec   = tvecs.get(s);
    const reproj = new cv.Mat();

    try {
      cv.projectPoints(objMat, rvec, tvec, K, dist, reproj);
    } finally {
      objMat.delete();
      reproj.delete();
    }

    // Draw extrinsic axes at estimated camera pose
    const R = new cv.Mat();
    cv.Rodrigues(rvec, R);
    const rd = R.data64F;
    const td = tvec.data64F;

    // Camera center in world = -R^T * t
    const tx = td[0], ty = td[1], tz = td[2];
    const cx = -(rd[0]*tx + rd[3]*ty + rd[6]*tz);
    const cy = -(rd[1]*tx + rd[4]*ty + rd[7]*tz);
    const cz = -(rd[2]*tx + rd[5]*ty + rd[8]*tz);

    // Coordinate transform: OpenCV (Y-down, Z-forward) → Three.js (Y-up, Z-back)
    // In Three.js world, board is on XZ plane (Y=0).
    // OpenCV board frame: X right, Y down, Z out of board.
    // The corner positions in Three.js world space define the board.
    // For visualisation, just mark the estimated camera center
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 8, 8),
      new THREE.MeshBasicMaterial({ color: [0xBF616A, 0xD08770, 0xEBCB8B, 0xA3BE8C, 0xB48EAD][s] })
    );
    // OpenCV → Three.js: board is XZ in Three.js, XY in OpenCV
    // The board frame X maps to Three.js X, board frame Y maps to Three.js Z
    sphere.position.set(cx, cz, cy);
    errorLines.add(sphere);

    R.delete();
  }
}

// ── lil-gui setup ─────────────────────────────────────────────────────────────
const gui = new GUI({ container: document.getElementById('gui-mount'), title: 'Camera Calibration Lab' });
gui.domElement.style.position = 'relative';

const extFolder = gui.addFolder('外參 Extrinsics');
extFolder.add(params, 'camX', -0.35, 0.35, 0.005).name('X (m)').onChange(syncCam);
extFolder.add(params, 'camY', 0.04,  0.55, 0.005).name('Y (m)').onChange(syncCam);
extFolder.add(params, 'camZ', -0.35, 0.55, 0.005).name('Z (m)').onChange(syncCam);
extFolder.add(params, 'rotX', -85,   10,   1).name('Rot X°').onChange(syncCam);
extFolder.add(params, 'rotY', -70,   70,   1).name('Rot Y°').onChange(syncCam);
extFolder.add(params, 'rotZ', -40,   40,   1).name('Rot Z°').onChange(syncCam);

const intFolder = gui.addFolder('內參 Intrinsics');
intFolder.add(params, 'fov', 20, 100, 1).name('Vertical FOV°').onChange(syncCam);

const simFolder = gui.addFolder('模擬');
simFolder.add(params, 'noise', 0, 5, 0.1).name('噪聲 σ (px)');

const actFolder = gui.addFolder('操作');
actFolder.add({ fn: takeSnapshot }, 'fn').name('📸 擷取快照');
actFolder.add({ fn: calibrate },    'fn').name('⚙️ 執行校正');
actFolder.add({
  fn() {
    snapshots.length = 0;
    liveOverlay = true;
    resultEl.innerHTML = '<span style="color:var(--nord3)">快照已清除，等待校正…</span>';
    while (errorLines.children.length) {
      errorLines.children[0].geometry.dispose();
      errorLines.remove(errorLines.children[0]);
    }
    setStatus('已清除');
  }
}, 'fn').name('🗑 清除快照');

// ── Resize main canvas ────────────────────────────────────────────────────────
function resize() {
  const panelW = document.getElementById('panel').offsetWidth;
  const w = Math.max(100, window.innerWidth - panelW);
  const h = window.innerHeight;
  mainRenderer.setSize(w, h);
  mainCam.aspect = w / h;
  mainCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

setStatus('就緒 — 移動相機後按「擷取快照」（需 3+ 張不同角度）');

// ── Animation loop ─────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  camHelper.update();

  // Main 3D world view
  mainRenderer.render(scene, mainCam);

  // Feed: hide helpers & camera body, render from virtual camera
  camHelper.visible = false;
  bodyMesh.visible  = false;
  lensMesh.visible  = false;
  feedRenderer.render(scene, virtualCam);
  camHelper.visible = true;
  bodyMesh.visible  = true;
  lensMesh.visible  = true;

  // Overlay
  if (liveOverlay) drawLiveCorners(projectCorners());
}
animate();
