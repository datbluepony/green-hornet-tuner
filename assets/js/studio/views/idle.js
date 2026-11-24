import { LOPE_PRESETS, idleEstimate, limitFor, clamp } from "../model.js";
import { drawTrace } from "../trace.js";
import { icon, fmt, paramHTML, bindParam, scoreColor } from "../ui.js";

const PARAMS = [
  { key: "rpmPark", name: "Idle target · Park / Neutral", help: "The RPM the ECM aims for when stopped in P/N. Lower makes each firing pulse slower and heavier. Too low and a big cam struggles to pull clean vacuum.", d: 0 },
  { key: "rpmDrive", name: "Idle target · In gear", help: "Keep this high enough to carry the converter and A/C load. Most of the stall margin lives here, so lope tunes usually leave it 40–60 rpm under the P/N target.", d: 0 },
  { key: "sparkIdle", name: "Idle spark advance", help: "Less timing gives a lazier, choppier burn. That's the main lope lever. Below ~14° exhaust heat climbs and the ECM has less timing in reserve to catch a sag.", d: 1 },
  { key: "stability", name: "Idle spark stability correction", help: "How hard the ECM uses spark to smooth each RPM dip. 100% is stock-smooth. Lower lets the cam's natural rhythm through. The airflow controller still holds the idle up.", d: 0 },
  { key: "airflow", name: "Idle airflow trim", help: "Adds or removes base idle air. A little extra helps a low-vacuum cam idle and restart. Removing air raises stall risk, so it's capped at −5% on Street.", d: 1 },
  { key: "enrich", name: "Idle fueling enrichment", help: "A touch richer at idle keeps the chop crisp and helps the O2 sensors tolerate open-header reversion. More than ~3% just wastes fuel.", d: 1 },
];

export function render(root, ctx) {
  const { store, toast, audio } = ctx;
  let preview = { ...store.state.idle };
  let raf = 0, t0 = performance.now();
  let selfCommit = false;

  const draw = () => {
    const s = store.state;
    preview = { ...s.idle };
    const base = store.baselineIdle();
    const plan = s.plan;
    root.innerHTML = `
      <div class="view-head">
        <div>
          <span class="eyebrow">Calibrate</span>
          <h1 style="margin-top:10px">Idle &amp; lope</h1>
          <p>Shape how the cam sounds at idle while keeping cranking, cold start and in-gear manners intact. Pick a preset, then fine-tune. Every change shows its predicted effect before you commit.</p>
        </div>
        <div class="tools">
          <div class="seg" role="group" aria-label="Exhaust sound">
            <button data-exh="open" aria-pressed="${audio.exhaust !== "muffled"}">Open headers</button>
            <button data-exh="muffled" aria-pressed="${audio.exhaust === "muffled"}">Muffled</button>
          </div>
          <button class="btn ${audio.running ? "btn-ghost" : "btn-primary"} btn-sm" id="snd">${icon(audio.running ? "pause" : "volume")} ${audio.running ? "Stop sound" : "Listen"}</button>
        </div>
      </div>

      <div class="presetbar" role="group" aria-label="Lope presets">
        ${Object.entries(LOPE_PRESETS).map(([k, p]) => `<button data-preset="${k}" class="${p.advanced && plan !== "advanced" ? "locked" : ""}" aria-pressed="${isPreset(s.idle, p.v)}"><b>${p.advanced && plan !== "advanced" ? icon("lock") + " " : ""}${p.label}</b><span>${p.desc}</span></button>`).join("")}
      </div>

      <div class="cols cols-main">
        <div class="stack">
          <section class="panel">
            <div class="panel-h"><h2>Idle preview</h2><span class="sub">${fmt.esc(s.project.cam.label)} · overlap ${fmt.sign((s.project.cam.int + s.project.cam.exh) / 2 - 2 * s.project.cam.lsa, 0)}°</span>
              <span class="right"><span class="k">Lope</span><b class="mono" id="lope-v" style="font-size:1.1rem">—</b></span></div>
            <div style="padding:14px 18px 0"><div class="meter" id="lope-m"><span class="mk"></span></div></div>
            <div style="height:300px;padding:4px 6px 0"><canvas id="trace" style="width:100%;height:100%" aria-label="Predicted idle RPM trace"></canvas></div>
          </section>
          <section class="panel">
            <div class="panel-h"><h2>Predicted outcome</h2><span class="sub">Compared with the cam-tune baseline</span><span class="right"><a class="btn btn-quiet btn-sm" href="#sim">Full drive cycle ${icon("arrow")}</a></span></div>
            <div class="outcomes" id="outcomes"></div>
          </section>
          <section class="panel">
            <div class="panel-h"><h2>Locked for safety</h2><span class="sub">These keep the truck starting and protected</span></div>
            ${[["Cranking fuel (pulse width vs. coolant)", "Stock"], ["Cold-start & after-start enrichment", "Stock"], ["Startup idle airflow & flare", "Stock + your airflow trim"], ["Knock detection & retard", "Stock"], ["Emissions monitors & DTCs", "Stock"]].map(([n, v]) => `<div class="lock-row">${icon("lock")}<b style="font-weight:500">${n}</b><span>${v}</span></div>`).join("")}
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <div class="panel-h"><h2>Idle parameters</h2><span class="right"><button class="btn btn-quiet btn-sm" id="reset-idle">Reset to baseline</button></span></div>
            ${PARAMS.map((p) => paramHTML({ key: p.key, name: p.name, help: p.help, value: s.idle[p.key], base: base[p.key], plan, decimals: p.d })).join("")}
          </section>
          <section class="panel">
            <div class="panel-h"><h2>Rev limiter</h2><span class="sub">${plan === "advanced" ? "Advanced: 5,000–6,400 rpm" : "Fixed at 6,000 rpm on Street"}</span></div>
            <div class="panel-b" style="display:flex;align-items:center;gap:14px">
              <input class="range" type="range" id="rev" aria-label="Rev limit" min="5000" max="6400" step="50" value="${s.revLimit}" ${plan === "advanced" ? "" : "disabled"} style="flex:1">
              <b class="mono" id="rev-v" style="width:90px;text-align:right">${s.revLimit.toLocaleString()} rpm</b>
            </div>
          </section>
        </div>
      </div>`;

    // wiring
    PARAMS.forEach((p) => bindParam(root, p.key, plan, (v, { commit }) => {
      preview[p.key] = v;
      updatePreview();
      if (commit) { selfCommit = true; store.update((s) => (s.idle[p.key] = v), `${p.name} → ${v}`); }
    }, (k, lim) => toast(`${plan === "advanced" ? "Advanced" : "Street"} limit reached (${lim}).${plan === "advanced" ? "" : " Switch to Advanced for a wider range."}`, "warn")));

    root.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", async () => {
      const pr = LOPE_PRESETS[b.dataset.preset];
      if (pr.advanced && store.state.plan !== "advanced") { toast("The Show preset needs Advanced limits (signed waiver).", "warn"); return; }
      store.update((s) => {
        for (const [k, v] of Object.entries(pr.v)) { const [lo, hi] = limitFor(k, s.plan); s.idle[k] = clamp(v, lo, hi); }
      }, `Lope preset · ${pr.label}`);
      toast(`${pr.label} preset applied. Review it in the outcome panel.`);
    }));
    root.querySelector("#reset-idle").addEventListener("click", () => store.update((s) => (s.idle = store.baselineIdle()), "Reset idle to baseline"));
    root.querySelector("#snd").addEventListener("click", async () => { if (audio.running) audio.stop(); else { await audio.start(); } draw(); });
    root.querySelectorAll("[data-exh]").forEach((b) => b.addEventListener("click", () => { audio.set({ exhaust: b.dataset.exh }); root.querySelectorAll("[data-exh]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
    const rev = root.querySelector("#rev");
    const pct = () => rev.style.setProperty("--pct", `${((rev.value - 5000) / 1400) * 100}%`); pct();
    rev.addEventListener("input", () => { root.querySelector("#rev-v").textContent = `${(+rev.value).toLocaleString()} rpm`; pct(); });
    rev.addEventListener("change", () => store.update((s) => (s.revLimit = +rev.value), `Rev limit → ${rev.value}`));
    updatePreview();
  };

  function updatePreview() {
    const s = store.state;
    const est = idleEstimate(preview, s.project.cam);
    const baseEst = idleEstimate(store.baselineIdle(), s.project.cam);
    audio.set({ rpm: preview.rpmPark, lope: est.lope, lopeHz: est.lopeHz, swing: est.swing });
    const lv = root.querySelector("#lope-v"); if (lv) lv.textContent = `${Math.round(est.lope * 100)}%`;
    const lm = root.querySelector("#lope-m"); if (lm) lm.style.setProperty("--p", `${est.lope * 100}%`);
    const items = [
      { n: "Startability", v: est.startability, b: baseEst.startability, f: (x) => `${Math.round(x)}/100`, good: true },
      { n: "Stall margin in gear", v: 100 - est.stallRisk * 100, b: 100 - baseEst.stallRisk * 100, f: (x) => `${Math.round(x)}/100`, good: true },
      { n: "Lope intensity", v: est.lope * 100, b: baseEst.lope * 100, f: (x) => `${Math.round(x)}%`, neutral: true },
      { n: "Idle swing", v: est.swing, b: baseEst.swing, f: (x) => `±${Math.round(x)} rpm`, neutral: true, scale: 100 },
      { n: "Exhaust heat at long idle", v: 100 - est.heat * 100, b: 100 - baseEst.heat * 100, f: (x) => (x > 85 ? "Normal" : x > 65 ? "Elevated" : "High"), good: true },
      { n: "Idle vacuum", v: est.vacuum, b: baseEst.vacuum, f: (x) => `${Math.round(x)} kPa`, neutral: true, scale: 101 },
    ];
    const oc = root.querySelector("#outcomes");
    if (oc) oc.innerHTML = items.map((it) => {
      const w = it.scale ? (it.v / it.scale) * 100 : it.v;
      const col = it.neutral ? "var(--s1)" : scoreColor(it.v);
      const d = it.v - it.b;
      return `<div class="outcome"><div class="top"><span class="k">${it.n}</span>${!it.neutral ? `<span class="pill ${it.v >= 85 ? "good" : it.v >= 65 ? "warn" : "crit"}">${it.v >= 85 ? "Good" : it.v >= 65 ? "Check" : "Risk"}</span>` : ""}</div><span class="v">${it.f(it.v)} <span class="dim" style="font-size:.75rem">${Math.abs(d) > 0.5 ? `(${d > 0 ? "+" : ""}${Math.round(d)} vs baseline)` : "(baseline)"}</span></span><div class="bar"><i style="width:${clamp(w, 2, 100)}%;background:${col}"></i></div></div>`;
    }).join("");
    root.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(isPreset(preview, LOPE_PRESETS[b.dataset.preset].v))));
  }

  const loop = () => {
    raf = requestAnimationFrame(loop);
    const cv = root.querySelector("#trace");
    if (!cv) return;
    const est = idleEstimate(preview, store.state.project.cam);
    drawTrace(cv, { t: (performance.now() - t0) / 1000, base: preview.rpmPark, est, window: 5, live: audio.running });
  };

  draw();
  loop();
  const off = store.on(() => { if (selfCommit) { selfCommit = false; preview = { ...store.state.idle }; updatePreview(); refreshBases(); return; } draw(); });
  function refreshBases() {
    // update "was" markers without rebuilding sliders
    const base = store.baselineIdle();
    PARAMS.forEach((p) => {
      const row = root.querySelector(`[data-param="${p.key}"] .val`);
      if (!row) return;
      const was = row.querySelector(".was");
      const changed = Math.abs(store.state.idle[p.key] - base[p.key]) > 1e-6;
      if (changed && !was) row.insertAdjacentHTML("afterbegin", `<span class="was">${base[p.key].toFixed(p.d)}</span>`);
      if (!changed && was) was.remove();
    });
  }
  return () => { cancelAnimationFrame(raf); off(); };
}

function isPreset(idle, v) { return Object.entries(v).every(([k, x]) => Math.abs(idle[k] - x) < 1e-6); }
