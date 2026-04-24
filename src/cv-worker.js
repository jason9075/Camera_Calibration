// Runs entirely off the main thread.
// importScripts is synchronous but blocks only this worker — UI stays live.

async function loadCV() {
  // importScripts blocks this worker thread until opencv.js is executed
  importScripts('https://docs.opencv.org/4.x/opencv.js');

  if (typeof cv === 'undefined') throw new Error('cv global not found after import');

  // Newer builds export cv as a Promise
  if (typeof cv.then === 'function') {
    self.cv = await cv;
  }

  // Poll until calib3d bindings are attached
  let attempts = 0;
  while (typeof cv.calibrateCamera !== 'function' && attempts < 100) {
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }

  if (typeof cv.calibrateCamera !== 'function') {
    throw new Error('calib3d not available in this OpenCV.js build');
  }
}

let cvPromise = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'preload') {
    // Triggered on first snapshot — warm up WASM silently in background
    if (!cvPromise) {
      cvPromise = loadCV().catch(e => { cvPromise = null; throw e; });
    }
    cvPromise.then(
      () => postMessage({ type: 'ready' }),
      () => postMessage({ type: 'error', msg: 'Preload failed' }),
    );
    return;
  }

  if (data.type !== 'calibrate') return;

  // WASM should already be warm if user took ≥1 snapshot first
  if (!cvPromise) {
    postMessage({ type: 'status', msg: 'Loading OpenCV.js WASM…' });
    cvPromise = loadCV().catch(e => { cvPromise = null; throw e; });
  }

  try {
    await cvPromise;
  } catch (e) {
    postMessage({ type: 'error', msg: 'OpenCV.js load failed: ' + e.message });
    return;
  }

  postMessage({ type: 'status', msg: 'Calibrating…' });

  try {
    const result = doCalibrate(
      data.snapshots,
      data.boardCols, data.boardRows,
      data.objPtsFlat,
      data.feedW, data.feedH,
    );
    postMessage({ type: 'result', ...result });
  } catch (e) {
    postMessage({ type: 'error', msg: e.message });
  }
};

function doCalibrate(snapshots, boardCols, boardRows, objPtsFlat, feedW, feedH) {
  const N = boardCols * boardRows;
  const objMats = [];
  const imgMats = [];
  const objVec  = new cv.MatVector();
  const imgVec  = new cv.MatVector();

  for (const snap of snapshots) {
    const om = cv.matFromArray(N, 1, cv.CV_32FC3, objPtsFlat);
    const im = cv.matFromArray(N, 1, cv.CV_32FC2, snap.imgPts);
    objMats.push(om);
    imgMats.push(im);
    objVec.push_back(om);
    imgVec.push_back(im);
  }

  const K     = new cv.Mat();
  const dist  = new cv.Mat();
  const rvecs = new cv.MatVector();
  const tvecs = new cv.MatVector();

  try {
    const rms = cv.calibrateCamera(
      objVec, imgVec,
      new cv.Size(feedW, feedH),
      K, dist, rvecs, tvecs,
    );

    const kd = K.data64F;
    const dd = dist.data64F;

    // Reproject last snapshot for overlay visualisation
    const lastIdx  = snapshots.length - 1;
    const lastSnap = snapshots[lastIdx];
    const objMat2  = cv.matFromArray(N, 1, cv.CV_32FC3, objPtsFlat);
    const reproj   = new cv.Mat();
    cv.projectPoints(objMat2, rvecs.get(lastIdx), tvecs.get(lastIdx), K, dist, reproj);
    const rd          = reproj.data32F;
    const reprojected = Array.from({ length: N }, (_, i) => [rd[i * 2], rd[i * 2 + 1]]);
    objMat2.delete();
    reproj.delete();

    return {
      rms,
      fx: kd[0], fy: kd[4], cx: kd[2], cy: kd[5],
      dist: [dd[0], dd[1], dd[2], dd[3]],
      reprojected,
      lastImgPts: lastSnap.imgPts,   // already a plain Array from main
    };
  } finally {
    K.delete(); dist.delete(); rvecs.delete(); tvecs.delete();
    objMats.forEach(m => m.delete());
    imgMats.forEach(m => m.delete());
    objVec.delete();
    imgVec.delete();
  }
}
