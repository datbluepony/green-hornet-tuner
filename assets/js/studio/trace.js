// Oscilloscope-style idle RPM trace with combustion-event ticks.
import { idleRpmAt } from "./model.js";

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
let C;
function colors() {
  if (!C) C = { accent: css("--accent") || "#c8f53c", text3: css("--text-3") || "#6d7768", text2: css("--text-2") || "#a9b2a3", line: "rgba(255,255,255,.06)" };
  return C;
}

export function fitCanvas(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function hash(n) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

export function drawTrace(cv, { t, base, est, window: win = 4, live = false, span = 130 }) {
  if (!cv || !cv.clientWidth) return;
  const { ctx, w, h } = fitCanvas(cv);
  const c = colors();
  const padL = 56, padR = 16, padT = 18, tickH = 34, padB = tickH + 22;
  const plotH = h - padT - padB, plotW = w - padL - padR;
  ctx.clearRect(0, 0, w, h);

  const y = (rpm) => padT + plotH / 2 - ((rpm - base) / span) * (plotH / 2);
  const x = (tt) => padL + ((tt - (t - win)) / win) * plotW;

  // grid
  ctx.strokeStyle = c.line; ctx.lineWidth = 1;
  ctx.font = "11px JetBrains Mono, monospace"; ctx.fillStyle = c.text3; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const d of [-100, -50, 0, 50, 100]) {
    const yy = Math.round(y(base + d)) + 0.5;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
    if (d % 100 === 0) ctx.fillText(String(Math.round(base + d)), padL - 10, yy);
  }
  for (let s = Math.ceil(t - win); s <= t; s++) {
    const xx = Math.round(x(s)) + 0.5;
    ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
  }

  // swing band
  ctx.fillStyle = "rgba(200,245,60,0.06)";
  ctx.fillRect(padL, y(base + est.swing), plotW, y(base - est.swing) - y(base + est.swing));

  // target line
  ctx.setLineDash([4, 5]); ctx.strokeStyle = "rgba(255,255,255,.28)";
  ctx.beginPath(); ctx.moveTo(padL, y(base)); ctx.lineTo(w - padR, y(base)); ctx.stroke(); ctx.setLineDash([]);

  // rpm line
  const N = Math.max(120, Math.floor(plotW / 2));
  ctx.beginPath();
  let last;
  for (let i = 0; i <= N; i++) {
    const tt = t - win + (i / N) * win;
    const r = idleRpmAt(tt, base, est);
    const yy = y(r);
    if (i === 0) ctx.moveTo(x(tt), yy); else ctx.lineTo(x(tt), yy);
    last = [x(tt), yy, r];
  }
  ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
  // area under for depth
  ctx.lineTo(w - padR, padT + plotH); ctx.lineTo(padL, padT + plotH); ctx.closePath();
  const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  g.addColorStop(0, "rgba(200,245,60,.10)"); g.addColorStop(1, "rgba(200,245,60,0)");
  ctx.fillStyle = g; ctx.fill();
  // endpoint
  ctx.beginPath(); ctx.arc(last[0], last[1], 4, 0, Math.PI * 2); ctx.fillStyle = c.accent; ctx.fill();
  ctx.beginPath(); ctx.arc(last[0], last[1], 8, 0, Math.PI * 2); ctx.fillStyle = "rgba(200,245,60,.18)"; ctx.fill();
  ctx.textAlign = "left"; ctx.fillStyle = c.text2;
  ctx.fillText(`${Math.round(last[2])} rpm`, Math.min(last[0] - 70, w - padR - 70), Math.max(padT + 8, last[1] - 16));

  // combustion events strip
  const ty = h - padB + 14;
  ctx.fillStyle = c.text3; ctx.textAlign = "left";
  ctx.fillText("COMBUSTION EVENTS", padL, h - 8);
  ctx.textAlign = "right"; ctx.fillText(live ? "● LIVE AUDIO" : "", w - padR, h - 8);
  const ev = Math.floor((base / 15)); // events per second
  const first = Math.ceil((t - win) * ev), lastE = Math.floor(t * ev);
  const L = est.lope;
  for (let n = first; n <= lastE; n++) {
    const tt = n / ev;
    const phase = (Math.sin(2 * Math.PI * est.lopeHz * tt) + 1) / 2;
    const weak = hash(n) < L * 0.35 * (0.5 + phase);
    const amp = weak ? 0.35 + 0.3 * (1 - L) : Math.min(1, 0.75 + L * 0.35 * (1 - phase) * hash(n + 7));
    const xx = Math.round(x(tt)) + 0.5;
    ctx.strokeStyle = weak ? "rgba(255,255,255,.22)" : "rgba(200,245,60,.7)";
    ctx.beginPath(); ctx.moveTo(xx, ty + tickH - 14); ctx.lineTo(xx, ty + tickH - 14 - amp * (tickH - 14)); ctx.stroke();
  }
}
