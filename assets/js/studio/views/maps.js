import { RPM_AXIS, MAP_AXIS, CYLAIR_AXIS, STOCK_VE, STOCK_SPARK, limitFor, clamp } from "../model.js";
import { icon, fmt } from "../ui.js";

const SEQ = ["#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4", "#b7d3f6", "#cde2fb"];
const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
function seq(t) { t = clamp(t, 0, 1) * (SEQ.length - 1); const i = Math.floor(t); return mix(hexToRgb(SEQ[i]), hexToRgb(SEQ[Math.min(SEQ.length - 1, i + 1)]), t - i); }
function div(t) { const mid = [56, 56, 53]; return t >= 0 ? mix(mid, [230, 103, 103], clamp(t, 0, 1)) : mix(mid, [57, 135, 229], clamp(-t, 0, 1)); }
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const CFG = {
  ve: {
    title: "Fuel · VE table", eyebrow: "Calibrate", rows: MAP_AXIS, cols: RPM_AXIS, stock: STOCK_VE, key: "veDelta", guard: "ve",
    unit: "%", dUnit: "%", range: [25, 100], dec: 1, steps: [0.5, 1, 2], rowLabel: "MAP kPa", colLabel: "Engine RPM", rowFmt: (v) => `${v}`, valueLabel: "VE",
    apply: (stock, d) => stock * (1 + d / 100),
    intro: "Volumetric efficiency tells the ECM how much air the engine breathes at each RPM and manifold pressure. It decides how much fuel to inject. Edits are percentage changes to the stock value, so they carry over to any unit your flash tool shows.",
    tips: ["Positive fuel trims in a cell mean the engine breathes more than the table says. Add VE there.", "Correct in small steps (2–3%), re-log, repeat. Let the log assistant stage corrections for you.", "The idle region (400–1,200 rpm, 35–60 kPa with a big cam) is where cam swaps need the most help."],
  },
  spark: {
    title: "Spark table", eyebrow: "Calibrate", rows: CYLAIR_AXIS, cols: RPM_AXIS, stock: STOCK_SPARK, key: "sparkDelta", guard: "spark",
    unit: "°", dUnit: "°", range: [5, 48], dec: 1, steps: [0.5, 1], rowLabel: "g/cyl", colLabel: "Engine RPM", rowFmt: (v) => v.toFixed(2), valueLabel: "Spark",
    apply: (stock, d) => stock + d,
    intro: "Main spark advance (high-octane table) by RPM and cylinder airmass, in degrees before top dead center. Light-load cells affect cruise economy. Heavy-load cells are where knock lives.",
    tips: ["Removing timing is always the safe direction. Adding it is where engines get hurt.", "Never add high-load timing without a knock-retard log from a full scan tool.", "Street limits allow −4° to +1°. Advanced allows −8° to +3° with a signed waiver."],
  },
};

export function render(root, ctx, id) {
  const { store, toast } = ctx;
  const C = CFG[id];
  const R = C.rows.length, K = C.cols.length;
  let mode = "value";
  let step = C.steps[1] ?? C.steps[0];
  let sel = new Set();
  let anchor = null, dragging = false, surface = null, selfCommit = false;
  const tip = document.createElement("div"); tip.className = "cell-tip"; tip.hidden = true; document.body.appendChild(tip);

  const delta = () => store.state[C.key];
  const val = (r, c) => C.apply(C.stock[r][c], delta()[r][c]);
  const plan = () => store.state.plan;
  const lim = () => limitFor(C.guard, plan());

  root.innerHTML = `
    <div class="view-head">
      <div>
        <span class="eyebrow">${C.eyebrow}</span>
        <h1 style="margin-top:10px">${C.title}</h1>
        <p>${C.intro}</p>
      </div>
      <div class="tools">
        <div class="seg" role="group" aria-label="Color by">
          <button data-mode="value" aria-pressed="true">Values</button>
          <button data-mode="delta" aria-pressed="false">Change vs stock</button>
        </div>
      </div>
    </div>
    <section class="panel">
      <div class="edit-bar">
        <span class="k" style="margin-right:4px">Step</span>
        <div class="seg" role="group" aria-label="Step size">${C.steps.map((s) => `<button data-step="${s}" aria-pressed="${s === step}">${s}${C.dUnit}</button>`).join("")}</div>
        <span class="sep"></span>
        <button class="btn btn-ghost btn-sm" data-op="dec" title="Decrease (−)">${icon("minus")} ${C.dUnit === "%" ? "Lean" : "Retard"}</button>
        <button class="btn btn-ghost btn-sm" data-op="inc" title="Increase (+)">${icon("plus")} ${C.dUnit === "%" ? "Richen" : "Advance"}</button>
        <span class="sep"></span>
        <label class="sr-only" for="setv">Set change to</label>
        <input class="num-in" id="setv" type="number" step="0.5" placeholder="Δ ${C.dUnit}">
        <button class="btn btn-ghost btn-sm" data-op="set">Set Δ</button>
        <button class="btn btn-ghost btn-sm" data-op="smooth" title="Blend selected changes with their neighbours">${icon("smooth")} Smooth</button>
        <button class="btn btn-ghost btn-sm" data-op="reset" title="Back to stock (Delete)">${icon("undo")} Stock</button>
        <span class="sep"></span>
        <button class="btn btn-quiet btn-sm" data-op="all">Select all</button>
        <span class="selinfo" id="selinfo">No cells selected</span>
      </div>
      <div class="map-wrap">
        <div class="s3d-host" id="s3d">
          <div class="s3d-hint">Drag to orbit · click to select · shift-click to add</div>
          <div class="s3d-legend" id="legend"></div>
        </div>
        <div class="grid-host" id="gridhost"></div>
      </div>
    </section>
    <div class="cols cols-3">
      <section class="panel"><div class="panel-h"><h3>Guardrails</h3><span class="right"><span class="pill ${plan() === "advanced" ? "warn" : "good"}">${plan() === "advanced" ? "Advanced" : "Street"}</span></span></div>
        <div class="panel-b" style="display:grid;gap:10px;font-size:.88rem;color:var(--text-2)">
          <div>Allowed change: <b class="mono" style="color:var(--text)">${lim()[0]}${C.dUnit} … +${lim()[1]}${C.dUnit}</b> per cell.</div>
          <div>Edits beyond the limit are clamped and flagged. ${plan() === "advanced" ? "" : "Switch to Advanced in the sidebar for a wider range."}</div>
        </div></section>
      <section class="panel"><div class="panel-h"><h3>Selection</h3></div><div class="panel-b" id="selstats" style="font-size:.88rem;color:var(--text-2)">Select cells on the surface or in the grid. Drag across the grid to select a block.</div></section>
      <section class="panel"><div class="panel-h"><h3>Tips</h3></div><div class="panel-b"><ul style="margin:0;padding-left:18px;display:grid;gap:8px;font-size:.86rem;color:var(--text-2)">${C.tips.map((t) => `<li>${t}</li>`).join("")}</ul></div></section>
    </div>`;

  /* ---------- grid ---------- */
  const gridhost = root.querySelector("#gridhost");
  gridhost.innerHTML = `<table class="cal" aria-label="${C.title} grid"><thead><tr><th>${C.rowLabel}</th>${C.cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${C.rows.map((rv, r) => `<tr><th>${C.rowFmt(rv)}</th>${C.cols.map((_, c) => `<td data-r="${r}" data-c="${c}"></td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const tds = [...gridhost.querySelectorAll("td")];
  const td = (r, c) => tds[r * K + c];

  function refreshGrid() {
    const [lo, hi] = C.range;
    const dr = Math.max(Math.abs(lim()[0]), lim()[1]);
    for (let r = 0; r < R; r++) for (let c = 0; c < K; c++) {
      const cell = td(r, c), d = delta()[r][c], v = val(r, c);
      const rgb = mode === "delta" ? div(d / dr) : seq((v - lo) / (hi - lo));
      cell.style.background = `rgb(${rgb.join(",")})`;
      cell.classList.toggle("dark", lum(rgb) < 0.5);
      cell.textContent = mode === "delta" ? (Math.abs(d) < 1e-6 ? "·" : fmt.sign(d, 1)) : v.toFixed(C.dec);
      cell.classList.toggle("chg", Math.abs(d) > 1e-6);
      cell.classList.toggle("sel", sel.has(r + ":" + c));
    }
    const lg = root.querySelector("#legend");
    lg.innerHTML = mode === "delta"
      ? `<span>Change vs stock</span><div class="ramp" style="background:linear-gradient(90deg,#3987e5,#383835,#e66767)"></div><div class="ends"><span>${-dr}${C.dUnit}</span><span>0</span><span>+${dr}${C.dUnit}</span></div>`
      : `<span>${C.valueLabel} ${C.unit}</span><div class="ramp" style="background:linear-gradient(90deg,${SEQ.join(",")})"></div><div class="ends"><span>${C.range[0]}</span><span>${C.range[1]}</span></div>`;
    surface?.update();
    updateSelInfo();
  }

  function updateSelInfo() {
    const n = sel.size;
    root.querySelector("#selinfo").textContent = n ? `${n} cell${n > 1 ? "s" : ""} selected` : "No cells selected";
    const ss = root.querySelector("#selstats");
    if (!n) { ss.innerHTML = "Select cells on the surface or in the grid. Drag across the grid to select a block."; return; }
    const cells = [...sel].map((k) => k.split(":").map(Number));
    const ds = cells.map(([r, c]) => delta()[r][c]), vs = cells.map(([r, c]) => val(r, c));
    const rs = cells.map(([r]) => C.rows[r]), cs = cells.map(([, c]) => C.cols[c]);
    ss.innerHTML = `<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px" class="mono">
      <span class="dim">RPM</span><span>${Math.min(...cs)}–${Math.max(...cs)}</span>
      <span class="dim">${C.rowLabel}</span><span>${C.rowFmt(Math.min(...rs))}–${C.rowFmt(Math.max(...rs))}</span>
      <span class="dim">Value</span><span>${Math.min(...vs).toFixed(1)}–${Math.max(...vs).toFixed(1)} ${C.unit}</span>
      <span class="dim">Change</span><span>${fmt.sign(Math.min(...ds))}…${fmt.sign(Math.max(...ds))} ${C.dUnit}</span></div>`;
  }

  /* ---------- edits ---------- */
  function edit(fn, label) {
    if (!sel.size) { toast("Select some cells first.", "warn"); return; }
    const [lo, hi] = lim();
    let clamped = 0;
    selfCommit = true;
    store.update((s) => {
      const tbl = s[C.key];
      const snapshot = tbl.map((r) => r.slice());
      for (const k of sel) {
        const [r, c] = k.split(":").map(Number);
        const nv = +fn(snapshot[r][c], r, c, snapshot).toFixed(2);
        const cv = clamp(nv, lo, hi);
        if (cv !== nv) clamped++;
        tbl[r][c] = cv;
      }
    }, `${C.title}: ${label} (${sel.size} cells)`);
    if (clamped) toast(`${clamped} cell${clamped > 1 ? "s" : ""} hit the ${plan() === "advanced" ? "Advanced" : "Street"} limit and ${clamped > 1 ? "were" : "was"} clamped.`, "warn");
    refreshGrid();
  }
  const ops = {
    inc: () => edit((d) => d + step, `+${step}${C.dUnit}`),
    dec: () => edit((d) => d - step, `−${step}${C.dUnit}`),
    set: () => { const v = parseFloat(root.querySelector("#setv").value); if (!Number.isFinite(v)) { toast("Type a change value first.", "warn"); return; } edit(() => v, `set ${v}${C.dUnit}`); },
    reset: () => edit(() => 0, "reset to stock"),
    smooth: () => edit((d, r, c, t) => {
      let s = 0, n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < R && cc < K) { const w = dr === 0 && dc === 0 ? 2 : 1; s += t[rr][cc] * w; n += w; } }
      return s / n;
    }, "smooth"),
    all: () => { sel = new Set(); for (let r = 0; r < R; r++) for (let c = 0; c < K; c++) sel.add(r + ":" + c); syncSel(); },
  };
  root.querySelectorAll("[data-op]").forEach((b) => b.addEventListener("click", () => ops[b.dataset.op]()));
  root.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => { step = +b.dataset.step; root.querySelectorAll("[data-step]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
  root.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; root.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); surface?.setMode(mode); refreshGrid(); }));

  function syncSel() { surface?.setSelection(new Set(sel)); refreshGrid(); }

  // grid selection
  const rect = (a, b) => { const s = new Set(); for (let r = Math.min(a[0], b[0]); r <= Math.max(a[0], b[0]); r++) for (let c = Math.min(a[1], b[1]); c <= Math.max(a[1], b[1]); c++) s.add(r + ":" + c); return s; };
  let base = new Set();
  gridhost.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest("td"); if (!cell) return;
    e.preventDefault();
    const p = [+cell.dataset.r, +cell.dataset.c];
    base = e.shiftKey || e.ctrlKey || e.metaKey ? new Set(sel) : new Set();
    anchor = p; dragging = true;
    sel = new Set([...base, ...rect(anchor, p)]); syncSel();
  });
  gridhost.addEventListener("pointerover", (e) => {
    const cell = e.target.closest("td"); if (!cell) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    showTip(r, c, e);
    if (dragging) { sel = new Set([...base, ...rect(anchor, [r, c])]); syncSel(); }
  });
  gridhost.addEventListener("pointerleave", () => (tip.hidden = true));
  const up = () => (dragging = false);
  window.addEventListener("pointerup", up);

  function showTip(r, c, e) {
    const d = delta()[r][c];
    tip.hidden = false;
    tip.innerHTML = `<div><b>${C.cols[c]} rpm · ${C.rowFmt(C.rows[r])} ${C.rowLabel}</b></div><div>Stock ${C.stock[r][c].toFixed(1)}${C.unit} → <b>${val(r, c).toFixed(2)}${C.unit}</b></div><div>Change ${fmt.sign(d)}${C.dUnit}</div>`;
    tip.style.left = Math.min(innerWidth - 220, e.clientX + 14) + "px"; tip.style.top = e.clientY + 14 + "px";
  }

  const onKey = (e) => {
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); ops.inc(); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); ops.dec(); }
    else if (e.key === "Delete" || e.key === "Backspace") { if (sel.size) { e.preventDefault(); ops.reset(); } }
    else if (e.key === "Escape") { sel = new Set(); syncSel(); }
  };
  document.addEventListener("keydown", onKey);

  /* ---------- 3D ---------- */
  (async () => {
    try {
      const { Surface3D } = await import("../surface3d.js");
      surface = new Surface3D(root.querySelector("#s3d"), {
        rows: R, cols: K, value: val, delta: (r, c) => delta()[r][c],
        range: C.range, deltaRange: Math.max(Math.abs(lim()[0]), lim()[1]),
        rowAxis: C.rows, colAxis: C.cols, rowLabel: C.rowLabel, colLabel: C.colLabel, valueLabel: C.valueLabel, rowFmt: C.rowFmt,
        onPick: (r, c, add) => { const k = r + ":" + c; if (add) { sel.has(k) ? sel.delete(k) : sel.add(k); } else sel = new Set([k]); syncSel(); },
        onHover: (hit, e) => { if (hit && e) showTip(hit.r, hit.c, e); else tip.hidden = true; },
      });
      surface.setMode(mode);
    } catch (err) {
      root.querySelector("#s3d").innerHTML = `<div class="empty-state">${icon("alert")}<span>3D view needs WebGL. The grid editor works normally.</span></div>`;
    }
  })();

  refreshGrid();
  const off = store.on(() => { if (selfCommit) { selfCommit = false; return; } refreshGrid(); });
  return () => { off(); surface?.dispose(); tip.remove(); document.removeEventListener("keydown", onKey); window.removeEventListener("pointerup", up); };
}
