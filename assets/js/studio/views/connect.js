import { connect, DemoEngine, support } from "../obd.js";
import { evaluate, toCSV, dtcText } from "../evaluate.js";
import { drawTach, drawSpark } from "../charts.js";
import { download } from "../store.js";
import { icon, fmt, scoreColor } from "../ui.js";

// Connection survives view changes.
const conn = { kind: null, name: "", elm: null, demo: null, vin: null, running: false, buf: [], log: [], capture: null, report: null, dtcs: [] };

const GAUGES = [
  ["map", "MAP", "kPa", 0], ["ect", "Coolant", "°C", 0], ["iat", "Intake air", "°C", 0], ["timing", "Timing", "°", 1],
  ["trim1", "Fuel trim B1", "%", 1], ["trim2", "Fuel trim B2", "%", 1], ["volts", "Voltage", "V", 2], ["tps", "Throttle", "%", 0],
];

export function render(root, ctx) {
  const { store, toast, audio } = ctx;
  let uiTimer = 0, alive = true;

  const log = (msg, cls = "") => { conn.log.push({ msg, cls, at: new Date().toLocaleTimeString() }); if (conn.log.length > 60) conn.log.shift(); paintConsole(); };

  function shell() {
    const connected = !!conn.kind;
    root.innerHTML = `
      <div class="view-head">
        <div>
          <span class="eyebrow">Setup</span>
          <h1 style="margin-top:10px">Connect &amp; diagnose</h1>
          <p>Plug a Bluetooth or USB OBD2 adapter into the port under the dash. Stagline reads live data, runs an idle or driving test, and tells you what's safe to tune, what needs fixing first and what to leave alone. It's <b style="color:var(--text)">read-only</b>: it can't change anything in your vehicle.</p>
        </div>
        <div class="tools">${connected ? `<span class="chip"><span class="dot" style="color:${conn.kind === "demo" ? "var(--warn)" : "var(--good)"}"></span> ${fmt.esc(conn.name)}${conn.vin ? ` · VIN …${conn.vin.slice(-6)}` : ""}</span><button class="btn btn-ghost btn-sm" id="disc">Disconnect</button>` : ""}</div>
      </div>
      ${connected ? live() : choose()}
      <div class="cols cols-main">
        <section class="panel" id="report-panel">${reportHTML()}</section>
        <div class="stack">
          <section class="panel"><div class="panel-h"><h3>Adapter log</h3></div><div class="panel-b"><div class="console" id="console" aria-live="polite"></div></div></section>
          <section class="panel"><div class="panel-h"><h3>Compatible adapters</h3></div>
            <div class="panel-b" style="display:grid;gap:10px;font-size:.84rem;color:var(--text-2)">
              <div><b style="color:var(--text)">Bluetooth LE ELM327</b> such as OBDLink CX, Vgate iCar Pro BLE or Veepeak BLE+. Works in Chrome or Edge on Windows, Mac, ChromeOS and Android.</div>
              <div><b style="color:var(--text)">USB ELM327</b> such as OBDLink SX/EX or an FTDI cable. Works in Chrome or Edge on desktop.</div>
              <div class="callout warn" style="font-size:.8rem">${icon("alert")}<span>iPhone and iPad browsers, Firefox and Safari can't reach Bluetooth or USB devices. “Classic” Bluetooth (SPP) adapters don't work in browsers either. Use the log upload instead.</span></div>
            </div></section>
        </div>
      </div>`;
    wire();
    paintConsole();
  }

  function choose() {
    return `<section class="panel"><div class="panel-h"><h2>Choose a connection</h2><span class="sub">Turn the key to ON or start the engine first</span></div>
      <div class="panel-b conn-opts">
        <button class="conn-opt" data-conn="ble" ${support.ble ? "" : "disabled"}>${icon("connect")}<b>Bluetooth OBD2</b><span>${support.ble ? "Pair a BLE ELM327 dongle. Your browser will show nearby devices." : "This browser doesn't support Web Bluetooth. Use Chrome or Edge."}</span></button>
        <button class="conn-opt" data-conn="usb" ${support.serial ? "" : "disabled"}>${icon("usb")}<b>USB adapter</b><span>${support.serial ? "Pick the adapter's serial port. Default 38,400 baud." : "This browser doesn't support Web Serial. Use desktop Chrome or Edge."}</span></button>
        <button class="conn-opt" data-conn="demo">${icon("cpu")}<b>Demo engine</b><span>No adapter? Simulated engine running your current tune. Rev it, add a fault, run the tests.</span></button>
      </div></section>`;
  }

  function live() {
    const demo = conn.kind === "demo";
    const cap = conn.capture;
    return `<div class="cols cols-main-r">
      <section class="panel">
        <div class="panel-h"><h2>Live</h2><span class="sub">${demo ? "Simulated" : "From vehicle"} · ~${demo ? 10 : 2} Hz</span></div>
        <div class="tach-box"><canvas id="tach" aria-label="Tachometer"></canvas></div>
        ${demo ? `<div class="panel-b" style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line)">
          <button class="btn btn-primary btn-sm" id="rev" style="user-select:none;touch-action:none">${icon("spark")} Hold to rev</button>
          <button class="btn btn-ghost btn-sm" id="snd">${icon(audio.running ? "pause" : "volume")} ${audio.running ? "Mute" : "Sound"}</button>
          <label class="switch" style="margin-left:auto"><input type="checkbox" id="leak" ${conn.demo?.faults.vacuumLeak ? "checked" : ""}> Simulate vacuum leak</label>
        </div>` : ""}
      </section>
      <div class="stack">
        <section class="panel"><div class="gauge-grid" id="gauges">${GAUGES.map(([k, n, u]) => `<div class="gauge"><span class="k">${n}</span><span class="v" id="g-${k}">—<small>${u}</small></span><canvas id="s-${k}"></canvas></div>`).join("")}</div></section>
        <section class="panel">
          <div class="panel-h"><h2>Tests</h2><span class="sub">Results appear in the report below</span></div>
          <div class="panel-b" style="display:grid;gap:14px">
            ${cap ? `<div style="display:grid;gap:8px"><div style="display:flex;justify-content:space-between;font-size:.88rem"><b>${cap.mode === "idle" ? "Idle test" : "Driving test"} running…</b><span class="mono dim" id="cap-t">0 s</span></div><div class="progress"><i id="cap-p" style="width:0"></i></div>${cap.mode === "drive" ? `<button class="btn btn-ghost btn-sm" id="cap-stop" style="width:max-content">${icon("stop")} Stop &amp; evaluate</button>` : ""}</div>` : `
            <div class="cols cols-2" style="gap:10px">
              <button class="conn-opt" id="t-idle">${icon("idle")}<b>Idle test · 30 s</b><span>Engine warm, in Park, A/C off. Don't touch the pedal.</span></button>
              <button class="conn-opt" id="t-drive">${icon("sim")}<b>Driving test</b><span>Records until you stop it. A passenger runs the laptop or phone.</span></button>
            </div>
            <p class="dim" style="font-size:.76rem">${icon("alert").replace("<svg", '<svg style="width:12px;height:12px;display:inline;vertical-align:-2px"')} Never operate a phone or laptop while driving. Follow local laws.</p>`}
          </div>
        </section>
      </div>
    </div>`;
  }

  function reportHTML() {
    const r = conn.report;
    if (!r) return `<div class="panel-h"><h2>Evaluation</h2></div><div class="empty-state">${icon("review")}<b style="color:var(--text-2)">No evaluation yet</b><span>Connect, then run the idle test. You'll get a readiness score and a plain list of what's safe, what needs attention and what to avoid.</span></div>`;
    const G = r.groups;
    const grp = (cls, ic, title, items) => `<div class="group ${cls}"><h4>${icon(ic)} ${title}</h4>${items.length ? items.map((f) => `<div class="finding"><b>${f.t}</b><span>${f.d}</span></div>`).join("") : `<span class="dim" style="font-size:.8rem">Nothing here.</span>`}</div>`;
    return `<div class="panel-h"><h2>Evaluation</h2><span class="sub">${r.mode === "idle" ? "Idle test" : "Driving test"} · ${r.stats.n} samples · ${r.source}</span>
        <span class="right"><button class="btn btn-quiet btn-sm" id="dl-cap">${icon("download")} CSV</button><a class="btn btn-ghost btn-sm" href="#logs" id="to-logs">Analyze in Data logs</a></span></div>
      <div class="report-head">
        <div class="score-ring" style="--v:${r.readiness};--c:${scoreColor(r.readiness)}"><b>${r.readiness}</b><small>READINESS</small></div>
        <div style="display:grid;gap:6px"><span class="pill ${r.tone}" style="width:max-content">${r.verdict}</span>
          <div class="mono" style="font-size:.8rem;color:var(--text-2);display:grid;grid-template-columns:auto auto;gap:4px 16px">
            <span class="dim">Idle</span><span>${fmt.n(r.stats.rpm)} rpm ±${fmt.n(r.stats.rpmStd, 0)}</span>
            <span class="dim">Trims B1 / B2</span><span>${fmt.sign(r.stats.b1)}% / ${fmt.sign(r.stats.b2)}%</span>
            <span class="dim">MAP</span><span>${fmt.n(r.stats.map)} kPa</span>
            <span class="dim">Codes</span><span>${r.dtcs.length ? r.dtcs.join(", ") : "None"}</span>
          </div></div>
      </div>
      <div class="checklist" style="border-top:1px solid var(--line)">${r.checks.map((c) => `<div class="checkitem"><span class="pill ${c.status}" style="width:22px;padding:0;justify-content:center">${icon(c.status === "good" ? "check" : c.status === "crit" ? "x" : "alert")}</span><b style="font-weight:600">${c.label}</b><span></span><span class="d">${c.detail}</span></div>`).join("")}</div>
      <div class="groups">
        ${grp("g-safe", "check", "Safe to do", G.safe)}
        ${grp("g-att", "alert", "Needs attention first", G.attention)}
        ${grp("g-no", "x", "Not recommended", G.no)}
        ${grp("g-un", "info", "Doesn't need it", G.unneeded)}
      </div>`;
  }

  function paintConsole() {
    const c = root.querySelector("#console"); if (!c) return;
    c.innerHTML = conn.log.length ? conn.log.map((l) => `<div class="${l.cls}">[${l.at}] ${fmt.esc(l.msg)}</div>`).join("") : `<div>Waiting for a connection.</div>`;
    c.scrollTop = c.scrollHeight;
  }

  function wire() {
    root.querySelectorAll("[data-conn]").forEach((b) => b.addEventListener("click", () => start(b.dataset.conn)));
    root.querySelector("#disc")?.addEventListener("click", stop);
    root.querySelector("#t-idle")?.addEventListener("click", () => beginCapture("idle"));
    root.querySelector("#t-drive")?.addEventListener("click", () => beginCapture("drive"));
    root.querySelector("#cap-stop")?.addEventListener("click", finishCapture);
    root.querySelector("#dl-cap")?.addEventListener("click", () => download(`stagline-${conn.report.mode}-capture.csv`, toCSV(conn.report.samples), "text/csv"));
    root.querySelector("#to-logs")?.addEventListener("click", () => { ctx.shared.log = { name: `${conn.report.mode === "idle" ? "Idle" : "Driving"} test capture`, samples: conn.report.samples, columns: {}, warnings: [] }; });
    const snd = root.querySelector("#snd");
    snd?.addEventListener("click", async () => { if (audio.running) audio.stop(); else await audio.start(); shell(); });
    const leak = root.querySelector("#leak");
    leak?.addEventListener("change", () => { conn.demo.faults.vacuumLeak = leak.checked; log(leak.checked ? "Fault injected: vacuum leak" : "Fault cleared", leak.checked ? "err" : "ok"); });
    const rev = root.querySelector("#rev");
    if (rev) {
      let iv;
      const down = (e) => { e.preventDefault(); clearInterval(iv); iv = setInterval(() => { conn.demo.throttle = Math.min(1, conn.demo.throttle + 0.08); audio.set({ throttle: conn.demo.throttle * 0.9 }); }, 30); };
      const up = () => { clearInterval(iv); iv = setInterval(() => { conn.demo.throttle = Math.max(0, conn.demo.throttle - 0.1); audio.set({ throttle: conn.demo.throttle * 0.9 }); if (!conn.demo.throttle) clearInterval(iv); }, 30); };
      rev.addEventListener("pointerdown", down); rev.addEventListener("pointerup", up); rev.addEventListener("pointerleave", up);
    }
  }

  async function start(kind) {
    if (kind === "demo") {
      conn.demo = new DemoEngine(() => ({ ...store.state, cam: store.state.project.cam }));
      Object.assign(conn, { kind: "demo", name: "Demo engine", vin: null, running: true, buf: [] });
      log("Demo engine started with your current tune.", "ok");
      const s = store.state; const est = (await import("../model.js")).idleEstimate(s.idle, s.project.cam);
      audio.set({ rpm: s.idle.rpmPark, lope: est.lope, lopeHz: est.lopeHz, swing: est.swing, exhaust: s.project.exhaust === "open" ? "open" : "muffled" });
      conn.timer = setInterval(() => push(conn.demo.sample()), 100);
      shell();
      return;
    }
    try {
      log(kind === "ble" ? "Requesting Bluetooth device…" : "Requesting USB serial port…");
      const c = await connect(kind === "ble" ? "ble" : "usb", { log: (m) => log(m) });
      Object.assign(conn, { kind, name: c.name, elm: c.elm, vin: c.vin, running: true, buf: [] });
      c.transport.onclose = () => { if (conn.kind) { log("Adapter disconnected.", "err"); stop(); } };
      log(`Connected${c.vin ? ` · VIN ${c.vin}` : ""}`, "ok");
      conn.dtcs = await c.elm.readDtcs().catch(() => []);
      log(conn.dtcs.length ? `Stored codes: ${conn.dtcs.join(", ")}` : "No stored trouble codes.", conn.dtcs.length ? "err" : "ok");
      shell();
      (async () => { while (conn.running && conn.elm) { try { push(await conn.elm.sample()); } catch (e) { log(e.message, "err"); await new Promise((r) => setTimeout(r, 500)); } } })();
    } catch (e) {
      if (e.name === "NotFoundError") log("No device chosen.");
      else { log(e.message || String(e), "err"); toast(e.message || "Connection failed.", "warn"); }
    }
  }

  async function stop() {
    conn.running = false;
    clearInterval(conn.timer);
    try { await conn.elm?.close(); } catch {}
    if (conn.kind === "demo") audio.set({ throttle: 0 });
    Object.assign(conn, { kind: null, elm: null, demo: null, capture: null });
    log("Disconnected.");
    shell();
  }

  function push(s) {
    s.trim1 = (s.stft1 ?? 0) + (s.ltft1 ?? 0);
    s.trim2 = (s.stft2 ?? 0) + (s.ltft2 ?? 0);
    conn.buf.push(s); if (conn.buf.length > 300) conn.buf.shift();
    if (conn.capture) {
      conn.capture.samples.push(s);
      if (conn.capture.mode === "idle" && s.t - conn.capture.t0 >= 30) finishCapture();
    }
  }

  function beginCapture(mode) {
    conn.capture = { mode, samples: [], t0: performance.now() / 1000 };
    log(`${mode === "idle" ? "Idle" : "Driving"} test started.`);
    shell();
  }
  async function finishCapture() {
    const cap = conn.capture; if (!cap) return;
    conn.capture = null;
    const dtcs = conn.kind === "demo" ? conn.demo.readDtcs() : conn.dtcs;
    const r = evaluate(cap.samples, { mode: cap.mode, dtcs, project: { ...store.state.project, idle: store.state.idle, cam: store.state.project.cam, exhaust: store.state.project.exhaust } });
    conn.report = { ...r, mode: cap.mode, dtcs, samples: cap.samples, source: conn.kind === "demo" ? "demo engine" : conn.name };
    store.update((s) => (s.diag = { readiness: r.readiness, verdict: r.verdict, at: new Date().toISOString(), source: conn.report.source }), "Diagnostics result saved", { history: false, backup: false });
    log(`Test complete · readiness ${r.readiness}/100`, r.readiness >= 80 ? "ok" : "err");
    toast(`Evaluation ready · ${r.verdict}`, r.readiness >= 80 ? "info" : "warn");
    shell();
    root.querySelector("#report-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // UI refresh loop (~12 fps)
  function paint() {
    if (!alive) return;
    const last = conn.buf[conn.buf.length - 1];
    const tach = root.querySelector("#tach");
    if (tach && last) drawTach(tach, { rpm: last.rpm ?? 0, target: store.state.idle.rpmPark, redline: store.state.revLimit });
    if (last) GAUGES.forEach(([k, , u, d]) => {
      const el = root.querySelector(`#g-${k}`); if (!el) return;
      const v = last[k];
      el.innerHTML = `${Number.isFinite(v) ? (k.startsWith("trim") ? fmt.sign(v, d) : v.toFixed(d)) : "—"}<small>${u}</small>`;
      const cv = root.querySelector(`#s-${k}`);
      if (cv) drawSpark(cv, conn.buf.slice(-120).map((s) => s[k]).filter(Number.isFinite));
    });
    if (conn.capture) {
      const el = root.querySelector("#cap-t"), p = root.querySelector("#cap-p");
      const t = performance.now() / 1000 - conn.capture.t0;
      if (el) el.textContent = `${Math.floor(t)} s · ${conn.capture.samples.length} samples`;
      if (p) p.style.width = conn.capture.mode === "idle" ? `${Math.min(100, (t / 30) * 100)}%` : "100%";
    }
  }
  uiTimer = setInterval(paint, 80);
  shell();
  return () => { alive = false; clearInterval(uiTimer); };
}
