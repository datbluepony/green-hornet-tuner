import { VEHICLES, CAMS, overlap, camFactor, idleEstimate, simulateCycle } from "../model.js";
import { crc32, hex32, sha256 } from "../store.js";
import { icon, fmt, scoreColor } from "../ui.js";
import { hasAcceptedTerms, getWaiver } from "../../site.js";

export function render(root, ctx) {
  const { store, toast } = ctx;
  const draw = () => {
    const s = store.state, p = s.project;
    const est = idleEstimate(s.idle, p.cam);
    const sim = simulateCycle({ ...s, cam: p.cam, fuel: p.fuel });
    const changes = store.changes();
    const last = store.backups[0];
    const ov = overlap(p.cam), cf = camFactor(p.cam);
    const veh = VEHICLES[p.vehicle];
    const diag = s.diag;
    const checks = [
      { ok: hasAcceptedTerms(), label: "Terms accepted", d: "Required to use the Studio." },
      { ok: !!s.stock, label: "Stock calibration backed up", d: s.stock ? `${s.stock.name} · ${hex32(s.stock.crc)}` : "Upload your stock read below. It becomes your recovery point.", warn: !s.stock },
      { ok: !!diag && diag.readiness >= 80, label: "Engine health checked", d: diag ? `${diag.verdict} · ${diag.readiness}/100 (${diag.source})` : "Run an idle test over Bluetooth or upload a log.", warn: !diag || diag.readiness < 80, go: "connect" },
      { ok: sim.overall >= 80, label: "Simulator score 80+", d: `Current tune scores ${sim.overall}/100.${sim.worst.value < 100 ? " Weakest area: " + sim.worst.label + "." : ""}`, warn: sim.overall < 80, go: "sim" },
      { ok: s.plan === "street" || !!getWaiver(), label: s.plan === "advanced" ? "Waiver signed for Advanced" : "Street limits active", d: s.plan === "advanced" ? (getWaiver()?.id || "Required") : "Every change stays inside the Street safe band." },
    ];
    root.innerHTML = `
      <div class="view-head">
        <div>
          <span class="eyebrow">Project</span>
          <h1 style="margin-top:10px">${fmt.esc(p.name)}</h1>
          <p>${fmt.esc(p.description || "")} · ${veh.label} · ${veh.ecm} ECM</p>
        </div>
        <div class="tools">
          <a class="btn btn-ghost btn-sm" href="#connect">${icon("connect")} Diagnose</a>
          <a class="btn btn-primary btn-sm" href="#idle">${icon("idle")} Tune the idle</a>
        </div>
      </div>

      <div class="panel stat-row">
        <div class="stat"><span class="k">Lope estimate</span><span class="v">${Math.round(est.lope * 100)}<small>%</small></span><span class="d">Cam allows up to ~${Math.round(Math.min(1, cf) * 100)}%</span></div>
        <div class="stat"><span class="k">Simulator score</span><span class="v" style="color:${scoreColor(sim.overall)}">${sim.overall}<small>/100</small></span><span class="d">${sim.worst.value >= 100 ? "Every area passes" : "Weakest: " + sim.worst.label}</span></div>
        <div class="stat"><span class="k">Staged changes</span><span class="v">${changes.length}</span><span class="d">${changes.filter((c) => c.kind === "param").length} parameters · ${changes.filter((c) => c.kind === "cell").length} table cells</span></div>
        <div class="stat"><span class="k">Last backup</span><span class="v" style="font-size:1.3rem;padding-top:8px">${last ? fmt.ago(last.at) : "—"}</span><span class="d">${last ? fmt.esc(last.label) : "None yet"}</span></div>
      </div>

      <div class="cols cols-main">
        <div class="stack">
          <section class="panel">
            <div class="panel-h"><h2>Vehicle &amp; combo</h2><span class="sub">The simulator and guardrails use these.</span></div>
            <div class="panel-b" style="display:grid;gap:16px">
              <div class="cols cols-2" style="gap:14px">
                <div class="field"><label for="o-name">Project name</label><input id="o-name" class="input" value="${fmt.esc(p.name)}"></div>
                <div class="field"><label for="o-desc">Notes</label><input id="o-desc" class="input" value="${fmt.esc(p.description || "")}"></div>
              </div>
              <div class="field"><label for="o-veh">Engine &amp; ECM</label>
                <select id="o-veh" class="select">${Object.entries(VEHICLES).map(([k, v]) => `<option value="${k}" ${k === p.vehicle ? "selected" : ""} ${v.support === "planned" ? "disabled" : ""}>${v.label}${v.support === "planned" ? " · coming soon" : ""}</option>`).join("")}</select>
              </div>
              <div class="cols cols-4" style="gap:14px">
                <div class="field"><label for="o-fuel">Fuel</label><select id="o-fuel" class="select">${["87", "89", "91", "93", "E85"].map((f) => `<option ${f === p.fuel ? "selected" : ""}>${f}</option>`).join("")}</select></div>
                <div class="field"><label for="o-exh">Exhaust</label><select id="o-exh" class="select">${[["open", "Open headers"], ["longtube", "Headers + mufflers"], ["stock", "Stock manifolds"]].map(([k, l]) => `<option value="${k}" ${k === p.exhaust ? "selected" : ""}>${l}</option>`).join("")}</select></div>
                <div class="field"><label for="o-trans">Transmission</label><select id="o-trans" class="select">${["4L60E", "4L80E", "6L80E", "Manual"].map((t) => `<option ${t === p.trans ? "selected" : ""}>${t}</option>`).join("")}</select></div>
                <div class="field"><label for="o-afm">AFM / DoD</label><select id="o-afm" class="select">${[["disabled", "Disabled"], ["active", "Active"]].map(([k, l]) => `<option value="${k}" ${k === p.afm ? "selected" : ""}>${l}</option>`).join("")}</select></div>
              </div>
              ${p.afm === "active" && cf > 0.5 ? `<div class="callout warn">${icon("alert")}<span><strong>AFM with an aftermarket cam.</strong> Most cam swaps disable Active Fuel Management, and many also need AFM hardware removed. Check with your cam supplier.</span></div>` : ""}
              <div style="border-top:1px solid var(--line);padding-top:16px;display:grid;gap:14px">
                <div class="field"><label for="o-cam">Camshaft</label><select id="o-cam" class="select">${Object.entries(CAMS).map(([k, c]) => `<option value="${k}" ${k === p.camKey ? "selected" : ""}>${c.label}</option>`).join("")}</select></div>
                <div class="cols cols-4" style="gap:14px">
                  ${[["int", "Intake dur. @.050", "°"], ["exh", "Exhaust dur. @.050", "°"], ["lsa", "Lobe separation", "°"], ["liftI", "Intake lift", "in"]].map(([k, l, u]) => `<div class="field"><label for="o-cam-${k}">${l}</label><input id="o-cam-${k}" class="input mono" type="number" step="${k === "liftI" ? 0.001 : 1}" value="${p.cam[k]}" ${p.camKey === "custom" ? "" : "readonly"}></div>`).join("")}
                </div>
                <div style="display:grid;gap:8px">
                  <div style="display:flex;justify-content:space-between;font-size:.85rem"><span class="muted">Overlap @ .050": <b class="mono" style="color:var(--text)">${fmt.sign(ov, 0)}°</b></span><span class="muted">Lope potential <b class="mono" style="color:var(--text)">${Math.round(Math.min(1, cf) * 100)}%</b></span></div>
                  <div class="meter" style="--p:${Math.min(100, cf * 80)}%"><span class="mk"></span></div>
                  <span class="dim" style="font-size:.78rem">${p.camKey === "custom" ? "Enter the numbers from your cam card." : "Typical published specs. Choose “Custom” to enter your exact cam card."} Lope comes from overlap. A tune can bring it out, not create it.</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <div class="panel-h"><h2>Readiness</h2><span class="right"><span class="pill ${checks.every((c) => c.ok) ? "good" : "warn"}">${checks.filter((c) => c.ok).length}/${checks.length}</span></span></div>
            <div class="checklist">${checks.map((c) => `
              <div class="checkitem"><span class="pill ${c.ok ? "good" : c.warn ? "warn" : "neutral"}" style="width:22px;padding:0;justify-content:center">${icon(c.ok ? "check" : "alert")}</span><b style="font-weight:600">${c.label}</b>${c.go && !c.ok ? `<a class="btn btn-quiet btn-sm" href="#${c.go}">Open</a>` : "<span></span>"}<span class="d">${fmt.esc(c.d)}</span></div>`).join("")}
            </div>
          </section>

          <section class="panel">
            <div class="panel-h"><h2>Stock calibration</h2><span class="sub">Recovery point</span></div>
            <div class="panel-b" style="display:grid;gap:14px">
              ${s.stock ? `
                <div class="checklist" style="border:1px solid var(--line);border-radius:12px">
                  ${s.stock.checks.map((c) => `<div class="checkitem"><span class="pill ${c.status}" style="width:22px;padding:0;justify-content:center">${icon(c.status === "good" ? "check" : "alert")}</span><span>${c.label}</span><span class="mono dim" style="font-size:.74rem">${fmt.esc(c.value)}</span></div>`).join("")}
                </div>
                <div class="mono dim" style="font-size:.68rem;word-break:break-all">SHA-256 ${s.stock.sha}</div>` : ""}
              <label class="drop" id="drop" tabindex="0">
                ${icon("upload")}
                <b>${s.stock ? "Replace stock file" : "Drop your stock .bin read here"}</b>
                <span>Raw ECM read from HP Tuners, EFILive or a bench tool. Encrypted formats (.hpt, .ctz) can't be read. Files stay in your browser.</span>
                <input type="file" id="bin" accept=".bin,.BIN,application/octet-stream" hidden>
              </label>
              <p class="dim" style="font-size:.76rem;line-height:1.5">Stagline fingerprints the file (size, CRC-32, SHA-256, blank-region scan) so you can always prove which file you started from. Your flashing tool verifies and corrects GM segment checksums when it writes.</p>
            </div>
          </section>
        </div>
      </div>`;

    // wiring
    const upd = (fn, label) => store.update(fn, label);
    root.querySelector("#o-name").addEventListener("change", (e) => upd((s) => (s.project.name = e.target.value.trim() || "Untitled"), "Renamed project"));
    root.querySelector("#o-desc").addEventListener("change", (e) => upd((s) => (s.project.description = e.target.value), "Edited notes"));
    root.querySelector("#o-veh").addEventListener("change", (e) => upd((s) => (s.project.vehicle = e.target.value), "Changed vehicle"));
    root.querySelector("#o-fuel").addEventListener("change", (e) => upd((s) => (s.project.fuel = e.target.value), "Changed fuel"));
    root.querySelector("#o-exh").addEventListener("change", (e) => { upd((s) => (s.project.exhaust = e.target.value), "Changed exhaust"); ctx.audio.set({ exhaust: e.target.value === "open" ? "open" : "muffled" }); });
    root.querySelector("#o-trans").addEventListener("change", (e) => upd((s) => (s.project.trans = e.target.value), "Changed transmission"));
    root.querySelector("#o-afm").addEventListener("change", (e) => upd((s) => (s.project.afm = e.target.value), "Changed AFM setting"));
    root.querySelector("#o-cam").addEventListener("change", (e) => upd((s) => { s.project.camKey = e.target.value; if (e.target.value !== "custom") s.project.cam = { ...CAMS[e.target.value] }; }, "Changed camshaft"));
    ["int", "exh", "lsa", "liftI"].forEach((k) => root.querySelector(`#o-cam-${k}`).addEventListener("change", (e) => upd((s) => (s.project.cam[k] = +e.target.value), "Edited cam card")));

    const drop = root.querySelector("#drop"), inp = root.querySelector("#bin");
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) ingest(e.dataTransfer.files[0]); });
    inp.addEventListener("change", () => inp.files[0] && ingest(inp.files[0]));
  };

  async function ingest(file) {
    if (/\.(hpt|ctz|ctd)$/i.test(file.name)) { toast("That's an encrypted tuner file. Export a raw .bin instead.", "warn"); return; }
    if (file.size > 8 * 1024 * 1024) { toast("That file is too large to be an ECM read.", "warn"); return; }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const veh = VEHICLES[store.state.project.vehicle];
    let ff = 0, zz = 0;
    for (let i = 0; i < bytes.length; i++) { if (bytes[i] === 0xff) ff++; else if (bytes[i] === 0) zz++; }
    const blankPct = ((ff + zz) / bytes.length) * 100;
    const crc = crc32(bytes);
    const sha = await sha256(buf);
    const checks = [
      { label: "File size", value: `${bytes.length.toLocaleString()} B`, status: bytes.length === veh.binSize ? "good" : "warn" },
      { label: `Matches ${veh.ecm} size`, value: bytes.length === veh.binSize ? "Yes" : `Expected ${veh.binSize.toLocaleString()} B`, status: bytes.length === veh.binSize ? "good" : "warn" },
      { label: "Not blank", value: `${blankPct.toFixed(1)}% erased`, status: blankPct > 97 ? "crit" : blankPct > 80 ? "warn" : "good" },
      { label: "CRC-32", value: hex32(crc), status: "good" },
    ];
    const verdict = checks.some((c) => c.status === "crit") ? "crit" : checks.some((c) => c.status === "warn") ? "warn" : "good";
    store.update((s) => { s.stock = { name: file.name, size: bytes.length, crc, sha, at: new Date().toISOString(), checks, verdict }; }, `Stock file ${file.name}`, { history: false });
    store.snapshot(`Stock file fingerprinted · ${file.name}`, false);
    toast(verdict === "good" ? `Stock file saved as your recovery point · ${hex32(crc)}` : "File saved, but some checks need a look.", verdict === "good" ? "info" : "warn");
  }

  draw();
  return store.on(() => draw());
}
