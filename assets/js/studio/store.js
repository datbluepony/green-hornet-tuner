// Studio state: tune, undo/redo, auto-backups (localStorage), change diff.
import { CAMS, defaultIdle, zeros, RPM_AXIS, MAP_AXIS, CYLAIR_AXIS, STOCK_VE, STOCK_SPARK, limitFor, clamp } from "./model.js";

const KEY = "stagline.project.v2";
const BKEY = "stagline.backups.v2";
const MAX_BACKUPS = 40;

/* ---------------------------------------------------------------- utils */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const hex32 = (n) => "0x" + (n >>> 0).toString(16).toUpperCase().padStart(8, "0");
export async function sha256(buf) {
  if (!crypto?.subtle) return "unavailable";
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const enc = new TextEncoder();
const clone = (o) => JSON.parse(JSON.stringify(o));
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

export function download(name, content, type = "application/octet-stream") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* -------------------------------------------------------------- defaults */
export function newProject() {
  return {
    v: 1,
    project: {
      name: "Green Hornet",
      description: "'09 Silverado 5.3 swapped into a Wrangler",
      vehicle: "gmt900-53",
      camKey: "stage3",
      cam: { ...CAMS.stage3 },
      fuel: "93",
      exhaust: "open",
      trans: "4L60E",
      afm: "disabled",
    },
    plan: "street",
    idle: defaultIdle("stage3"),
    veDelta: zeros(MAP_AXIS.length, RPM_AXIS.length),
    sparkDelta: zeros(CYLAIR_AXIS.length, RPM_AXIS.length),
    revLimit: 6000,
    stock: null, // { name, size, crc, sha, at, verdict }
    diag: null,  // last diagnostics summary
  };
}

/* ----------------------------------------------------------------- store */
class Store {
  constructor() {
    let s = null;
    try { s = JSON.parse(safeGet(KEY) || "null"); } catch { s = null; }
    this.s = s && s.v === 1 ? { ...newProject(), ...s } : newProject();
    this.undo = []; this.redo = [];
    this.subs = new Set();
    this._lastLabel = "Edit";
    this._bt = null;
    try { this.backups = JSON.parse(safeGet(BKEY) || "[]"); } catch { this.backups = []; }
    if (!this.backups.length) this.snapshot("Project created", true);
  }
  get state() { return this.s; }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(kind = "change") { this.subs.forEach((f) => f(kind, this.s)); }

  /** Apply a mutation. `fn` mutates a draft; label names the change for backups. */
  update(fn, label = "Edit", { history = true, backup = true } = {}) {
    if (history) { this.undo.push(JSON.stringify(this.s)); if (this.undo.length > 120) this.undo.shift(); this.redo = []; }
    fn(this.s);
    this._persist();
    this._lastLabel = label;
    if (backup) { clearTimeout(this._bt); this._bt = setTimeout(() => this.snapshot(this._lastLabel, true), 1500); }
    this.emit();
  }
  undoOne() { if (!this.undo.length) return false; this.redo.push(JSON.stringify(this.s)); this.s = JSON.parse(this.undo.pop()); this._persist(); this.emit(); return true; }
  redoOne() { if (!this.redo.length) return false; this.undo.push(JSON.stringify(this.s)); this.s = JSON.parse(this.redo.pop()); this._persist(); this.emit(); return true; }
  _persist() { safeSet(KEY, JSON.stringify(this.s)); }

  /* backups */
  snapshot(label, auto = false) {
    const data = JSON.stringify(this.s);
    const last = this.backups[0];
    if (auto && last && last.data === data) return null;
    const b = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), label, auto, crc: hex32(crc32(enc.encode(data))), changes: this.changes().length, data };
    this.backups.unshift(b);
    // keep all manual ones, trim oldest autos
    while (this.backups.length > MAX_BACKUPS) {
      const i = this.backups.map((x) => x.auto).lastIndexOf(true);
      this.backups.splice(i >= 0 ? i : this.backups.length - 1, 1);
    }
    if (!safeSet(BKEY, JSON.stringify(this.backups))) { this.backups.length = Math.max(5, this.backups.length - 10); safeSet(BKEY, JSON.stringify(this.backups)); }
    this.emit("backup");
    return b;
  }
  restore(id) {
    const b = this.backups.find((x) => x.id === id);
    if (!b) return false;
    this.update((s) => Object.assign(s, JSON.parse(b.data)), `Restored “${b.label}”`);
    return true;
  }
  deleteBackup(id) { this.backups = this.backups.filter((x) => x.id !== id); safeSet(BKEY, JSON.stringify(this.backups)); this.emit("backup"); }
  reset() { this.update((s) => Object.assign(s, newProject(), { stock: s.stock }), "Reset to baseline"); }

  /* derived */
  baselineIdle() { return defaultIdle(this.s.project.camKey); }
  tuneChecksum() {
    const { idle, veDelta, sparkDelta, revLimit, project } = this.s;
    return hex32(crc32(enc.encode(JSON.stringify({ idle, veDelta, sparkDelta, revLimit, cam: project.cam }))));
  }
  changes() {
    const out = [];
    const base = this.baselineIdle();
    const names = { rpmPark: "Idle target · Park/Neutral", rpmDrive: "Idle target · In gear", sparkIdle: "Idle spark advance", stability: "Idle spark stability correction", airflow: "Idle airflow trim", enrich: "Idle fueling enrichment" };
    const units = { rpmPark: " rpm", rpmDrive: " rpm", sparkIdle: "°", stability: "%", airflow: "%", enrich: "%" };
    for (const k of Object.keys(names)) {
      const a = base[k], b = this.s.idle[k];
      if (Math.abs(a - b) > 1e-6) out.push({ table: "Idle", key: k, name: names[k], from: a, to: b, unit: units[k], kind: "param" });
    }
    if (this.s.revLimit !== 6000) out.push({ table: "Limiter", key: "revLimit", name: "Fuel cut rev limiter", from: 6000, to: this.s.revLimit, unit: " rpm", kind: "param" });
    this.s.veDelta.forEach((row, r) => row.forEach((d, c) => { if (Math.abs(d) > 1e-6) out.push({ table: "VE", r, c, name: `VE @ ${RPM_AXIS[c]} rpm · ${MAP_AXIS[r]} kPa`, from: STOCK_VE[r][c], to: +(STOCK_VE[r][c] * (1 + d / 100)).toFixed(2), delta: d, unit: "%", kind: "cell" }); }));
    this.s.sparkDelta.forEach((row, r) => row.forEach((d, c) => { if (Math.abs(d) > 1e-6) out.push({ table: "Spark", r, c, name: `Spark @ ${RPM_AXIS[c]} rpm · ${CYLAIR_AXIS[r]} g/cyl`, from: STOCK_SPARK[r][c], to: +(STOCK_SPARK[r][c] + d).toFixed(1), delta: d, unit: "°", kind: "cell" }); }));
    return out;
  }
  guardViolations() {
    const v = [];
    const plan = this.s.plan;
    for (const [k, val] of Object.entries(this.s.idle)) {
      const [lo, hi] = limitFor(k, plan);
      if (val < lo - 1e-6 || val > hi + 1e-6) v.push(`${k} ${val} outside ${lo}…${hi}`);
    }
    const [vlo, vhi] = limitFor("ve", plan), [slo, shi] = limitFor("spark", plan);
    this.s.veDelta.flat().forEach((d) => { if (d < vlo - 1e-6 || d > vhi + 1e-6) v.push(`VE ${d}%`); });
    this.s.sparkDelta.flat().forEach((d) => { if (d < slo - 1e-6 || d > shi + 1e-6) v.push(`Spark ${d}°`); });
    const [rlo, rhi] = limitFor("revLimit", plan);
    if (this.s.revLimit < rlo || this.s.revLimit > rhi) v.push(`Rev limit ${this.s.revLimit}`);
    return v;
  }
  /** Clamp everything to the current plan (used when downgrading plan). */
  clampToPlan() {
    this.update((s) => {
      for (const k of Object.keys(s.idle)) { const [lo, hi] = limitFor(k, s.plan); s.idle[k] = clamp(s.idle[k], lo, hi); }
      const [vlo, vhi] = limitFor("ve", s.plan), [slo, shi] = limitFor("spark", s.plan);
      s.veDelta = s.veDelta.map((r) => r.map((d) => clamp(d, vlo, vhi)));
      s.sparkDelta = s.sparkDelta.map((r) => r.map((d) => clamp(d, slo, shi)));
      const [rlo, rhi] = limitFor("revLimit", s.plan); s.revLimit = clamp(s.revLimit, rlo, rhi);
    }, "Clamped to plan limits");
  }
  exportProject() { return JSON.stringify({ app: "stagline", exported: new Date().toISOString(), checksum: this.tuneChecksum(), state: this.s }, null, 2); }
  importProject(text) {
    const o = JSON.parse(text);
    if (o.app !== "stagline" || !o.state || o.state.v !== 1) throw new Error("This file isn't a Stagline project.");
    this.update((s) => Object.assign(s, newProject(), o.state), "Imported project");
  }
}

export const store = new Store();
export { clone };
