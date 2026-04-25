import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { calibrateCamera } from './calib.js';

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

// ── Dirty-render flags (declared early — used by syncCam before GUI setup) ────
let mainDirty = true;
let feedDirty = true;
let lastFeedMs = 0;
const FEED_INTERVAL_MS = 1000 / 15;
function markDirty() { mainDirty = true; feedDirty = true; }

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

// ── Board axis indicators at board center (X→col red, Y→row green, Z→normal blue)
const boardAxisGroup = new THREE.Group();
const boardCenter = new THREE.Vector3(0, 0.001, 0);
const AXIS_X_LEN = BOARD_W / 2;
const AXIS_Y_LEN = BOARD_D / 2;
const AXIS_Z_LEN = SQUARE * 3;

boardAxisGroup.add(new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0), boardCenter, AXIS_X_LEN,
  0xBF616A, SQUARE * 0.65, SQUARE * 0.32
));
boardAxisGroup.add(new THREE.ArrowHelper(
  new THREE.Vector3(0, 0, 1), boardCenter, AXIS_Y_LEN,
  0xA3BE8C, SQUARE * 0.55, SQUARE * 0.28
));
boardAxisGroup.add(new THREE.ArrowHelper(
  new THREE.Vector3(0, 1, 0), boardCenter, AXIS_Z_LEN,
  0x5E81AC, SQUARE * 0.5, SQUARE * 0.25
));

function makeAxisLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 46px sans-serif';
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 32);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.022, 0.022, 1);
  return sprite;
}

const xLabel = makeAxisLabel('X', '#BF616A');
xLabel.position.set(AXIS_X_LEN + SQUARE * 0.5, 0.008, 0);
const yLabel = makeAxisLabel('Y', '#A3BE8C');
yLabel.position.set(0, 0.008, AXIS_Y_LEN + SQUARE * 0.5);
const zLabel = makeAxisLabel('Z', '#5E81AC');
zLabel.position.set(0, AXIS_Z_LEN + SQUARE * 0.4, 0);
boardAxisGroup.add(xLabel, yLabel, zLabel);
scene.add(boardAxisGroup);

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
  ctx2d.fillText(`snaps: ${snapshots.length}  ${ok ? '✓ in frame' : '✗ out of frame'}`, 8, 18);
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
const snapStatusEl  = document.getElementById('snap-status');
const cvStatusEl    = document.getElementById('cv-status');
const resultSumEl   = document.getElementById('result-summary');
const resultEl      = document.getElementById('result-detail');
cvStatusEl.textContent = "Zhang's method (pure JS)";

function setStatus(msg) {
  snapStatusEl.textContent = `Snapshots: ${snapshots.length} | ${msg}`;
}

// ── Virtual camera sync ───────────────────────────────────────────────────────
// camX/Y/Z follow board convention: X=col, Y=row/depth, Z=normal/height
// Three.js world mapping: camX→worldX, camY→worldZ, camZ→worldY
const params = {
  camX: 0.00, camY: 0.28, camZ: 0.18,
  rotX: -32,  rotY: 0,   rotZ: 0,
  fov: 60,
  noise: 0.5,
};

function syncCam() {
  virtualCam.position.set(params.camX, params.camZ, params.camY);
  virtualCam.rotation.order = 'XYZ';
  virtualCam.rotation.set(
    THREE.MathUtils.degToRad(params.rotX),
    THREE.MathUtils.degToRad(params.rotY),
    THREE.MathUtils.degToRad(params.rotZ),
  );
  virtualCam.fov = params.fov;
  virtualCam.aspect = FEED_W / FEED_H;
  virtualCam.updateProjectionMatrix();
  liveOverlay = true;
  markDirty();
}
syncCam();

// ── Take snapshot ─────────────────────────────────────────────────────────────
function takeSnapshot() {
  const pts = projectCorners();
  if (!allInFrame(pts)) {
    setStatus('Snapshot failed — corners out of frame');
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
  markDirty();
  setStatus(`Snapshot #${snapshots.length} captured`);
}

// ── Auto-find a valid camera position ────────────────────────────────────────
function nextPosition() {
  const DEG = THREE.MathUtils.radToDeg;
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  for (let attempt = 0; attempt < 400; attempt++) {
    // Sample position in a hemisphere above the board
    const x = rand(-0.28, 0.28);
    const y = rand(0.08, 0.48);
    const z = rand(0.05, 0.48);

    // Aim at board center with a tiny random offset for variety
    const target = new THREE.Vector3(rand(-0.04, 0.04), 0, rand(-0.04, 0.04));
    virtualCam.position.set(x, y, z);
    virtualCam.rotation.order = 'XYZ';
    virtualCam.lookAt(target);

    // Read back computed Euler angles, add small random roll
    const rx = DEG(virtualCam.rotation.x) + rand(-4, 4);
    const ry = DEG(virtualCam.rotation.y) + rand(-4, 4);
    const rz = rand(-22, 22);

    // Write into params (clamped to slider ranges)
    // y = Three.js world Y (height) → board Z; z = Three.js world Z (depth) → board Y
    params.camX = Math.max(-0.35, Math.min(0.35, +x.toFixed(3)));
    params.camY = Math.max(-0.35, Math.min(0.55, +z.toFixed(3)));
    params.camZ = Math.max(0.04,  Math.min(0.55, +y.toFixed(3)));
    params.rotX = Math.max(-85, Math.min(10,  Math.round(rx)));
    params.rotY = Math.max(-70, Math.min(70,  Math.round(ry)));
    params.rotZ = Math.max(-40, Math.min(40,  Math.round(rz)));

    syncCam();
    if (allInFrame(projectCorners())) {
      gui.controllersRecursive().forEach(c => c.updateDisplay());
      setStatus(`New position — take snapshot #${snapshots.length + 1}`);
      return;
    }
  }
  setStatus('No valid position found — try again');
}

// ── Calibration — pure JS Zhang's method (synchronous, no WASM) ──────────────
function calibrate() {
  if (snapshots.length < 3) { setStatus('Need at least 3 snapshots'); return; }

  try {
    const result = calibrateCamera({
      snapshots,
      boardCols: BOARD_COLS,
      boardRows: BOARD_ROWS,
      squareSize: SQUARE,
      feedW: FEED_W,
      feedH: FEED_H,
    });
    onCalibResult(result);
  } catch (e) {
    setStatus('Calibration failed: ' + e.message);
    console.error(e);
  }
}

function onCalibResult({ rms, fx, fy, cx, cy, dist, reprojected, lastImgPts }) {
  const fovRad = THREE.MathUtils.degToRad(virtualCam.fov);
  const fyTrue = (FEED_H / 2) / Math.tan(fovRad / 2);
  const fxTrue = fyTrue;

  const rmsClass = rms < 0.5 ? 'rms-good' : rms < 1.5 ? 'rms-warn' : 'rms-bad';
  const rmsLabel = rms < 0.5 ? '✓ Excellent' : rms < 1.5 ? '△ Acceptable' : '✗ Too large';

  resultSumEl.innerHTML =
    `<span class="${rmsClass}">RMS Reprojection Error: ${rms.toFixed(4)} px &nbsp;${rmsLabel}</span>`;

  resultEl.innerHTML = `
    <div style="padding:8px 12px 12px">
      <table>
        <tr><th>Param</th><th>Estimated</th><th>Ground Truth</th><th>|Error|</th></tr>
        <tr><td>fx</td><td>${fx.toFixed(2)}</td><td>${fxTrue.toFixed(2)}</td><td>${Math.abs(fx-fxTrue).toFixed(2)}</td></tr>
        <tr><td>fy</td><td>${fy.toFixed(2)}</td><td>${fyTrue.toFixed(2)}</td><td>${Math.abs(fy-fyTrue).toFixed(2)}</td></tr>
        <tr><td>cx</td><td>${cx.toFixed(2)}</td><td>${(FEED_W/2).toFixed(2)}</td><td>${Math.abs(cx-FEED_W/2).toFixed(2)}</td></tr>
        <tr><td>cy</td><td>${cy.toFixed(2)}</td><td>${(FEED_H/2).toFixed(2)}</td><td>${Math.abs(cy-FEED_H/2).toFixed(2)}</td></tr>
        <tr><td>k₁</td><td>${dist[0].toFixed(5)}</td><td>0.00000</td><td>${Math.abs(dist[0]).toFixed(5)}</td></tr>
        <tr><td>k₂</td><td>${dist[1].toFixed(5)}</td><td>0.00000</td><td>${Math.abs(dist[1]).toFixed(5)}</td></tr>
        <tr><td>p₁</td><td>${dist[2].toFixed(5)}</td><td>0.00000</td><td>${Math.abs(dist[2]).toFixed(5)}</td></tr>
        <tr><td>p₂</td><td>${dist[3].toFixed(5)}</td><td>0.00000</td><td>${Math.abs(dist[3]).toFixed(5)}</td></tr>
      </table>
      <div style="color:var(--nord3);margin-top:6px;font-size:0.7rem">snapshots: ${snapshots.length}</div>
    </div>
  `;

  // Draw reprojection overlay
  const measured    = [];
  const reprojPts   = [];
  for (let i = 0; i < lastImgPts.length / 2; i++) {
    measured.push({ x: lastImgPts[i * 2], y: lastImgPts[i * 2 + 1] });
    reprojPts.push({ x: reprojected[i][0], y: reprojected[i][1] });
  }
  drawReprojectionOverlay(measured, reprojPts);
  liveOverlay = false;

  markDirty();
  setStatus(`Calibrated! RMS = ${rms.toFixed(4)} px`);
}

// ── lil-gui setup ─────────────────────────────────────────────────────────────
const gui = new GUI({ container: document.getElementById('gui-mount'), title: 'Camera Calibration Lab' });
gui.domElement.style.position = 'relative';

const extFolder = gui.addFolder('Extrinsics');
extFolder.add(params, 'camX', -0.35, 0.35, 0.005).name('X (m)').onChange(syncCam);
extFolder.add(params, 'camY', -0.35, 0.55, 0.005).name('Y (m) depth').onChange(syncCam);
extFolder.add(params, 'camZ', 0.04,  0.55, 0.005).name('Z (m) height').onChange(syncCam);
extFolder.add(params, 'rotX', -85,   10,   1).name('Rot X°').onChange(syncCam);
extFolder.add(params, 'rotY', -70,   70,   1).name('Rot Y°').onChange(syncCam);
extFolder.add(params, 'rotZ', -40,   40,   1).name('Rot Z°').onChange(syncCam);

const intFolder = gui.addFolder('Intrinsics');
intFolder.add(params, 'fov', 20, 100, 1).name('Vertical FOV°').onChange(syncCam);

const simFolder = gui.addFolder('Simulation');
simFolder.add(params, 'noise', 0, 5, 0.1).name('Noise σ (px)');

const actFolder = gui.addFolder('Actions');
actFolder.add({ fn: nextPosition }, 'fn').name('🎲 Next Position');
actFolder.add({ fn: takeSnapshot }, 'fn').name('📸 Take Snapshot');
actFolder.add({ fn: calibrate },    'fn').name('⚙️  Calibrate');
actFolder.add({
  fn() {
    snapshots.length = 0;
    liveOverlay = true;
    resultEl.innerHTML = '<span style="color:var(--nord3)">Snapshots cleared — awaiting calibration…</span>';
    markDirty();
    setStatus('Cleared');
  }
}, 'fn').name('🗑  Clear Snapshots');

// Orbit fires 'change' while the user drags or damping is decelerating
orbit.addEventListener('change', markDirty);

// ── Resize main canvas ────────────────────────────────────────────────────────
function resize() {
  const panelW = document.getElementById('panel').offsetWidth;
  const w = Math.max(100, window.innerWidth - panelW);
  const h = window.innerHeight;
  mainRenderer.setSize(w, h);
  mainCam.aspect = w / h;
  mainCam.updateProjectionMatrix();
  markDirty();
}
window.addEventListener('resize', resize);
resize();

setStatus('Ready — move the camera then take 3+ snapshots from different angles');

// ── Animation loop ─────────────────────────────────────────────────────────────
function animate(now = 0) {
  requestAnimationFrame(animate);

  // Required every frame for damping to work; fires 'change' when still moving
  orbit.update();

  if (mainDirty) {
    mainDirty = false;
    camHelper.update();
    mainRenderer.render(scene, mainCam);
  }

  if (feedDirty && now - lastFeedMs >= FEED_INTERVAL_MS) {
    lastFeedMs = now;
    feedDirty = false;

    camHelper.visible        = false;
    bodyMesh.visible         = false;
    lensMesh.visible         = false;
    boardAxisGroup.visible   = false;
    feedRenderer.render(scene, virtualCam);
    camHelper.visible        = true;
    bodyMesh.visible         = true;
    lensMesh.visible         = true;
    boardAxisGroup.visible   = true;

    if (liveOverlay) drawLiveCorners(projectCorners());
  }
}
animate();
