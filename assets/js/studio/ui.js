// Shared Studio UI helpers: icons, formatting, parameter sliders.
import { GUARDS, limitFor } from "./model.js";

const P = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  connect: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  idle: '<path d="M3 12h3l2-5 3 10 3-8 2 3h5"/>',
  ve: '<path d="M3 17 9 11l4 4 8-8"/><path d="M3 21h18"/>',
  spark: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  sim: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
  logs: '<path d="M4 4h16v16H4z"/><path d="M4 9h16M9 20V9"/>',
  backups: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M12 7v5l3 2"/>',
  review: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
  mail: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>',
  download: '<path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 20h16"/>',
  play: '<path d="M7 5v14l12-7L7 5z"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  usb: '<path d="M12 2v14M8 6l4-4 4 4"/><circle cx="12" cy="19" r="3"/><path d="M7 11v2l5 3 5-3v-2"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  wand: '<path d="m15 4 5 5L9 20H4v-5L15 4z"/><path d="m13 6 5 5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  file: '<path d="M14 3H6v18h12V7l-4-4z"/><path d="M14 3v4h4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  smooth: '<path d="M3 17c4 0 4-10 9-10s5 10 9 10"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  home: '<path d="m3 11 9-8 9 8v10H3z"/><path d="M9 21v-7h6v7"/>',
};
export function icon(name, cls = "") {
  return `<svg class="${cls}" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
}

export const fmt = {
  n: (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—"),
  sign: (v, d = 1) => (Number.isFinite(v) ? (v > 0 ? "+" : "") + v.toFixed(d) : "—"),
  time: (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  ago: (iso) => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`; },
  esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
};

export const statusIcon = (s) => icon(s === "good" ? "check" : s === "crit" ? "x" : "alert");
export const statusColor = (s) => ({ good: "var(--good)", warn: "var(--warn)", serious: "var(--serious)", crit: "var(--crit)" }[s] || "var(--text-3)");
export const statusLabel = (s) => ({ good: "Good", warn: "Check", serious: "Caution", crit: "Risk" }[s] || "—");

/**
 * Parameter slider with recommended band, plan limits and baseline marker.
 * Returns HTML; wire with bindParam().
 */
export function paramHTML({ key, name, help, value, base, plan, decimals = 0 }) {
  const g = GUARDS[key];
  const [lo, hi] = limitFor(key, plan);
  const [alo, ahi] = g.advanced;
  const pct = (v) => ((v - alo) / (ahi - alo)) * 100;
  const changed = Math.abs(value - base) > 1e-6;
  return `
  <div class="param-row" data-param="${key}">
    <div class="param-top">
      <span class="name">${name}</span>
      <span class="val">${changed ? `<span class="was">${base.toFixed(decimals)}</span>` : ""}<input type="number" id="p-${key}" aria-label="${name}" value="${value.toFixed(decimals)}" step="${g.step}" min="${lo}" max="${hi}"><span class="dim" style="font-size:.8rem;width:28px">${g.unit}</span></span>
    </div>
    <div class="zone-track" aria-hidden="true">
      <i style="left:0;width:${pct(lo)}%;background:repeating-linear-gradient(135deg,rgba(208,59,59,.35) 0 4px,transparent 4px 8px)"></i>
      <i style="left:${pct(hi)}%;right:0;background:repeating-linear-gradient(135deg,rgba(208,59,59,.35) 0 4px,transparent 4px 8px)"></i>
      <i class="z-rec" style="left:${pct(g.rec[0])}%;width:${pct(g.rec[1]) - pct(g.rec[0])}%"></i>
      <i class="z-base" style="left:${pct(base)}%"></i>
    </div>
    <input class="range" type="range" id="r-${key}" aria-label="${name} slider" min="${alo}" max="${ahi}" step="${g.step}" value="${value}">
    <div class="zone-legend"><span>${alo}</span><span>Recommended ${g.rec[0]}–${g.rec[1]} · ${plan === "advanced" ? "Advanced" : "Street"} limit ${lo}–${hi}</span><span>${ahi}</span></div>
    <div class="param-help">${help}</div>
  </div>`;
}

/** Wire a param row. onChange(value, {commit}) — clamped to plan limits. */
export function bindParam(root, key, plan, onChange, onBlocked) {
  const row = root.querySelector(`[data-param="${key}"]`);
  if (!row) return;
  const r = row.querySelector(`#r-${key}`), n = row.querySelector(`#p-${key}`);
  const [lo, hi] = limitFor(key, plan);
  const setPct = () => r.style.setProperty("--pct", `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
  setPct();
  const apply = (v, commit) => {
    let val = +v;
    if (val < lo || val > hi) { onBlocked?.(key, val < lo ? lo : hi); val = Math.min(hi, Math.max(lo, val)); r.value = val; }
    n.value = (+val).toFixed(String(GUARDS[key].step).includes(".") ? 1 : 0);
    setPct();
    onChange(val, { commit });
  };
  r.addEventListener("input", () => apply(r.value, false));
  r.addEventListener("change", () => apply(r.value, true));
  n.addEventListener("change", () => { r.value = n.value; apply(n.value, true); });
}

export function scoreColor(v) { return v >= 85 ? "var(--good)" : v >= 65 ? "var(--warn)" : v >= 45 ? "var(--serious)" : "var(--crit)"; }
export function scoreStatus(v) { return v >= 85 ? "good" : v >= 65 ? "warn" : v >= 45 ? "serious" : "crit"; }
