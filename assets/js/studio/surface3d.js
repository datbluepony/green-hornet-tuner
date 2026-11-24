// 3D calibration-table surface (Three.js). Display + picking.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Sequential (one hue, dark → light on a dark surface) and diverging ramps.
const SEQ = ["#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4", "#b7d3f6", "#cde2fb"].map((h) => new THREE.Color(h));
const DIV_NEG = new THREE.Color("#3987e5");
const DIV_MID = new THREE.Color("#383835");
const DIV_POS = new THREE.Color("#e66767");
const SEL = new THREE.Color("#c8f53c");

function seqColor(t, out) {
  t = Math.min(1, Math.max(0, t)) * (SEQ.length - 1);
  const i = Math.floor(t), f = t - i;
  return out.copy(SEQ[i]).lerp(SEQ[Math.min(SEQ.length - 1, i + 1)], f);
}
function divColor(t, out) { // t in -1..1
  if (t >= 0) return out.copy(DIV_MID).lerp(DIV_POS, Math.min(1, t));
  return out.copy(DIV_MID).lerp(DIV_NEG, Math.min(1, -t));
}

export class Surface3D {
  /**
   * @param {HTMLElement} el container (position: relative)
   * @param {object} o { rows, cols, value(r,c), delta(r,c), range:[min,max], deltaRange, rowAxis, colAxis, rowLabel, colLabel, valueLabel, autoRotate, onPick }
   */
  constructor(el, o) {
    this.el = el; this.o = o;
    this.mode = o.mode || "value";
    this.selection = new Set();
    const w = el.clientWidth || 600, h = el.clientHeight || 400;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h);
    el.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.setAttribute("aria-label", `${o.valueLabel || "Table"} 3D surface`);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 100);
    this._camBase = new THREE.Vector3(o.camPos?.[0] ?? -9.4, o.camPos?.[1] ?? 7.6, o.camPos?.[2] ?? 10.8);
    this._fitCamera(w / h);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6; this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.target.set(0, 0.9, 0);
    this.controls.autoRotate = !!o.autoRotate;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.enableZoom = o.zoom !== false;
    this.controls.addEventListener("start", () => (this._userMoved = true));

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(-4, 8, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xc8f53c, 0.35); rim.position.set(6, 3, -6); this.scene.add(rim);

    this._buildGeometry();
    this._buildGrid();
    this._labels();

    this._raycaster = new THREE.Raycaster();
    this._ptr = new THREE.Vector2();
    let down = null;
    const dom = this.renderer.domElement;
    dom.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, shift: e.shiftKey || e.metaKey || e.ctrlKey }));
    dom.addEventListener("pointerup", (e) => {
      if (!down || !o.onPick) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const hit = this.pick(e.clientX, e.clientY);
        if (hit) o.onPick(hit.r, hit.c, down.shift);
      }
      down = null;
    });
    dom.addEventListener("pointermove", (e) => {
      if (e.buttons) return;
      const hit = this.pick(e.clientX, e.clientY);
      o.onHover?.(hit, e);
    });
    dom.addEventListener("pointerleave", () => o.onHover?.(null));

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(el);
    this._visible = true;
    this._io = new IntersectionObserver(([en]) => (this._visible = en.isIntersecting));
    this._io.observe(el);
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      if (!this._visible) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this._placeLabels();
    };
    loop();
  }

  _xz(r, c) {
    const { rows, cols } = this.o;
    return [(c / (cols - 1) - 0.5) * 8, (r / (rows - 1) - 0.5) * 6];
  }

  _buildGeometry() {
    const { rows, cols } = this.o;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(rows * cols * 3);
    const col = new Float32Array(rows * cols * 3);
    const idx = [];
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    geo.setIndex(idx);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.geo = geo;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide, flatShading: false });
    this.mesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.mesh);

    // wire overlay
    const wpos = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++) wpos.push(r * cols + c, r * cols + c + 1);
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows - 1; r++) wpos.push(r * cols + c, (r + 1) * cols + c);
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute("position", geo.getAttribute("position"));
    wgeo.setIndex(wpos);
    this.wire = new THREE.LineSegments(wgeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 }));
    this.wire.position.y = 0.004;
    this.scene.add(this.wire);

    // selection markers
    this.markGeo = new THREE.BufferGeometry();
    this.marks = new THREE.Points(this.markGeo, new THREE.PointsMaterial({ color: SEL, size: 0.2, sizeAttenuation: true }));
    this.scene.add(this.marks);
    this.update();
  }

  _buildGrid() {
    const g = new THREE.Group();
    const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 });
    const pts = [];
    for (let i = 0; i <= 8; i++) { pts.push(-4 + i, 0, -3, -4 + i, 0, 3); }
    for (let i = 0; i <= 6; i++) { pts.push(-4, 0, -3 + i, 4, 0, -3 + i); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(geo, m));
    g.position.y = -0.02;
    this.scene.add(g);
  }

  _height(v) {
    const [lo, hi] = this.o.range;
    return ((v - lo) / (hi - lo)) * 3.2;
  }

  update() {
    const { rows, cols, value, delta } = this.o;
    const pos = this.geo.getAttribute("position");
    const col = this.geo.getAttribute("color");
    const tmp = new THREE.Color();
    const [lo, hi] = this.o.range;
    const dr = this.o.deltaRange || 5;
    const mpos = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const v = value(r, c);
        const [x, z] = this._xz(r, c);
        const y = this._height(v);
        pos.setXYZ(i, x, y, z);
        if (this.selection.has(r + ":" + c)) { tmp.copy(SEL); mpos.push(x, y + 0.08, z); }
        else if (this.mode === "delta") divColor((delta ? delta(r, c) : 0) / dr, tmp);
        else seqColor((v - lo) / (hi - lo), tmp);
        col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
    pos.needsUpdate = true; col.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.markGeo.setAttribute("position", new THREE.Float32BufferAttribute(mpos, 3));
  }

  setSelection(set) { this.selection = set; this.update(); }
  setMode(m) { this.mode = m; this.update(); }

  pick(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ptr.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._ptr, this.camera);
    const hit = this._raycaster.intersectObject(this.mesh)[0];
    if (!hit) return null;
    const { rows, cols } = this.o;
    const c = Math.round((hit.point.x / 8 + 0.5) * (cols - 1));
    const r = Math.round((hit.point.z / 6 + 0.5) * (rows - 1));
    if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
    return { r, c };
  }

  _labels() {
    const o = this.o;
    this.labelHost = document.createElement("div");
    this.labelHost.className = "s3d-labels";
    this.el.appendChild(this.labelHost);
    const mk = (text, cls = "") => { const d = document.createElement("div"); d.className = "s3d-label " + cls; d.textContent = text; this.labelHost.appendChild(d); return d; };
    this._lab = [];
    const ra = o.rowAxis, ca = o.colAxis;
    const fmtC = o.colFmt || ((v) => v), fmtR = o.rowFmt || ((v) => v);
    [0, Math.floor((ca.length - 1) / 2)].forEach((c) => this._lab.push({ el: mk(fmtC(ca[c])), p: new THREE.Vector3(this._xz(ra.length - 1, c)[0], 0, 3.45) }));
    [0, ra.length - 1].forEach((r) => this._lab.push({ el: mk(fmtR(ra[r])), p: new THREE.Vector3(4.45, 0, this._xz(r, 0)[1]) }));
    this._lab.push({ el: mk(o.colLabel, "axis"), p: new THREE.Vector3(0, 0, 4.1) });
    this._lab.push({ el: mk(o.rowLabel, "axis"), p: new THREE.Vector3(5.3, 0, 0) });
  }

  _placeLabels() {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    for (const l of this._lab) {
      v.copy(l.p).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      l.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      l.el.style.opacity = v.z < 1 ? "1" : "0";
    }
  }

  _fitCamera(aspect) {
    const k = Math.max(1, 1.5 / aspect);
    this.camera.position.copy(this._camBase).multiplyScalar(k).add(new THREE.Vector3(0, 0.9 * (1 - k), 0));
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    if (!this._userMoved) this._fitCamera(w / h);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect(); this._io.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelHost.remove();
  }
}
