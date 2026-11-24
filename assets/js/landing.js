import { STOCK_VE, RPM_AXIS, MAP_AXIS, CAMS, LOPE_PRESETS, idleEstimate, idleRpmAt, lerp } from "./studio/model.js";
import { EngineAudio } from "./studio/audio.js";
import { drawTrace } from "./studio/trace.js";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------ hero 3D */
(async () => {
  const el = document.getElementById("hero-3d");
  if (!el) return;
  try {
    const { Surface3D } = await import("./studio/surface3d.js");
    let wob = 0;
    const s = new Surface3D(el, {
      rows: MAP_AXIS.length, cols: RPM_AXIS.length,
      value: (r, c) => STOCK_VE[r][c] + Math.sin(wob + c * 0.5 + r * 0.3) * 0.6,
      range: [25, 100], rowAxis: MAP_AXIS, colAxis: RPM_AXIS,
      rowLabel: "MAP kPa", colLabel: "Engine RPM", valueLabel: "VE",
      autoRotate: !reduceMotion, zoom: false, camPos: [-10.2, 8, 11.4],
    });
    // a few "tuned" cells highlighted around idle
    s.setSelection(new Set(["5:1", "6:1", "5:2", "6:2", "7:1", "7:2"]));
    if (!reduceMotion) setInterval(() => { wob += 0.06; s.update(); }, 60);
  } catch (e) {
    el.innerHTML = `<div style="display:grid;place-items:center;height:100%;color:var(--text-3);font-size:.9rem;padding:20px;text-align:center">3D preview needs WebGL. Open the Studio for the full table editor.</div>`;
  }
})();

/* ------------------------------------------------------- mini heatmap */
(() => {
  const h = document.getElementById("mini-heat");
  if (!h) return;
  const ramp = ["#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4"];
  let html = "";
  for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) {
    const v = STOCK_VE[18 - r * 5][Math.round(c * 1.4)];
    const i = Math.max(0, Math.min(ramp.length - 1, Math.round(((v - 30) / 68) * (ramp.length - 1))));
    html += `<i style="background:${ramp[i]}"></i>`;
  }
  h.innerHTML = html;
})();

/* ---------------------------------------------------------- Lope Lab */
const cam = CAMS.stage3;
const A = LOPE_PRESETS.smooth.v, M = LOPE_PRESETS.mild.v, B = LOPE_PRESETS.aggressive.v;
function paramsAt(x) { // x 0..1 through smooth → mild → aggressive
  const [p, q, t] = x < 0.5 ? [A, M, x / 0.5] : [M, B, (x - 0.5) / 0.5];
  const o = {};
  for (const k of Object.keys(p)) o[k] = lerp(p[k], q[k], t);
  return o;
}

const slider = document.getElementById("lab-lope");
const out = document.getElementById("lab-lope-val");
const paramsEl = document.getElementById("lab-params");
const canvas = document.getElementById("lope-canvas");
const playBtn = document.getElementById("lab-play");
const status = document.getElementById("lab-status");
const audio = new EngineAudio();
let params = paramsAt(1), est = idleEstimate(params, cam);

function setPct(el) { el.style.setProperty("--pct", `${((el.value - el.min) / (el.max - el.min)) * 100}%`); }

function render() {
  params = paramsAt(slider.value / 100);
  est = idleEstimate(params, cam);
  out.textContent = `${Math.round(est.lope * 100)}%`;
  setPct(slider);
  const rows = [
    ["Idle target · Park", `${Math.round(params.rpmPark)} rpm`, "Lower = slower, heavier rhythm"],
    ["Idle target · Drive", `${Math.round(params.rpmDrive)} rpm`, "Kept high enough to hold A/C load"],
    ["Idle spark", `${params.sparkIdle.toFixed(1)}°`, "Less timing = lazier, choppier burn"],
    ["Idle stability correction", `${Math.round(params.stability)}%`, "How hard the ECM smooths each sag"],
    ["Idle fueling", `+${params.enrich.toFixed(1)}%`, "A touch richer keeps the chop crisp"],
  ];
  paramsEl.innerHTML = rows.map(([n, v, d]) => `<div class="param"><span class="n">${n}</span><span class="v">${v}</span><span class="d">${d}</span></div>`).join("");
  document.getElementById("r-rpm").textContent = `${Math.round(params.rpmPark)} ±${Math.round(est.swing)}`;
  document.getElementById("r-map").textContent = `${Math.round(est.vacuum)} kPa`;
  document.getElementById("r-start").textContent = `${Math.round(est.startability)}/100`;
  document.getElementById("r-stall").textContent = est.stallRisk < 0.2 ? "High" : est.stallRisk < 0.45 ? "OK" : "Low";
  const hl = document.getElementById("hud-lope"); if (hl) hl.textContent = Math.round(est.lope * 100);
  const hr = document.getElementById("hud-rpm"); if (hr) hr.textContent = Math.round(params.rpmPark);
  audio.set({ rpm: params.rpmPark, lope: est.lope, lopeHz: est.lopeHz, swing: est.swing, params: { sparkIdle: params.sparkIdle, stability: params.stability, airflow: params.airflow, enrich: params.enrich } });
  document.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === presetFor(slider.value))));
}
function presetFor(v) { v = +v; return v < 20 ? "smooth" : v < 75 ? "mild" : "aggressive"; }

if (slider) {
  slider.value = 100;
  slider.addEventListener("input", render);
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    slider.value = { smooth: 0, mild: 50, aggressive: 100 }[b.dataset.preset];
    render();
  }));
  document.querySelectorAll("[data-exh]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-exh]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    audio.set({ exhaust: b.dataset.exh });
  }));
  playBtn.addEventListener("click", async () => {
    if (audio.running) {
      audio.stop();
      playBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 5v14l12-7L7 5z"/></svg>`;
      playBtn.setAttribute("aria-label", "Play engine sound");
      status.textContent = "Paused.";
    } else {
      await audio.start();
      playBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>`;
      playBtn.setAttribute("aria-label", "Pause engine sound");
      status.textContent = "Idling. Drag the slider to change the lope.";
    }
  });
  render();

  const t0 = performance.now();
  const loop = () => {
    const t = (performance.now() - t0) / 1000;
    drawTrace(canvas, { t, base: params.rpmPark, est, window: 4, live: audio.running });
    if (!reduceMotion) requestAnimationFrame(loop);
  };
  loop();
}
