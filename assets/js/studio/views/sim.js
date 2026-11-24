import { simulateCycle, zeros, RPM_AXIS, MAP_AXIS, CYLAIR_AXIS } from "../model.js";
import { LineChart, SERIES } from "../charts.js";
import { icon, fmt, scoreColor } from "../ui.js";

const FIX = {
  "Startability": "Bring idle airflow trim back toward 0% or above, and keep the P/N target at 760 rpm or higher.",
  "Idle quality": "Reduce lope a step: raise idle spark 1–2° or raise stability correction.",
  "Stall margin (in gear)": "Raise the in-gear idle target 25 rpm and keep idle spark at 15° or more for reserve.",
  "Cruise fueling": "Your VE edits disagree with the engine at cruise. Re-log and let the assistant correct the cruise cells.",
  "WOT air/fuel": "High-load VE edits moved WOT AFR out of the safe window. Undo them or correct them from a wideband log.",
  "Knock margin": "Pull the added high-load timing, or run higher-octane fuel.",
};

export function render(root, ctx) {
  const { store } = ctx;
  let res, base, cursor = 0, playing = false, raf = 0, speed = 1, last = 0;
  const charts = {};

  const compute = () => {
    const s = store.state;
    res = simulateCycle({ ...s, cam: s.project.cam, fuel: s.project.fuel });
    base = simulateCycle({ idle: store.baselineIdle(), cam: s.project.cam, fuel: s.project.fuel, veDelta: zeros(MAP_AXIS.length, RPM_AXIS.length), sparkDelta: zeros(CYLAIR_AXIS.length, RPM_AXIS.length), revLimit: 6000 });
  };

  const shell = () => {
    const [c1, c2] = SERIES();
    root.innerHTML = `
      <div class="view-head">
        <div>
          <span class="eyebrow">Verify</span>
          <h1 style="margin-top:10px">Tune simulator</h1>
          <p>Runs your calibration through a 48-second drive cycle: crank, warm idle, Drive with the A/C on, cruise, a wide-open pull and decel. Compare it with the baseline before anything gets near your truck.</p>
        </div>
        <div class="tools">
          <div class="seg" role="group" aria-label="Playback speed"><button data-sp="1" aria-pressed="true">1×</button><button data-sp="2" aria-pressed="false">2×</button><button data-sp="4" aria-pressed="false">4×</button></div>
          <button class="btn btn-primary btn-sm" id="run">${icon("play")} Run drive cycle</button>
        </div>
      </div>
      <section class="panel">
        <div class="panel-b" style="display:grid;gap:12px">
          <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px" id="phases"></div>
          <div class="progress"><i id="prog"></i></div>
        </div>
      </section>
      <div class="cols cols-main">
        <div class="stack">
          <section class="panel">
            <div class="panel-h"><h3>Engine speed</h3><span class="sub">rpm</span><span class="right legend"><span><i style="background:${c1}"></i>Your tune</span><span style="color:${c2}"><i class="dash" style="background:${c2}"></i><span style="color:var(--text-2)">Baseline</span></span></span></div>
            <div class="panel-b" style="padding-top:8px"><div class="chart-box" style="height:220px"><canvas id="c-rpm"></canvas></div></div>
          </section>
          <section class="panel">
            <div class="panel-h"><h3>Air / fuel ratio</h3><span class="sub">gasoline AFR · lower is richer</span><span class="right legend"><span><i style="background:${c1}"></i>Your tune</span><span style="color:${c2}"><i class="dash" style="background:${c2}"></i><span style="color:var(--text-2)">Baseline</span></span></span></div>
            <div class="panel-b" style="padding-top:8px"><div class="chart-box"><canvas id="c-afr"></canvas></div></div>
          </section>
          <section class="panel">
            <div class="panel-h"><h3>Spark advance &amp; knock retard</h3><span class="sub">degrees</span><span class="right legend"><span><i style="background:${c1}"></i>Spark</span><span><i style="background:var(--crit)"></i>Predicted knock retard</span></span></div>
            <div class="panel-b" style="padding-top:8px"><div class="chart-box"><canvas id="c-spark"></canvas></div></div>
          </section>
        </div>
        <div class="stack">
          <section class="panel" id="scorecard"></section>
          <section class="panel" id="fixes"></section>
        </div>
      </div>`;
    root.querySelector("#run").addEventListener("click", play);
    root.querySelectorAll("[data-sp]").forEach((b) => b.addEventListener("click", () => { speed = +b.dataset.sp; root.querySelectorAll("[data-sp]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
  };

  const build = () => {
    compute();
    const [c1, c2] = SERIES();
    const x = res.series.t;
    const idx = (t) => Math.round(t / 0.05);
    const bands = res.phases.map(([a, b, label]) => ({ from: idx(a), to: idx(b), label }));
    const xTicks = [0, 10, 20, 30, 40, 48].map(idx);
    const common = { x, bands, xTicks, xFmt: (v) => `${(+v).toFixed(v % 1 ? 1 : 0)} s` };
    const afr = (arr) => arr.map((l) => Math.min(16.5, l * 14.7));
    const mk = (id, o) => { if (charts[id]) charts[id].set(o); else charts[id] = new LineChart(root.querySelector(id), o); };
    mk("#c-rpm", { ...common, showBandLabels: true, y: [0, 6400], yTicks: 4, yFmt: (v) => Math.round(v).toLocaleString(), series: [{ label: "Baseline", data: base.series.rpm, color: c2, dash: [5, 4], width: 1.5, alpha: 0.8 }, { label: "Your tune", data: res.series.rpm, color: c1 }] });
    mk("#c-afr", { ...common, y: [11, 16.5], yTicks: 5, yFmt: (v) => v.toFixed(1), refLines: [{ y: 14.7, label: "Stoich 14.7" }, { y: 12.7, label: "WOT target 12.7" }], series: [{ label: "Baseline", data: afr(base.series.lambda), color: c2, dash: [5, 4], width: 1.5, alpha: 0.8 }, { label: "Your tune", data: afr(res.series.lambda), color: c1 }] });
    mk("#c-spark", { ...common, y: [0, 45], yTicks: 3, yFmt: (v) => `${Math.round(v)}°`, vFmt: (v) => `${v.toFixed(1)}°`, series: [{ label: "Spark", data: res.series.spark, color: c1 }, { label: "Knock retard", data: res.series.knock, color: getComputedStyle(document.documentElement).getPropertyValue("--crit").trim() || "#d03b3b", fill: "rgba(208,59,59,.18)" }] });
    setCursor(playing ? cursor : res.series.t.length - 1);
    renderScores();
  };

  function setCursor(i) {
    cursor = i;
    Object.values(charts).forEach((c) => { c.o.cursor = i; c.draw(); });
    const n = res.series.t.length - 1;
    root.querySelector("#prog").style.width = `${(i / n) * 100}%`;
    const t = res.series.t[i];
    root.querySelector("#phases").innerHTML = res.phases.map(([a, b, l]) => {
      const st = t >= b ? "done" : t >= a ? "run" : "";
      return `<div style="padding:8px 10px;border-radius:9px;border:1px solid ${st === "run" ? "rgba(200,245,60,.55)" : "var(--line)"};background:${st === "run" ? "var(--accent-soft)" : st === "done" ? "rgba(255,255,255,.03)" : "transparent"};font-size:.74rem;color:${st ? "var(--text)" : "var(--text-3)"};min-width:0"><div class="mono" style="font-size:.62rem;color:var(--text-3)">${a}–${b}s</div><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l}</div></div>`;
    }).join("");
  }

  function renderScores() {
    const sc = root.querySelector("#scorecard");
    const sm = res.summary;
    sc.innerHTML = `
      <div class="panel-h"><h3>Scorecard</h3><span class="right"><span class="pill ${res.overall >= 85 ? "good" : res.overall >= 65 ? "warn" : "crit"}">${res.overall >= 85 ? "Ready to review" : res.overall >= 65 ? "Review warnings" : "Not recommended"}</span></span></div>
      <div style="display:flex;gap:20px;align-items:center;padding:18px">
        <div class="score-ring" style="--v:${res.overall};--c:${scoreColor(res.overall)}"><b>${res.overall}</b><small>OVERALL</small></div>
        <div style="display:grid;gap:8px;font-size:.84rem;color:var(--text-2)">
          <div>Lope <b class="mono" style="color:var(--text)">${Math.round(sm.lope * 100)}%</b> (baseline ${Math.round(base.summary.lope * 100)}%)</div>
          <div>Lowest in-gear RPM <b class="mono" style="color:var(--text)">${Math.round(sm.minRpmDrive)}</b></div>
          <div>WOT AFR <b class="mono" style="color:var(--text)">${sm.wotAfrRich.toFixed(1)}–${sm.wotAfrLean.toFixed(1)}</b></div>
          <div>Est. WOT torque <b class="mono" style="color:var(--text)">${fmt.sign(sm.torquePct, 1)}%</b> <span class="dim">(model estimate)</span></div>
        </div>
      </div>
      <div class="scores" style="border-top:1px solid var(--line)">${res.scores.map((s) => `
        <div class="score"><span class="n">${s.label} <span class="pill ${s.status}">${s.status === "good" ? "Good" : s.status === "warn" ? "Check" : s.status === "serious" ? "Caution" : "Risk"}</span></span><span class="v">${s.value}</span>
          <div class="bar"><i style="width:${Math.max(2, s.value)}%;background:${scoreColor(s.value)}"></i></div><span class="d">${s.detail}</span></div>`).join("")}</div>`;
    const fx = root.querySelector("#fixes");
    const weak = res.scores.filter((s) => s.value < 85);
    fx.innerHTML = `<div class="panel-h"><h3>${weak.length ? "How to improve" : "Looks good"}</h3></div>
      <div class="panel-b" style="display:grid;gap:12px;font-size:.86rem;color:var(--text-2)">
        ${weak.length ? weak.map((s) => `<div class="finding" style="border-color:${scoreColor(s.value)}"><b>${s.label}</b><span>${FIX[s.label]}</span></div>`).join("") : `<p>Every area scores 85 or better. Head to <a href="#review" style="color:var(--accent)">Review &amp; write</a> to approve the change list.</p>`}
        <p class="dim" style="font-size:.76rem">Simplified engineering model. It shows the direction and rough size of an effect, not a guarantee. Always confirm with a real data log.</p>
      </div>`;
  }

  function play() {
    cancelAnimationFrame(raf);
    playing = true; cursor = 0; last = performance.now();
    const n = res.series.t.length - 1;
    const step = (now) => {
      const dt = (now - last) / 1000; last = now;
      cursor = Math.min(n, cursor + dt * 80 * speed);
      setCursor(Math.floor(cursor));
      if (cursor < n) raf = requestAnimationFrame(step); else playing = false;
    };
    raf = requestAnimationFrame(step);
  }

  shell();
  build();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) play();
  const off = store.on(() => build());
  return () => { cancelAnimationFrame(raf); off(); };
}
