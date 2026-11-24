// Studio controller: rail, topbar, hash routing, shortcuts, plan switching.
import { store } from "./store.js";
import { icon, fmt } from "./ui.js";
import { VEHICLES } from "./model.js";
import { EngineAudio } from "./audio.js";
import { toast, openModal, requireTerms, requireWaiver, getWaiver, BRAND_MARK } from "../site.js";

const VIEWS = [
  { id: "overview", label: "Project", icon: "overview", sec: "Setup", load: () => import("./views/overview.js") },
  { id: "connect", label: "Connect & diagnose", icon: "connect", sec: "Setup", load: () => import("./views/connect.js") },
  { id: "idle", label: "Idle & lope", icon: "idle", sec: "Calibrate", load: () => import("./views/idle.js") },
  { id: "ve", label: "Fuel · VE table", icon: "ve", sec: "Calibrate", load: () => import("./views/maps.js") },
  { id: "spark", label: "Spark table", icon: "spark", sec: "Calibrate", load: () => import("./views/maps.js") },
  { id: "sim", label: "Tune simulator", icon: "sim", sec: "Verify", load: () => import("./views/sim.js") },
  { id: "logs", label: "Data logs", icon: "logs", sec: "Verify", load: () => import("./views/logs.js") },
  { id: "backups", label: "Backups", icon: "backups", sec: "Verify", load: () => import("./views/backups.js") },
  { id: "review", label: "Review & write", icon: "review", sec: "Finish", load: () => import("./views/review.js") },
];

const ctx = {
  store, toast, openModal, icon, fmt,
  audio: new EngineAudio(),
  shared: { log: null, capture: null, dtcs: [] },
  go: (id) => { location.hash = id; },
  requireWaiver,
};
window.__stagline = ctx; // handy for debugging in the console

const appEl = document.getElementById("app");
const railEl = document.getElementById("rail");
const topEl = document.getElementById("topbar");
const viewEl = document.getElementById("view");
let current = null, cleanup = null;

function renderRail() {
  const s = store.state;
  const changes = store.changes().length;
  let sec = "";
  const items = VIEWS.map((v) => {
    const head = v.sec !== sec ? `<div class="rail-sec">${(sec = v.sec)}</div>` : "";
    const cnt = v.id === "review" && changes ? `<span class="cnt hot">${changes}</span>` : v.id === "backups" ? `<span class="cnt">${store.backups.length}</span>` : "";
    return `${head}<a href="#${v.id}" data-view="${v.id}"${current === v.id ? ' aria-current="page"' : ""}>${icon(v.icon)}<span>${v.label}</span>${cnt}</a>`;
  }).join("");
  const w = getWaiver();
  railEl.innerHTML = `
    <div class="rail-head"><a class="brand" href="index.html" title="Back to site">${BRAND_MARK}<span>Stagline</span><small>Studio</small></a></div>
    <nav class="rail-nav">${items}
      <div class="rail-sec">Service</div>
      <a href="mail-in.html">${icon("mail")}<span>Mail-in ECM</span>${icon("ext")}</a>
    </nav>
    <div class="rail-foot">
      <div class="plan-card">
        <div class="row"><span class="k">Limits</span><span class="pill ${s.plan === "advanced" ? "warn" : "good"}">${s.plan === "advanced" ? "Advanced" : "Street"}</span></div>
        <div class="seg" role="group" aria-label="Plan limits" style="width:100%">
          <button style="flex:1" data-plan="street" aria-pressed="${s.plan === "street"}">Street</button>
          <button style="flex:1" data-plan="advanced" aria-pressed="${s.plan === "advanced"}">${icon(w ? "unlock" : "lock")} Advanced</button>
        </div>
        <span class="dim" style="font-size:.72rem;line-height:1.4">Preview: all features are unlocked. Advanced limits require a signed waiver.</span>
      </div>
      <div class="hw sim" id="hw-status"><span class="dot pulse"></span> Simulation mode · no ECU attached</div>
    </div>`;
  railEl.querySelectorAll("[data-plan]").forEach((b) => b.addEventListener("click", () => setPlan(b.dataset.plan)));
  railEl.querySelectorAll("a[data-view]").forEach((a) => a.addEventListener("click", () => appEl.classList.remove("nav-open")));
}

async function setPlan(plan) {
  if (plan === store.state.plan) return;
  if (plan === "advanced") {
    const w = await requireWaiver({ reason: "Advanced limits" });
    if (!w) return;
    store.update((s) => (s.plan = "advanced"), "Switched to Advanced limits", { history: false });
    toast("Advanced limits unlocked. Wider ranges are now available.", "warn");
  } else {
    store.update((s) => (s.plan = "street"), "Switched to Street limits", { history: false });
    if (store.guardViolations().length) { store.clampToPlan(); toast("Values outside Street limits were clamped back in.", "warn"); }
    else toast("Street limits active.");
  }
}

function renderTop() {
  const s = store.state;
  const v = VIEWS.find((x) => x.id === current);
  const changes = store.changes().length;
  topEl.innerHTML = `
    <button class="icon-btn menu-btn" id="menu-btn" aria-label="Open navigation">${icon("menu")}</button>
    <div class="crumb"><b>${v ? v.label : ""}</b><span>${fmt.esc(s.project.name)} · ${VEHICLES[s.project.vehicle]?.short || ""}</span></div>
    <div class="actions">
      <span class="chip hide-sm" title="Calibration checksum of your current changes">CRC <b>${store.tuneChecksum()}</b></span>
      <button class="icon-btn" id="undo" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" ${store.undo.length ? "" : "disabled"}>${icon("undo")}</button>
      <button class="icon-btn" id="redo" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" ${store.redo.length ? "" : "disabled"}>${icon("redo")}</button>
      <a class="btn btn-primary btn-sm" href="#review">${icon("review")} Review${changes ? ` · ${changes}` : ""}</a>
    </div>`;
  topEl.querySelector("#undo").addEventListener("click", () => store.undoOne() && toast("Undone"));
  topEl.querySelector("#redo").addEventListener("click", () => store.redoOne() && toast("Redone"));
  topEl.querySelector("#menu-btn").addEventListener("click", () => appEl.classList.toggle("nav-open"));
}

async function route() {
  const id = (location.hash || "#overview").slice(1);
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  if (v.id === current && cleanup) return;
  cleanup?.(); cleanup = null;
  current = v.id;
  renderRail(); renderTop();
  const mod = await v.load();
  if (current !== v.id) return;
  viewEl.innerHTML = `<div class="view-inner"></div>`;
  viewEl.scrollTop = 0;
  cleanup = mod.render(viewEl.firstElementChild, ctx, v.id) || null;
  document.title = `${v.label} · Stagline Tune Studio`;
}

store.on((kind) => { renderRail(); renderTop(); });
window.addEventListener("hashchange", route);
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select")) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); (e.shiftKey ? store.redoOne() : store.undoOne()) && toast(e.shiftKey ? "Redone" : "Undone"); }
  if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); store.redoOne() && toast("Redone"); }
});

(async () => {
  await requireTerms();
  route();
})();
