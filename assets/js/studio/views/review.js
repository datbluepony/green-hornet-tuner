import { simulateCycle, RPM_AXIS, MAP_AXIS, CYLAIR_AXIS, VEHICLES } from "../model.js";
import { download, hex32 } from "../store.js";
import { icon, fmt, scoreColor } from "../ui.js";
import { hasAcceptedTerms, getWaiver } from "../../site.js";
import { CONFIG } from "../../config.js";

export function render(root, ctx) {
  const { store, toast } = ctx;
  let dest = "export";
  let flashing = false;

  const draw = () => {
    if (flashing) return;
    const s = store.state;
    const ch = store.changes();
    const viol = store.guardViolations();
    const sim = simulateCycle({ ...s, cam: s.project.cam, fuel: s.project.fuel });
    const waiver = getWaiver();
    const auto = [
      { ok: ch.length > 0, label: "Changes staged", d: ch.length ? `${ch.length} changes` : "Nothing to write yet.", hard: true },
      { ok: viol.length === 0, label: "All values inside plan limits", d: viol.length ? viol.slice(0, 3).join(" · ") : `${s.plan === "advanced" ? "Advanced" : "Street"} guardrails pass.`, hard: true },
      { ok: !!s.stock, label: "Stock calibration backed up", d: s.stock ? `${s.stock.name} · ${hex32(s.stock.crc)}` : "Upload your stock read on the Project page.", hard: dest !== "export" },
      { ok: sim.overall >= 65, warn: sim.overall < 80, label: "Simulator score", d: `${sim.overall}/100${sim.worst.value < 100 ? " · weakest: " + sim.worst.label : " · every area passes"}`, hard: true },
      { ok: hasAcceptedTerms(), label: "Terms accepted", d: "Required.", hard: true },
      { ok: s.plan !== "advanced" || !!waiver, label: "Waiver for Advanced limits", d: s.plan === "advanced" ? (waiver ? waiver.id : "Sign it from the sidebar.") : "Not needed on Street.", hard: true },
    ];
    const blocked = auto.some((c) => c.hard && !c.ok);
    const groups = ["Idle", "Limiter", "VE", "Spark"].map((t) => [t, ch.filter((c) => c.table === t)]).filter(([, a]) => a.length);
    root.innerHTML = `
      <div class="view-head">
        <div>
          <span class="eyebrow">Finish</span>
          <h1 style="margin-top:10px">Review &amp; write</h1>
          <p>Nothing leaves this page without your approval. Check the change list, clear the safety checks, then approve. In the preview, a write either exports a change sheet for your flash tool or packages the tune for the mail-in service.</p>
        </div>
      </div>
      <div class="panel stat-row">
        <div class="stat"><span class="k">Changes</span><span class="v">${ch.length}</span><span class="d">${ch.filter((c) => c.kind === "param").length} params · ${ch.filter((c) => c.kind === "cell").length} cells</span></div>
        <div class="stat"><span class="k">Guardrails</span><span class="v" style="color:${viol.length ? "var(--crit-text)" : "var(--good-text)"}">${viol.length ? viol.length : "Pass"}</span><span class="d">${viol.length ? "values outside limits" : s.plan === "advanced" ? "Advanced limits" : "Street limits"}</span></div>
        <div class="stat"><span class="k">Simulator</span><span class="v" style="color:${scoreColor(sim.overall)}">${sim.overall}<small>/100</small></span><span class="d"><a href="#sim" style="text-decoration:underline">Open simulator</a></span></div>
        <div class="stat"><span class="k">Tune checksum</span><span class="v mono" style="font-size:1.2rem;padding-top:8px">${store.tuneChecksum()}</span><span class="d">CRC-32 of all changes</span></div>
      </div>
      <div class="cols cols-main">
        <section class="panel" style="min-width:0">
          <div class="panel-h"><h2>Change list</h2><span class="sub">Stock → new</span></div>
          ${ch.length ? `<div style="max-height:620px;overflow:auto"><table class="changes"><thead><tr><th>Item</th><th class="num" style="text-align:right">Stock</th><th class="num" style="text-align:right">New</th><th class="num" style="text-align:right">Change</th></tr></thead><tbody>
            ${groups.map(([t, arr]) => `<tr><td colspan="4" style="background:var(--surface-2);font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;color:var(--text-3)">${t.toUpperCase()} · ${arr.length}</td></tr>` + arr.slice(0, 80).map((c) => {
              const d = c.kind === "cell" ? c.delta : c.to - c.from;
              return `<tr><td>${fmt.esc(c.name)}</td><td class="num">${fmtv(c.from, c)}</td><td class="num">${fmtv(c.to, c)}</td><td class="num ${d > 0 ? "up" : "down"}">${fmt.sign(d, c.unit === " rpm" ? 0 : 1)}${c.unit.trim()}</td></tr>`;
            }).join("") + (arr.length > 80 ? `<tr><td colspan="4" class="dim">…and ${arr.length - 80} more ${t} cells (all included in the export)</td></tr>` : "")).join("")}
          </tbody></table></div>` : `<div class="empty-state">${icon("info")}<b style="color:var(--text-2)">No changes yet</b><span>Start with <a href="#idle" style="color:var(--accent)">Idle &amp; lope</a>.</span></div>`}
        </section>
        <div class="stack">
          <section class="panel">
            <div class="panel-h"><h2>Write</h2><span class="right"><span class="hw sim"><span class="dot"></span> No ECU attached</span></span></div>
            <div class="panel-b" style="display:grid;gap:14px">
              <div class="seg" role="group" aria-label="Destination" style="width:100%">
                <button style="flex:1" data-dest="export" aria-pressed="${dest === "export"}">Change sheet</button>
                <button style="flex:1" data-dest="mailin" aria-pressed="${dest === "mailin"}">Mail-in</button>
                <button style="flex:1" data-dest="direct" aria-pressed="${dest === "direct"}">Direct (J2534)</button>
              </div>
              <p class="dim" style="font-size:.8rem;line-height:1.5">${dest === "export" ? "Exports an approved change sheet (plus paste-ready multiplier grids) to apply with HP Tuners or EFILive. Your tool handles GM segment checksums." : dest === "mailin" ? "Packages your approved tune for the mail-in service. Ship your ECM and we flash exactly this file, then send it back." : "Direct flashing through a J2534 pass-thru interface is in development. You can rehearse the full write and verify sequence here in simulation."}</p>
              <div class="checklist" style="border:1px solid var(--line);border-radius:12px">${auto.map((c) => `<div class="checkitem"><span class="pill ${c.ok ? (c.warn ? "warn" : "good") : c.hard ? "crit" : "warn"}" style="width:22px;padding:0;justify-content:center">${icon(c.ok ? (c.warn ? "alert" : "check") : "x")}</span><b style="font-weight:600">${c.label}</b><span></span><span class="d">${fmt.esc(c.d)}</span></div>`).join("")}</div>
              <div style="display:grid;gap:10px">
                <label class="check"><input type="checkbox" class="ack"> <span>I reviewed every item in the change list.</span></label>
                <label class="check"><input type="checkbox" class="ack"> <span>I have my stock calibration saved somewhere besides this browser.</span></label>
                ${dest === "direct" ? `<label class="check"><input type="checkbox" class="ack"> <span>A battery maintainer is connected and accessories are off.</span></label>` : ""}
                <label class="check"><input type="checkbox" class="ack"> <span>I accept that this change is <strong>my decision and responsibility</strong>.</span></label>
                <div class="field"><label for="confirm-word">Type <span class="mono" style="color:var(--text)">WRITE</span> to approve</label><input id="confirm-word" class="input mono" autocomplete="off" placeholder="WRITE"></div>
              </div>
              <button class="btn btn-primary" id="approve" disabled>${icon("review")} Approve ${dest === "export" ? "& export" : dest === "mailin" ? "& package for mail-in" : "& run simulated write"}</button>
              ${blocked ? `<p style="font-size:.78rem;color:var(--crit-text)">Clear the red checks above to enable approval.</p>` : ""}
              <div id="flash"></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-h"><h3>ECU recovery</h3></div>
            <div class="panel-b" style="display:grid;gap:10px;font-size:.84rem;color:var(--text-2)">
              <p>If a write is interrupted (dropped cable, low battery), the ECM usually still accepts a full flash:</p>
              <ol style="margin:0;padding-left:18px;display:grid;gap:6px">
                <li>Don't remove power or unplug the ECM. Keep the battery on a maintainer.</li>
                <li>Leave the key ON. Reopen your flash tool and choose its full-write or recovery option.</li>
                <li>Write your <b style="color:var(--text)">stock file</b> (fingerprint ${s.stock ? hex32(s.stock.crc) : "not uploaded"}) first, then confirm the engine starts.</li>
                <li>Still no communication? Stop. Contact your tool's support or use the mail-in service. A bench flash can recover most E38s.</li>
              </ol>
              <button class="btn btn-ghost btn-sm" id="recover" style="width:max-content">${icon("undo")} Rehearse stock recovery</button>
            </div>
          </section>
        </div>
      </div>`;

    root.querySelectorAll("[data-dest]").forEach((b) => b.addEventListener("click", () => { dest = b.dataset.dest; draw(); }));
    const acks = [...root.querySelectorAll(".ack")], word = root.querySelector("#confirm-word"), btn = root.querySelector("#approve");
    const sync = () => { btn.disabled = blocked || !acks.every((a) => a.checked) || word.value.trim().toUpperCase() !== "WRITE"; };
    acks.forEach((a) => a.addEventListener("change", sync)); word.addEventListener("input", sync);
    btn.addEventListener("click", () => approve(ch, sim));
    root.querySelector("#recover").addEventListener("click", () => runFlash(true));
  };

  function approve(ch, sim) {
    const sheet = changeSheet(store, ch, sim);
    store.snapshot(`Approved for ${dest === "export" ? "export" : dest === "mailin" ? "mail-in" : "write"} · ${store.tuneChecksum()}`, false);
    if (dest === "export") {
      download(`${slug(store.state.project.name)}-change-sheet.txt`, sheet, "text/plain");
      download(`${slug(store.state.project.name)}-stagline.json`, store.exportProject(), "application/json");
      toast("Change sheet and project file downloaded.");
    } else if (dest === "mailin") {
      download(`${slug(store.state.project.name)}-mailin-${store.tuneChecksum()}.json`, store.exportProject(), "application/json");
      download(`${slug(store.state.project.name)}-change-sheet.txt`, sheet, "text/plain");
      toast("Tune packaged. Attach both files to your mail-in order.");
      setTimeout(() => (location.href = "mail-in.html#order"), 900);
    } else runFlash(false);
  }

  function runFlash(recovery) {
    flashing = true;
    const host = root.querySelector("#flash");
    const steps = recovery
      ? ["Confirm session (key ON, engine OFF)", "Verify battery ≥ 12.4 V", "Load stock file · fingerprint match", "Erase calibration & operating segments", "Write stock file", "Verify segment checksums", "Key-cycle · ECM reboot"]
      : ["Confirm session & VIN", "Verify battery ≥ 12.4 V", "Back up current calibration", "Erase calibration segments", "Write calibration", "Verify segment checksums", "Key-cycle · reset idle adaptives"];
    host.innerHTML = `<div style="display:grid;gap:12px;padding-top:6px;border-top:1px solid var(--line)"><div style="display:flex;justify-content:space-between;font-size:.86rem"><b>${recovery ? "Recovery rehearsal" : "Simulated write"}</b><span class="mono dim" id="fp">0%</span></div><div class="progress"><i id="fbar"></i></div><div class="flash">${steps.map((s, i) => `<div class="flash-step" data-i="${i}"><span class="ic"></span>${s}</div>`).join("")}</div></div>`;
    let i = 0;
    const tick = () => {
      host.querySelectorAll(".flash-step").forEach((el, k) => { el.className = "flash-step" + (k < i ? " done" : k === i ? " run" : ""); if (k < i) el.querySelector(".ic").innerHTML = icon("check"); });
      host.querySelector("#fbar").style.width = `${(i / steps.length) * 100}%`;
      host.querySelector("#fp").textContent = `${Math.round((i / steps.length) * 100)}%`;
      if (i < steps.length) { i++; setTimeout(tick, i === 5 ? 1600 : 650); }
      else {
        flashing = false;
        host.insertAdjacentHTML("beforeend", `<div class="callout info" style="margin-top:10px">${icon("check")}<span><strong>${recovery ? "Recovery rehearsal complete." : "Simulated write complete."}</strong> No vehicle was changed. Start the engine, let it idle 3 minutes untouched so idle airflow can relearn, then log a short drive.</span></div>`);
        toast(recovery ? "Recovery rehearsal complete." : "Simulated write verified.");
      }
    };
    tick();
  }

  draw();
  return store.on(() => draw());
}

function fmtv(v, c) { return c.unit === " rpm" ? Math.round(v).toLocaleString() : (+v).toFixed(c.table === "VE" ? 2 : 1); }
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "stagline";

function changeSheet(store, ch, sim) {
  const s = store.state, p = s.project, w = getWaiver();
  const L = [];
  const line = (x = "") => L.push(x);
  line(`${CONFIG.brand.toUpperCase()} · APPROVED CHANGE SHEET`);
  line("=".repeat(60));
  line(`Project:        ${p.name} (${p.description || ""})`);
  line(`Engine / ECM:   ${VEHICLES[p.vehicle].label} · ${VEHICLES[p.vehicle].ecm}`);
  line(`Cam:            ${p.cam.label} · ${p.cam.int}/${p.cam.exh} @.050 · LSA ${p.cam.lsa}`);
  line(`Fuel / exhaust: ${p.fuel} · ${p.exhaust} · ${p.trans} · AFM ${p.afm}`);
  line(`Limits:         ${s.plan}${w ? ` · waiver ${w.id}` : ""}`);
  line(`Approved:       ${new Date().toISOString()}`);
  line(`Tune CRC-32:    ${store.tuneChecksum()}`);
  line(`Stock file:     ${s.stock ? `${s.stock.name} · CRC ${hex32(s.stock.crc)} · SHA-256 ${s.stock.sha}` : "NOT PROVIDED"}`);
  line(`Simulator:      ${sim.overall}/100 (${sim.scores.map((x) => `${x.label} ${x.value}`).join(", ")})`);
  line();
  line("Table names differ between tools and operating systems. Find the matching table in your editor and apply each change. Write your stock file first if anything looks wrong.");
  line();
  const params = ch.filter((c) => c.kind === "param");
  if (params.length) {
    line("IDLE & LIMITER PARAMETERS");
    line("-".repeat(60));
    params.forEach((c) => line(`  ${c.name.padEnd(36)} ${String(+c.from.toFixed(1)).padStart(7)} -> ${String(+c.to.toFixed(1)).padStart(7)}${c.unit}`));
    line();
  }
  const grid = (title, delta, rows, rowName, unit, how) => {
    if (!delta.flat().some((d) => Math.abs(d) > 1e-6)) return;
    line(title); line("-".repeat(60)); line(how);
    line(["", ...RPM_AXIS].join("\t"));
    rows.forEach((rv, r) => line([`${rv}`, ...delta[r].map((d) => (Math.abs(d) < 1e-6 ? "0" : d.toFixed(2)))].join("\t")));
    line(`(rows = ${rowName}, columns = RPM, values in ${unit})`);
    line();
  };
  grid("VE TABLE — PERCENT CHANGE PER CELL", s.veDelta, MAP_AXIS, "MAP kPa", "% change", "Copy the grid, select the matching cells in your VE table and use your editor's paste-multiply-by-percent function.");
  grid("SPARK (HIGH OCTANE) — DEGREES TO ADD PER CELL", s.sparkDelta, CYLAIR_AXIS, "cylinder airmass g/cyl", "degrees", "Copy the grid, select the matching cells and use your editor's paste-add function.");
  line("LOCKED (UNCHANGED): cranking fuel, cold-start enrichment, knock detection, emissions diagnostics.");
  line();
  line("This change sheet is provided as-is under the Terms of Service. You approved these changes and are responsible for writing them.");
  return L.join("\n");
}
