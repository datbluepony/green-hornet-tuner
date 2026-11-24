// Shared site chrome: nav, footer, reveal animations, toasts, modals,
// legal acceptance, liability waiver and checkout routing.
import { CONFIG } from "./config.js";

document.documentElement.classList.remove("no-js");

/* ------------------------------------------------------------------ icons */
const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  github: '<path d="M9 19c-4 1.5-4-2-6-2.5m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  play: '<path d="M7 5v14l12-7L7 5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
};
export function icon(name, cls = "") {
  return `<svg class="${cls}" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

export const BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
  <defs><linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3ff7a"/><stop offset="1" stop-color="#9fd21a"/></linearGradient></defs>
  <rect x="1" y="1" width="30" height="30" rx="9" fill="#10150a" stroke="rgba(200,245,60,.35)"/>
  <path d="M6.5 21.5 11 12l4 7 4.5-11L25.5 18" fill="none" stroke="url(#bm-g)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="25.5" cy="18" r="1.9" fill="#c8f53c"/>
</svg>`;

/* -------------------------------------------------------------- nav/footer */
const NAV = [
  ["index.html", "Product"],
  ["builder.html", "Tune Studio"],
  ["mail-in.html", "Mail-in"],
  ["hardware.html", "Hardware"],
  ["pricing.html", "Pricing"],
  ["learn.html", "Learn"],
];

function currentPage() {
  const p = location.pathname.split("/").pop() || "index.html";
  return p === "" ? "index.html" : p;
}

function renderNav() {
  const host = document.querySelector("[data-nav]");
  if (!host) return;
  const here = currentPage();
  host.outerHTML = `
  <header class="nav" id="top-nav">
    <div class="container nav-inner">
      <a class="brand" href="index.html" aria-label="${CONFIG.brand} home">${BRAND_MARK}<span>${CONFIG.brand}</span><small>LS</small></a>
      <nav class="nav-links" aria-label="Primary">
        ${NAV.map(([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav>
      <div class="nav-cta">
        <a class="btn btn-ghost btn-sm" href="pricing.html">See plans</a>
        <a class="btn btn-primary btn-sm" href="builder.html">Open Studio ${icon("arrow")}</a>
      </div>
      <button class="nav-toggle" aria-label="Open menu" aria-expanded="false">${icon("menu")}</button>
    </div>
  </header>`;
  const nav = document.getElementById("top-nav");
  const t = nav.querySelector(".nav-toggle");
  t.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    t.setAttribute("aria-expanded", String(open));
  });
}

function renderFooter() {
  const host = document.querySelector("[data-footer]");
  if (!host) return;
  const year = new Date().getFullYear();
  host.outerHTML = `
  <footer class="footer">
    <div class="container">
      <div class="footer-grid">
        <div style="display:grid;gap:16px;align-content:start">
          <a class="brand" href="index.html">${BRAND_MARK}<span>${CONFIG.brand}</span></a>
          <p class="muted" style="font-size:.92rem;max-width:36ch">Guardrailed calibration tools for GM LS engines. Small, smart changes — reviewed by you before anything is written.</p>
          <a class="btn btn-ghost btn-sm" style="width:max-content" href="${CONFIG.repoUrl}" rel="noopener" target="_blank">${icon("github")} Source on GitHub</a>
        </div>
        <div><h4>Product</h4><ul>
          <li><a href="builder.html">Tune Studio</a></li>
          <li><a href="builder.html#idle">Idle &amp; lope</a></li>
          <li><a href="builder.html#connect">Bluetooth diagnostics</a></li>
          <li><a href="builder.html#sim">Tune simulator</a></li>
          <li><a href="hardware.html">Hardware estimator</a></li>
        </ul></div>
        <div><h4>Service</h4><ul>
          <li><a href="pricing.html">Pricing</a></li>
          <li><a href="mail-in.html">Mail-in ECM tuning</a></li>
          <li><a href="learn.html">Learn center</a></li>
          <li><a href="learn.html#faq">FAQ</a></li>
          ${CONFIG.contactEmail ? `<li><a href="mailto:${CONFIG.contactEmail}">Contact</a></li>` : ""}
        </ul></div>
        <div><h4>Legal</h4><ul>
          <li><a href="legal.html#terms">Terms of service</a></li>
          <li><a href="legal.html#disclaimer">Disclaimer</a></li>
          <li><a href="legal.html#waiver">Assumption of risk</a></li>
          <li><a href="legal.html#emissions">Emissions notice</a></li>
          <li><a href="legal.html#privacy">Privacy</a></li>
          <li><a href="legal.html#refunds">Refunds</a></li>
        </ul></div>
      </div>
      <div class="footer-legal">
        <p><strong style="color:var(--text-2)">Experimental software. Use at your own risk.</strong> ${CONFIG.brand} provides calibration tools and information, not professional tuning services or guarantees. Modifying engine calibration can damage your engine, void warranties and may not be legal for street use where you live. Many calibration changes are intended for off-road / competition vehicles only. You are solely responsible for any change you write to a vehicle. See the <a href="legal.html" style="text-decoration:underline">full terms</a>.</p>
        <p>© ${year} ${CONFIG.brand}. Not affiliated with General Motors, Chevrolet, HP Tuners, EFILive or any vehicle manufacturer. All trademarks belong to their owners.</p>
      </div>
    </div>
  </footer>`;
}

/* ------------------------------------------------------------------ reveal */
// Content is visible at rest. Only elements that start below the fold get
// a "pre" state, removed when they scroll into view.
function initReveal() {
  if (!("IntersectionObserver" in window)) return;
  const fold = window.innerHeight;
  const els = [...document.querySelectorAll(".reveal")].filter((e) => e.getBoundingClientRect().top > fold);
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.remove("pre"); io.unobserve(en.target); } });
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
  els.forEach((e) => { e.classList.add("pre"); io.observe(e); });
}

/* ------------------------------------------------------------------- toast */
let toastHost;
export function toast(msg, kind = "info", ms = 3800) {
  if (!toastHost) { toastHost = document.createElement("div"); toastHost.className = "toasts"; toastHost.setAttribute("role", "status"); document.body.appendChild(toastHost); }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="t-icon">${icon(kind === "warn" || kind === "crit" ? "alert" : "check")}</span><span>${msg}</span>`;
  toastHost.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, ms);
}

/* ------------------------------------------------------------------- modal */
export function openModal(html, { onMount, dismissable = true, width } = {}) {
  const bd = document.createElement("div");
  bd.className = "modal-backdrop open";
  bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true"${width ? ` style="width:min(${width}px,100%)"` : ""}>${html}</div>`;
  document.body.appendChild(bd);
  document.body.style.overflow = "hidden";
  const prevFocus = document.activeElement;
  const close = () => { bd.remove(); document.body.style.overflow = ""; prevFocus?.focus?.(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape" && dismissable) close(); };
  document.addEventListener("keydown", onKey);
  if (dismissable) bd.addEventListener("mousedown", (e) => { if (e.target === bd) close(); });
  bd.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  const first = bd.querySelector("input, button, a, select");
  setTimeout(() => first?.focus(), 30);
  onMount?.(bd, close);
  return close;
}

/* ---------------------------------------------------- legal acceptance */
const LS = {
  terms: "stagline.terms",
  waiver: "stagline.waiver",
};

export function hasAcceptedTerms() {
  try { const t = JSON.parse(localStorage.getItem(LS.terms) || "null"); return t && t.version === CONFIG.legalVersion; } catch { return false; }
}
export function getWaiver() {
  try { const w = JSON.parse(localStorage.getItem(LS.waiver) || "null"); return w && w.version === CONFIG.legalVersion ? w : null; } catch { return null; }
}

/** Basic terms gate (Studio entry). Resolves when accepted. */
export function requireTerms() {
  if (hasAcceptedTerms()) return Promise.resolve(true);
  return new Promise((resolve) => {
    openModal(`
      <div class="modal-head">
        <span class="eyebrow">Before you start</span>
        <h2 style="font-size:1.7rem">This is a calibration tool, not a guarantee.</h2>
        <p class="muted" style="font-size:.95rem">${CONFIG.brand} helps you plan small, guardrailed changes and simulates their effect. It cannot know the exact condition of your engine.</p>
      </div>
      <div class="modal-body">
        <label class="check"><input type="checkbox" required> <span>I understand that <strong>any change written to my vehicle is my decision and my responsibility</strong>, and that ${CONFIG.brand} and its owner are not liable for damage, injury, fines or loss.</span></label>
        <label class="check"><input type="checkbox" required> <span>I understand simulator results are <strong>estimates</strong> and that real-world results depend on my engine, fuel, sensors and hardware.</span></label>
        <label class="check"><input type="checkbox" required> <span>I will follow the laws where I live, including emissions laws, and I have read the <a href="legal.html" target="_blank" style="color:var(--accent);text-decoration:underline">Terms &amp; Disclaimer</a>.</span></label>
      </div>
      <div class="modal-foot">
        <a class="btn btn-quiet" href="index.html">Leave</a>
        <button class="btn btn-primary" data-accept disabled>Accept &amp; continue</button>
      </div>`, {
      dismissable: false,
      onMount(root, close) {
        const boxes = [...root.querySelectorAll("input[type=checkbox]")];
        const btn = root.querySelector("[data-accept]");
        const sync = () => (btn.disabled = !boxes.every((b) => b.checked));
        boxes.forEach((b) => b.addEventListener("change", sync));
        btn.addEventListener("click", () => {
          localStorage.setItem(LS.terms, JSON.stringify({ version: CONFIG.legalVersion, at: new Date().toISOString() }));
          close(); resolve(true);
        });
      },
    });
  });
}

/**
 * Full assumption-of-risk & release. Required for Advanced tier and
 * mail-in service. Resolves to the waiver record, or null if cancelled.
 */
export function requireWaiver({ reason = "Advanced calibration" } = {}) {
  const existing = getWaiver();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const items = [
      `I am at least 18 years old and I own the vehicle, or I have the owner's written permission to modify it.`,
      `I understand engine calibration changes are <strong>experimental</strong> and can cause engine damage, transmission damage, fire, loss of vehicle control, injury or death.`,
      `I <strong>voluntarily assume all risks</strong>, known and unknown, of using ${CONFIG.brand} software, calibrations, simulations, recommendations and services.`,
      `I <strong>release and agree not to sue</strong> ${CONFIG.brand}, its owner, contractors and affiliates for any claim arising from my use, to the fullest extent allowed by law.`,
      `I will review every change myself, keep my stock calibration backup, and approve each write manually. Nothing is written without my approval.`,
      `I understand some changes may not be legal on public roads or on emissions-controlled vehicles, and I am responsible for compliance where I live.`,
      `I have read and agree to the <a href="legal.html#waiver" target="_blank" style="color:var(--accent);text-decoration:underline">Assumption of Risk, Release &amp; Indemnity</a> and the <a href="legal.html#terms" target="_blank" style="color:var(--accent);text-decoration:underline">Terms of Service</a>.`,
    ];
    openModal(`
      <div class="modal-head">
        <span class="badge badge-warn">${icon("alert")} Required · ${reason}</span>
        <h2 style="font-size:1.75rem">Assumption of risk &amp; release of liability</h2>
        <p class="muted" style="font-size:.95rem">Read each statement and check it to confirm. Your typed name below is your electronic signature and will be attached to your order.</p>
      </div>
      <div class="modal-body">
        ${items.map((t) => `<label class="check"><input type="checkbox"> <span>${t}</span></label>`).join("")}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px">
          <div class="field"><label for="wv-name">Full legal name</label><input id="wv-name" class="input" autocomplete="name" placeholder="First Last"></div>
          <div class="field"><label for="wv-sign">Type <span class="mono" style="color:var(--text)">I AGREE</span></label><input id="wv-sign" class="input mono" placeholder="I AGREE" autocomplete="off"></div>
        </div>
        <p class="dim" style="font-size:.78rem">Signed ${new Date().toLocaleString()} · Terms version ${CONFIG.legalVersion}</p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-quiet" data-cancel>Cancel</button>
        <button class="btn btn-primary" data-sign disabled>${icon("shield")} Sign &amp; continue</button>
      </div>`, {
      width: 680,
      onMount(root, close) {
        const boxes = [...root.querySelectorAll("input[type=checkbox]")];
        const name = root.querySelector("#wv-name");
        const sign = root.querySelector("#wv-sign");
        const btn = root.querySelector("[data-sign]");
        const sync = () => { btn.disabled = !(boxes.every((b) => b.checked) && name.value.trim().split(/\s+/).length >= 2 && sign.value.trim().toUpperCase() === "I AGREE"); };
        [...boxes, name, sign].forEach((el) => el.addEventListener("input", sync));
        boxes.forEach((b) => b.addEventListener("change", sync));
        root.querySelector("[data-cancel]").addEventListener("click", () => { close(); resolve(null); });
        btn.addEventListener("click", () => {
          const rec = {
            id: "WV-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
            name: name.value.trim(), version: CONFIG.legalVersion, at: new Date().toISOString(), reason,
          };
          localStorage.setItem(LS.waiver, JSON.stringify(rec));
          close(); resolve(rec);
          toast(`Waiver signed · ${rec.id}`);
        });
      },
    });
  });
}

/* ---------------------------------------------------------------- checkout */
async function checkout(plan) {
  let ref = "";
  if (plan === "advanced" || plan === "mailin") {
    const w = await requireWaiver({ reason: plan === "advanced" ? "Advanced tier" : "Mail-in ECM service" });
    if (!w) return;
    ref = w.id;
  } else {
    if (!hasAcceptedTerms()) { const ok = await requireTerms(); if (!ok) return; }
  }
  const link = CONFIG.checkout[plan];
  if (link) {
    const url = new URL(link);
    if (ref) url.searchParams.set("client_reference_id", ref);
    location.href = url.toString();
    return;
  }
  openModal(`
    <div class="modal-head">
      <span class="badge badge-accent"><span class="dot pulse"></span> Early access</span>
      <h2 style="font-size:1.7rem">Checkout opens soon.</h2>
      <p class="muted">${CONFIG.brand} is in public preview. The Tune Studio is fully usable in simulation mode right now — no account needed.</p>
    </div>
    <div class="modal-body">
      ${CONFIG.formEndpoint ? `<form class="field" data-wl><label for="wl-email">Get notified at launch</label><div style="display:flex;gap:8px"><input id="wl-email" class="input" type="email" required placeholder="you@example.com"><button class="btn btn-primary">Notify me</button></div></form>` : `<div class="callout info">${icon("info")}<span>Follow the project on <a href="${CONFIG.repoUrl}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline">GitHub</a> — releases are announced there.</span></div>`}
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close>Close</button>
      <a class="btn btn-primary" href="builder.html">Try the Studio ${icon("arrow")}</a>
    </div>`, {
    onMount(root, close) {
      const f = root.querySelector("[data-wl]");
      f?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = f.querySelector("input").value;
        try {
          await fetch(CONFIG.formEndpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email, plan, source: "checkout" }) });
          toast("You're on the list."); close();
        } catch { toast("Couldn't reach the server. Try again later.", "warn"); }
      });
    },
  });
}

function initCheckout() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-checkout]");
    if (!b) return;
    e.preventDefault();
    checkout(b.dataset.checkout);
  });
  document.querySelectorAll("[data-price]").forEach((el) => {
    const v = CONFIG.pricing[el.dataset.price];
    if (v != null) el.textContent = v === 0 ? "Free" : `$${v}`;
  });
}

renderNav();
renderFooter();
initReveal();
initCheckout();
