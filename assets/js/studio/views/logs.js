import { parseLogCSV, binTrims, recommend, evaluate, sampleLog, toCSV } from "../evaluate.js";
import { RPM_AXIS, MAP_AXIS, limitFor, clamp } from "../model.js";
import { LineChart, SERIES } from "../charts.js";
import { download } from "../store.js";
import { icon, fmt, scoreColor } from "../ui.js";

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

export function render(root, ctx) {
  const { store, toast, shared } = ctx;
  const staged = new Set();
  const charts = [];

  function draw() {
    charts.length = 0;
    const L = shared.log;
    root.innerHTML = `
      <div class="view-head">
        <div>
          <span class="eyebrow">Verify</span>
          <h1 style="margin-top:10px">Data logs</h1>
          <p>Upload a CSV from HP Tuners VCM Scanner, EFILive, Torque Pro or any OBD logger, or use a Bluetooth capture. Stagline bins fuel trims by RPM and load, flags knock, scores idle stability and stages corrections for you to review.</p>
        </div>
        <div class="tools">
          <button class="btn btn-ghost btn-sm" id="sample">${icon("file")} Load sample log</button>
          <label class="btn btn-primary btn-sm" for="csv" style="cursor:pointer">${icon("upload")} Upload CSV</label>
          <input type="file" id="csv" accept=".csv,.txt,text/csv" hidden>
        </div>
      </div>
      ${L ? analysis(L) : empty()}`;
    wire();
    if (L) buildCharts(L);
  }

  function empty() {
    return `<section class="panel"><div class="panel-b" style="display:grid;gap:16px">
      <label class="drop" for="csv" id="drop">${icon("upload")}<b>Drop a data log here</b><span>CSV with a header row. Helpful channels: RPM, MAP, short &amp; long term fuel trims (both banks), timing advance, knock retard, coolant temp, throttle, speed, wideband AFR.</span></label>
      <div class="cols cols-3" style="font-size:.84rem;color:var(--text-2)">
        <div><b style="color:var(--text)">HP Tuners</b><br>VCM Scanner → File → Export → CSV.</div>
        <div><b style="color:var(--text)">EFILive</b><br>Scan Tool → File → Export → CSV.</div>
        <div><b style="color:var(--text)">Bluetooth capture</b><br>Run a test in <a href="#connect" style="color:var(--accent)">Connect &amp; diagnose</a>, then “Analyze in Data logs”.</div>
      </div></div></section>`;
  }

  function analysis(L) {
    const S = L.samples;
    const s = store.state;
    const proj = { ...s.project, idle: s.idle, cam: s.project.cam };
    const ev = evaluate(S, { mode: "drive", dtcs: [], project: proj });
    const recs = recommend(S, s.plan, proj);
    const { mean: tm, n } = binTrims(S);
    const knock = S.filter((x) => (x.knock ?? 0) > 0);
    const dur = (S[S.length - 1].t ?? 0) - (S[0].t ?? 0);
    const trimsAll = S.map((x) => mean([(x.stft1 ?? 0) + (x.ltft1 ?? 0), (x.stft2 ?? 0) + (x.ltft2 ?? 0)]));
    const [c1] = SERIES();
    const hm = (v) => {
      if (v == null) return "";
      const t = clamp(v / 10, -1, 1);
      const mid = [56, 56, 53], pos = [230, 103, 103], neg = [57, 135, 229];
      const to = t >= 0 ? pos : neg, k = Math.abs(t);
      return `background:rgb(${mid.map((m, i) => Math.round(m + (to[i] - m) * k)).join(",")})`;
    };
    return `
      <div class="panel stat-row">
        <div class="stat"><span class="k">Log</span><span class="v" style="font-size:1.15rem;padding-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${fmt.esc(L.name)}</span><span class="d">${S.length.toLocaleString()} samples · ${fmt.n(dur, 0)} s</span></div>
        <div class="stat"><span class="k">Avg fuel trim</span><span class="v">${fmt.sign(mean(trimsAll))}<small>%</small></span><span class="d">Both banks, STFT + LTFT</span></div>
        <div class="stat"><span class="k">Max knock retard</span><span class="v" style="color:${knock.length ? "var(--crit-text)" : "inherit"}">${fmt.n(Math.max(0, ...S.map((x) => x.knock ?? 0)), 1)}<small>°</small></span><span class="d">${knock.length} samples with knock</span></div>
        <div class="stat"><span class="k">Log health</span><span class="v" style="color:${scoreColor(ev.readiness)}">${ev.readiness}<small>/100</small></span><span class="d">${ev.verdict}</span></div>
      </div>
      ${L.warnings?.length ? `<div class="callout warn">${icon("alert")}<span>${L.warnings.map(fmt.esc).join(" ")}</span></div>` : ""}
      <div class="cols cols-main">
        <div class="stack">
          <section class="panel">
            <div class="panel-h"><h3>Fuel trim by cell</h3><span class="sub">Average STFT + LTFT, closed loop · MAP kPa × RPM</span>
              <span class="right legend"><span><i style="background:#3987e5"></i>Pulling fuel</span><span><i style="background:#e66767"></i>Adding fuel</span></span></div>
            <div class="panel-b heatwrap">
              <table class="heat" aria-label="Fuel trim heat map">
                <thead><tr><th></th>${RPM_AXIS.map((r) => `<th>${r >= 1000 ? (r / 1000).toFixed(1) + "k" : r}</th>`).join("")}</tr></thead>
                <tbody>${MAP_AXIS.map((m, r) => ({ m, r })).reverse().map(({ m, r }) => `<tr><th>${m}</th>${RPM_AXIS.map((_, c) => { const v = tm[r][c]; return `<td class="${v == null ? "empty" : ""}" style="${hm(v)}" title="${v == null ? "No data" : `${RPM_AXIS[c]} rpm · ${m} kPa: ${fmt.sign(v)}% over ${n[r][c]} samples`}">${v == null ? "" : Math.round(v)}</td>`; }).join("")}</tr>`).join("")}</tbody>
              </table>
            </div>
          </section>
          <section class="panel">
            <div class="panel-h"><h3>Engine speed</h3><span class="sub">rpm over the log</span></div>
            <div class="panel-b" style="padding-top:8px"><div class="chart-box" style="height:170px"><canvas id="l-rpm"></canvas></div></div>
          </section>
          <section class="panel">
            <div class="panel-h"><h3>Total fuel trim</h3><span class="sub">% · both banks averaged</span></div>
            <div class="panel-b" style="padding-top:8px"><div class="chart-box" style="height:150px"><canvas id="l-trim"></canvas></div></div>
          </section>
        </div>
        <div class="stack">
          <section class="panel">
            <div class="panel-h"><h3>Assistant recommendations</h3><span class="sub">Staged changes need your review</span></div>
            ${recs.length ? recs.map((r) => `
              <div class="rec">
                <h4>${r.severity === "crit" ? `<span class="pill crit">${icon("alert")} Safety</span>` : `<span class="pill neutral">${r.kind === "ve" ? "VE" : r.kind === "spark" ? "Spark" : "Idle"}</span>`} ${fmt.esc(r.title)}</h4>
                <p>${fmt.esc(r.detail)}<br><span class="conf">Confidence ${Math.round(r.confidence * 100)}%${r.cells ? ` · ${r.cells.length} cells` : ""}</span></p>
                <div class="act">${staged.has(r.id) ? `<span class="pill good">${icon("check")} Staged</span>` : `<button class="btn btn-ghost btn-sm" data-stage="${r.id}">Stage</button>`}</div>
              </div>`).join("") : `<div class="empty-state">${icon("check")}<span>No corrections needed from this log.</span></div>`}
            <div class="panel-b" style="border-top:1px solid var(--line);font-size:.76rem;color:var(--text-3)">Recommendations are rule-based and clamped to your ${s.plan === "advanced" ? "Advanced" : "Street"} limits. Staging creates an undoable edit and a backup. Nothing is written to a vehicle.</div>
          </section>
          <section class="panel">
            <div class="panel-h"><h3>Findings</h3></div>
            <div class="checklist">${ev.checks.map((c) => `<div class="checkitem"><span class="pill ${c.status}" style="width:22px;padding:0;justify-content:center">${icon(c.status === "good" ? "check" : c.status === "crit" ? "x" : "alert")}</span><b style="font-weight:600">${c.label}</b><span></span><span class="d">${c.detail}</span></div>`).join("")}</div>
          </section>
          <section class="panel">
            <div class="panel-h"><h3>Channels found</h3><span class="right"><button class="btn btn-quiet btn-sm" id="dlcsv">${icon("download")} CSV</button></span></div>
            <div class="panel-b mono" style="font-size:.74rem;color:var(--text-2);display:grid;grid-template-columns:auto 1fr;gap:4px 14px">${Object.keys(L.columns || {}).length ? Object.entries(L.columns).map(([k, v]) => `<span class="dim">${k}</span><span>${fmt.esc(v)}</span>`).join("") : `<span class="dim">source</span><span>Stagline capture</span>`}</div>
          </section>
        </div>
      </div>`;
  }

  function buildCharts(L) {
    const S = L.samples;
    const step = Math.max(1, Math.floor(S.length / 800));
    const ds = S.filter((_, i) => i % step === 0);
    const [c1, c2] = SERIES();
    const x = ds.map((s) => s.t ?? 0);
    const xt = [0, Math.floor(ds.length / 4), Math.floor(ds.length / 2), Math.floor((3 * ds.length) / 4), ds.length - 1];
    const maxR = Math.ceil(Math.max(...ds.map((s) => s.rpm)) / 1000) * 1000;
    const rc = root.querySelector("#l-rpm"), tc = root.querySelector("#l-trim");
    if (rc) charts.push(new LineChart(rc, { x, xTicks: xt, xFmt: (v) => `${Math.round(v)} s`, y: [0, maxR], yTicks: 4, yFmt: (v) => Math.round(v).toLocaleString(), series: [{ label: "RPM", data: ds.map((s) => s.rpm), color: c1 }] }));
    if (tc) charts.push(new LineChart(tc, { x, xTicks: xt, xFmt: (v) => `${Math.round(v)} s`, y: [-15, 15], yTicks: 3, yFmt: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}`, refLines: [{ y: 5, label: "+5%" }, { y: -5, label: "−5%" }], series: [{ label: "Total trim", data: ds.map((s) => mean([(s.stft1 ?? 0) + (s.ltft1 ?? 0), (s.stft2 ?? 0) + (s.ltft2 ?? 0)])), color: c2 }] }));
    charts.forEach((c) => c.draw());
  }

  function wire() {
    const inp = root.querySelector("#csv");
    inp.addEventListener("change", () => inp.files[0] && load(inp.files[0]));
    const drop = root.querySelector("#drop");
    if (drop) {
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); e.dataTransfer.files[0] && load(e.dataTransfer.files[0]); });
    }
    root.querySelector("#sample").addEventListener("click", () => { shared.log = { name: "Sample · idle, cruise & one pull", samples: sampleLog(), columns: {}, warnings: [] }; staged.clear(); draw(); toast("Sample log loaded. It's synthetic data with a few problems planted for the assistant to find."); });
    root.querySelector("#dlcsv")?.addEventListener("click", () => download("stagline-log.csv", toCSV(shared.log.samples), "text/csv"));
    root.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => stage(b.dataset.stage)));
  }

  async function load(file) {
    try {
      const text = await file.text();
      const r = parseLogCSV(text);
      if (r.samples.length < 10) throw new Error("The log has fewer than 10 usable rows.");
      shared.log = { name: file.name, ...r };
      staged.clear(); draw();
      toast(`Loaded ${r.samples.length.toLocaleString()} rows from ${file.name}`);
    } catch (e) { toast(e.message, "warn"); }
  }

  function stage(id) {
    const s = store.state;
    const recs = recommend(shared.log.samples, s.plan, { ...s.project, idle: s.idle, cam: s.project.cam });
    const r = recs.find((x) => x.id === id); if (!r) return;
    store.update((st) => {
      if (r.kind === "ve" || r.kind === "spark") {
        const key = r.kind === "ve" ? "veDelta" : "sparkDelta";
        const [lo, hi] = limitFor(r.kind, st.plan);
        r.cells.forEach(({ r: rr, c, delta }) => { st[key][rr][c] = +clamp(st[key][rr][c] + delta, lo, hi).toFixed(2); });
      } else if (r.idle) {
        for (const [k, v] of Object.entries(r.idle)) { const [lo, hi] = limitFor(k, st.plan); st.idle[k] = clamp(v, lo, hi); }
      }
    }, `Assistant: ${r.title}`);
    staged.add(id);
    toast("Staged. Check it in the simulator, then Review & write.");
    draw();
  }

  draw();
  return () => {};
}
