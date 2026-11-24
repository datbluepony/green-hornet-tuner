// Lightweight canvas charts: line chart (with crosshair tooltip),
// radial tachometer, sparkline. Colors come from CSS tokens.
import { fitCanvas } from "./trace.js";

const tok = (n, fb) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
export const SERIES = () => [tok("--s1", "#3987e5"), tok("--s2", "#d95926"), tok("--s3", "#199e70")];

/**
 * Line chart. opts: { x:[], series:[{label,data,color,width,dash}], y:[min,max], yTicks, yFmt, xFmt,
 * bands:[{from,to,label}], refLines:[{y,label}], cursor (index), unit, onHover }
 */
export class LineChart {
  constructor(canvas, opts) {
    this.cv = canvas; this.o = opts; this.hover = null;
    this.tip = document.createElement("div");
    this.tip.className = "chart-tip"; this.tip.hidden = true;
    canvas.parentElement.style.position = "relative";
    canvas.parentElement.appendChild(this.tip);
    canvas.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); this.hover = e.clientX - r.left; this.draw(); });
    canvas.addEventListener("pointerleave", () => { this.hover = null; this.tip.hidden = true; this.draw(); });
    this._ro = new ResizeObserver(() => this.draw()); this._ro.observe(canvas);
  }
  set(o) { Object.assign(this.o, o); this.draw(); }
  draw() {
    const o = this.o; const cv = this.cv;
    if (!cv.clientWidth) return;
    const { ctx, w, h } = fitCanvas(cv);
    const padL = 46, padR = 12, padT = 12, padB = 24;
    const pw = w - padL - padR, ph = h - padT - padB;
    const n = o.x.length;
    const [y0, y1] = o.y;
    const X = (i) => padL + (i / Math.max(1, n - 1)) * pw;
    const Y = (v) => padT + ph - ((v - y0) / (y1 - y0)) * ph;
    ctx.clearRect(0, 0, w, h);
    const text3 = tok("--text-3", "#6d7768"), text2 = tok("--text-2", "#a9b2a3");
    ctx.font = "10.5px JetBrains Mono, monospace";

    // phase bands
    (o.bands || []).forEach((b, k) => {
      const a = X(b.from), z = X(b.to);
      if (k % 2) { ctx.fillStyle = "rgba(255,255,255,.022)"; ctx.fillRect(a, padT, z - a, ph); }
      if (o.showBandLabels) { const lbl = b.label.toUpperCase(); if (ctx.measureText(lbl).width + 12 < z - a) { ctx.fillStyle = text3; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(lbl, a + 6, padT + 4); } }
    });
    // grid + y labels
    ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.lineWidth = 1; ctx.fillStyle = text3; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const ticks = o.yTicks || 4;
    for (let i = 0; i <= ticks; i++) {
      const v = y0 + ((y1 - y0) * i) / ticks;
      const yy = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillText((o.yFmt || ((x) => x))(v), padL - 8, yy);
    }
    // x labels
    if (o.xTicks) { ctx.textAlign = "center"; ctx.textBaseline = "top"; o.xTicks.forEach((i) => ctx.fillText((o.xFmt || ((x) => x))(o.x[i]), X(i), h - padB + 7)); }
    // ref lines
    (o.refLines || []).forEach((r) => {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = r.color || "rgba(255,255,255,.3)";
      ctx.beginPath(); ctx.moveTo(padL, Y(r.y)); ctx.lineTo(w - padR, Y(r.y)); ctx.stroke(); ctx.setLineDash([]);
      if (r.label) { ctx.fillStyle = text2; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(r.label, w - padR - 4, Y(r.y) - 3); }
    });
    // series
    const lim = o.cursor != null ? o.cursor : n - 1;
    o.series.forEach((s) => {
      ctx.beginPath();
      for (let i = 0; i <= lim; i++) { const v = Math.min(y1, Math.max(y0, s.data[i])); i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); }
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.lineJoin = "round"; ctx.setLineDash(s.dash || []);
      ctx.globalAlpha = s.alpha ?? 1; ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
      if (s.fill) { ctx.lineTo(X(lim), Y(y0)); ctx.lineTo(X(0), Y(y0)); ctx.closePath(); ctx.fillStyle = s.fill; ctx.fill(); }
      if (o.cursor != null && !s.dash) { const v = Math.min(y1, Math.max(y0, s.data[lim])); ctx.beginPath(); ctx.arc(X(lim), Y(v), 3.5, 0, 7); ctx.fillStyle = s.color; ctx.fill(); }
    });
    // hover crosshair
    if (this.hover != null && this.hover >= padL && this.hover <= w - padR) {
      const i = Math.round(((this.hover - padL) / pw) * (n - 1));
      const xx = Math.round(X(i)) + 0.5;
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + ph); ctx.stroke();
      o.series.forEach((s) => { const v = s.data[i]; if (v == null) return; ctx.beginPath(); ctx.arc(X(i), Y(Math.min(y1, Math.max(y0, v))), 4, 0, 7); ctx.fillStyle = s.color; ctx.fill(); ctx.strokeStyle = tok("--surface", "#0f120e"); ctx.lineWidth = 2; ctx.stroke(); });
      const band = (o.bands || []).find((b) => i >= b.from && i < b.to);
      this.tip.hidden = false;
      this.tip.innerHTML = `<div class="ct-h">${(o.xFmt || ((x) => x))(o.x[i])}${band ? ` · ${band.label}` : ""}</div>` + o.series.map((s) => `<div class="ct-r"><i style="background:${s.color}"></i><span>${s.label}</span><b>${s.data[i] == null ? "—" : (o.vFmt || o.yFmt || ((x) => x))(s.data[i])}</b></div>`).join("");
      const tw = this.tip.offsetWidth;
      this.tip.style.left = Math.min(w - tw - 4, Math.max(4, xx + 12)) + "px";
      this.tip.style.top = padT + 6 + "px";
    } else this.tip.hidden = true;
  }
}

/** Radial tachometer. */
export function drawTach(cv, { rpm, max = 7000, redline = 6000, target, label = "RPM" }) {
  if (!cv.clientWidth) return;
  const { ctx, w, h } = fitCanvas(cv);
  const cx = w / 2, cy = h * 0.56, R = Math.min(w, h * 1.3) * 0.42;
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
  const ang = (v) => a0 + (Math.min(max, Math.max(0, v)) / max) * (a1 - a0);
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineWidth = 10; ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
  ctx.strokeStyle = "rgba(208,59,59,.55)"; ctx.beginPath(); ctx.arc(cx, cy, R, ang(redline), a1); ctx.stroke();
  const grad = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
  grad.addColorStop(0, "#7fae12"); grad.addColorStop(1, tok("--accent", "#c8f53c"));
  ctx.strokeStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, R, a0, ang(rpm)); ctx.stroke();
  // ticks
  ctx.lineCap = "butt"; ctx.font = "11px JetBrains Mono, monospace"; ctx.fillStyle = tok("--text-3", "#6d7768"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let v = 0; v <= max; v += 500) {
    const a = ang(v), major = v % 1000 === 0;
    ctx.strokeStyle = v >= redline ? "rgba(239,106,106,.8)" : "rgba(255,255,255,.35)"; ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16)); ctx.lineTo(cx + Math.cos(a) * (R - (major ? 26 : 21)), cy + Math.sin(a) * (R - (major ? 26 : 21))); ctx.stroke();
    if (major) ctx.fillText(String(v / 1000), cx + Math.cos(a) * (R - 40), cy + Math.sin(a) * (R - 40));
  }
  if (target) { const a = ang(target); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (R + 12), cy + Math.sin(a) * (R + 12), 3, 0, 7); ctx.fill(); }
  // needle
  const a = ang(rpm);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12); ctx.lineTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22)); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.fillStyle = tok("--surface-3", "#1a1f18"); ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = tok("--text", "#eef1ea"); ctx.font = "600 30px Saira, Inter, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(Math.round(rpm).toLocaleString(), cx, cy + R * 0.52);
  ctx.font = "10.5px JetBrains Mono, monospace"; ctx.fillStyle = tok("--text-3", "#6d7768");
  ctx.fillText(label + " × 1000", cx, cy + R * 0.52 + 22);
}

export function drawSpark(cv, data, { color, min, max } = {}) {
  if (!cv.clientWidth || data.length < 2) return;
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const lo = min ?? Math.min(...data), hi = max ?? Math.max(...data);
  const span = hi - lo || 1;
  const X = (i) => (i / (data.length - 1)) * (w - 4) + 2, Y = (v) => h - 3 - ((v - lo) / span) * (h - 6);
  ctx.beginPath(); data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.strokeStyle = color || tok("--accent", "#c8f53c"); ctx.lineWidth = 1.5; ctx.stroke();
  ctx.lineTo(X(data.length - 1), h); ctx.lineTo(X(0), h); ctx.closePath();
  ctx.fillStyle = "rgba(200,245,60,.07)"; ctx.fill();
  ctx.beginPath(); ctx.arc(X(data.length - 1), Y(data[data.length - 1]), 2.5, 0, 7); ctx.fillStyle = color || tok("--accent", "#c8f53c"); ctx.fill();
}
