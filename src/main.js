import * as THREE from 'three';

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2E3440); // Nord0

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 0, 3);

// Sample geometry
const geometry = new THREE.IcosahedronGeometry(1, 1);
const material = new THREE.MeshStandardMaterial({
  color: 0x88C0D0, // Nord8
  wireframe: true,
});
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// Lighting
const light = new THREE.DirectionalLight(0xECEFF4, 1.5);
light.position.set(2, 3, 4);
scene.add(light);
scene.add(new THREE.AmbientLight(0x4C566A, 0.8));

/** Resize handler */
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/** Animation loop */
function animate(t = 0) {
  requestAnimationFrame(animate);
  mesh.rotation.x = t * 0.0003;
  mesh.rotation.y = t * 0.0005;
  renderer.render(scene, camera);
}
animate();
