# 📷 Camera Calibration Lab

An interactive, browser-based camera calibration simulator implementing **Zhang's method** entirely in pure JavaScript — no server, no WASM, no OpenCV required.  

**[🚀 Live Demo](https://jason9075.github.io/Camera_Calibration/)**

---

## Features

- **3-D virtual scene** — Three.js chessboard (9×6 inner corners, 30 mm squares) with an interactive virtual camera you can position via GUI sliders or the **🎲 Next Position** auto-finder
- **2-D camera feed** — real-time 640×480 WebGL render from the virtual camera, with live corner overlay (green border = all corners in frame)
- **Gaussian noise simulation** — adjustable σ (0–5 px) applied to detected corner coordinates
- **Pure-JS Zhang's method calibration** — DLT homography + focal length from orthogonality & equal-norm constraints + pose recovery; runs synchronously in < 1 ms
- **Reprojection overlay** — after calibration, yellow dots (measured) vs. red dots (reprojected) visualise per-corner error
- **Ground-truth comparison** — estimated fₓ, fᵧ, cₓ, cᵧ, k₁–k₂, p₁–p₂ compared against the known Three.js camera parameters
- **💡 Math primer modal** — click the lightbulb to read the full derivation with LaTeX equations; toggle between English and 繁體中文

---

## Math Overview

| Step | Description |
|------|-------------|
| **Pinhole projection** | $\tilde{u} \sim K[R \mid t]\,\tilde{X}$ |
| **Homography (Z = 0)** | $H = K[r_1 \mid r_2 \mid t]$ per view |
| **DLT** | Hartley-normalised 8×8 normal equations |
| **Zhang's constraints** | Two $f^2$ estimates per view from $r_1 \perp r_2$ and $\|r_1\|=\|r_2\|$ |
| **Focal length** | Median of all valid $f^2 > 0$ estimates |
| **Pose recovery** | $r_i = \tfrac{1}{\lambda}K^{-1}h_i$, $r_3 = r_1 \times r_2$ |
| **RMS error** | $\sqrt{\tfrac{1}{NM}\sum\|\hat{p}-p\|^2}$ — target < 0.5 px |

Open the **💡 Math Primer** modal in the app for the full step-by-step derivation.

---

## Tech Stack

| | |
|--|--|
| **Renderer** | [Three.js](https://threejs.org/) r163 |
| **GUI** | [lil-gui](https://lil-gui.georgealways.com/) |
| **Math rendering** | [KaTeX](https://katex.org/) |
| **Calibration** | Pure JS (Zhang's method, ~220 LOC) |
| **Dev environment** | Nix flake + [just](https://just.systems/) |

---

## Local Development

```bash
# Enter Nix dev shell (requires nix with flakes enabled)
nix develop

# Start live-reload dev server at http://localhost:8080
just dev
```

No build step. The app is a single `index.html` + `src/` directory of ES modules loaded via browser import maps.

---

## Project Structure

```
.
├── index.html          # Entry point — layout, styles, KaTeX, import map
├── src/
│   ├── main.js         # Three.js scene, GUI, snapshot & calibration logic
│   └── calib.js        # Pure-JS Zhang's method (DLT, focal length, pose)
├── flake.nix           # Nix development environment
└── Justfile            # Task runner (dev, check)
```

---

## Tips for Good Calibration

1. **Collect 10+ snapshots** from diverse angles (tilt, rotate, close/far)
2. **Use 🎲 Next Position** to automatically jump to a new valid camera pose
3. **Keep noise σ low** (≤ 1 px) for clean estimates; raise it to test robustness
4. **RMS < 0.5 px** = excellent; the theoretical floor is ≈ σ with enough views

---

## License

MIT
