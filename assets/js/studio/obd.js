// ==========================================================================
// OBD2 over ELM327-compatible adapters.
//  • Bluetooth Low Energy (Web Bluetooth) — Chrome / Edge on desktop & Android
//  • USB serial (Web Serial) — Chrome / Edge desktop
//  • Demo engine — simulated PIDs driven by the current tune
//
// READ-ONLY BY DESIGN: send() refuses anything except AT setup commands,
// Mode 01 (live data), Mode 03 (stored codes) and Mode 09 PID 02 (VIN).
// Clearing codes (Mode 04) and every write/programming service are blocked.
// ==========================================================================
import { idleEstimate, idleRpmAt, clamp } from "./model.js";

const ALLOWED = /^(AT[A-Z0-9 .]{1,12}|01[0-9A-F]{2}( ?[0-9A-F]{2}){0,5}|03|0902)$/;

// Known BLE UART profiles used by common ELM327 BLE dongles
// (Vgate iCar Pro BLE, OBDLink CX, Veepeak BLE, generic FFF0/FFE0 clones).
const BLE_SERVICES = [
  0xfff0, 0xffe0, 0x18f0,
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "0000fff0-0000-1000-8000-00805f9b34fb",
];

export const PIDS = {
  "0C": { key: "rpm", name: "Engine RPM", unit: "rpm", parse: (a, b) => (a * 256 + b) / 4 },
  "0B": { key: "map", name: "Manifold pressure", unit: "kPa", parse: (a) => a },
  "05": { key: "ect", name: "Coolant temp", unit: "°C", parse: (a) => a - 40 },
  "0F": { key: "iat", name: "Intake air temp", unit: "°C", parse: (a) => a - 40 },
  "06": { key: "stft1", name: "Short trim B1", unit: "%", parse: (a) => ((a - 128) * 100) / 128 },
  "07": { key: "ltft1", name: "Long trim B1", unit: "%", parse: (a) => ((a - 128) * 100) / 128 },
  "08": { key: "stft2", name: "Short trim B2", unit: "%", parse: (a) => ((a - 128) * 100) / 128 },
  "09": { key: "ltft2", name: "Long trim B2", unit: "%", parse: (a) => ((a - 128) * 100) / 128 },
  "0E": { key: "timing", name: "Timing advance", unit: "°", parse: (a) => a / 2 - 64 },
  "11": { key: "tps", name: "Throttle", unit: "%", parse: (a) => (a * 100) / 255 },
  "0D": { key: "speed", name: "Speed", unit: "km/h", parse: (a) => a },
  "42": { key: "volts", name: "Module voltage", unit: "V", parse: (a, b) => (a * 256 + b) / 1000 },
  "04": { key: "load", name: "Calculated load", unit: "%", parse: (a) => (a * 100) / 255 },
  "10": { key: "maf", name: "MAF", unit: "g/s", parse: (a, b) => (a * 256 + b) / 100 },
};
const POLL = ["0C", "0B", "06", "07", "08", "09", "0E", "11", "0D", "05", "0F", "42", "04", "10"];

export const support = {
  ble: typeof navigator !== "undefined" && !!navigator.bluetooth,
  serial: typeof navigator !== "undefined" && !!navigator.serial,
};

/* ------------------------------------------------------------ transports */
class BleTransport {
  async open() {
    this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
    this.device.addEventListener("gattserverdisconnected", () => this.onclose?.());
    const server = await this.device.gatt.connect();
    let services = [];
    for (const s of BLE_SERVICES) { try { services.push(await server.getPrimaryService(s)); } catch {} }
    if (!services.length) { try { services = await server.getPrimaryServices(); } catch {} }
    for (const svc of services) {
      const chars = await svc.getCharacteristics();
      const n = chars.find((c) => c.properties.notify || c.properties.indicate);
      const w = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (n && w) { this.rx = n; this.tx = w; break; }
    }
    if (!this.rx) throw new Error("Connected, but this adapter doesn't expose a serial service. Make sure it's a Bluetooth LE (BLE) ELM327 adapter.");
    await this.rx.startNotifications();
    this.rx.addEventListener("characteristicvaluechanged", (e) => this.ondata?.(new TextDecoder().decode(e.target.value)));
    this.name = this.device.name || "BLE adapter";
  }
  async write(str) {
    const bytes = new TextEncoder().encode(str);
    for (let i = 0; i < bytes.length; i += 20) {
      const chunk = bytes.slice(i, i + 20);
      if (this.tx.properties.writeWithoutResponse) await this.tx.writeValueWithoutResponse(chunk);
      else await this.tx.writeValue(chunk);
    }
  }
  async close() { try { this.device?.gatt?.disconnect(); } catch {} }
}

class SerialTransport {
  constructor(baud = 38400) { this.baud = baud; }
  async open() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baud });
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    this.name = `USB adapter @ ${this.baud}`;
    (async () => {
      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          this.ondata?.(new TextDecoder().decode(value));
        }
      } catch {} finally { this.onclose?.(); }
    })();
  }
  async write(str) { await this.writer.write(new TextEncoder().encode(str)); }
  async close() { try { await this.reader?.cancel(); this.reader?.releaseLock(); this.writer?.releaseLock(); await this.port?.close(); } catch {} }
}

/* ------------------------------------------------------------- ELM327 */
export class Elm327 {
  constructor(transport) {
    this.t = transport;
    this.buf = "";
    this.queue = Promise.resolve();
    this.t.ondata = (s) => { this.buf += s; if (this.buf.includes(">")) { const r = this._resolve; this._resolve = null; const out = this.buf; this.buf = ""; r?.(out); } };
  }
  send(cmd, timeout = 4000) {
    const c = cmd.toUpperCase().trim();
    if (!ALLOWED.test(c)) return Promise.reject(new Error(`Blocked non-read-only command: ${c}`));
    const job = this.queue.then(() => new Promise((resolve, reject) => {
      this.buf = "";
      const to = setTimeout(() => { this._resolve = null; reject(new Error(`Timeout on ${c}`)); }, timeout);
      this._resolve = (s) => { clearTimeout(to); resolve(s.replace(/>/g, "").replace(/\r/g, "\n").split("\n").map((x) => x.trim()).filter(Boolean).filter((x) => x.toUpperCase() !== c).join("\n")); };
      this.t.write(c + "\r").catch(reject);
    }));
    this.queue = job.catch(() => {});
    return job;
  }
  async init(log = () => {}) {
    log("Resetting adapter…");
    await this.send("ATZ", 6000).catch(() => {});
    for (const c of ["ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATSP0"]) await this.send(c).catch(() => {});
    const id = await this.send("ATI").catch(() => "ELM327");
    log(`Adapter: ${id.split("\n")[0]}`);
    log("Searching for vehicle protocol…");
    const r = await this.send("0100", 12000);
    if (/UNABLE|NO DATA|ERROR|CAN ERROR|BUS INIT/i.test(r)) throw new Error("The adapter can't talk to the vehicle. Turn the key to ON (or start the engine) and try again.");
    const proto = await this.send("ATDPN").catch(() => "?");
    log(`Vehicle responded · protocol ${proto}`);
    this.supported = parseSupported(r);
    return { adapter: id, protocol: proto };
  }
  async readPid(pid) {
    const r = await this.send("01" + pid);
    const hex = r.replace(/[^0-9A-F]/gi, "").toUpperCase();
    const i = hex.indexOf("41" + pid);
    if (i < 0) return null;
    const a = parseInt(hex.substr(i + 4, 2), 16), b = parseInt(hex.substr(i + 6, 2), 16);
    if (Number.isNaN(a)) return null;
    return PIDS[pid].parse(a, Number.isNaN(b) ? 0 : b);
  }
  async sample() {
    const out = { t: performance.now() / 1000 };
    for (const pid of POLL) {
      if (this.supported && !this.supported.has(pid)) continue;
      try { const v = await this.readPid(pid); if (v != null) out[PIDS[pid].key] = v; } catch {}
    }
    return out;
  }
  async readDtcs() {
    const r = await this.send("03", 6000).catch(() => "");
    return parseDtcs(r);
  }
  async readVin() {
    const r = await this.send("0902", 6000).catch(() => "");
    const hex = r.replace(/^\s*\d:/gm, "").replace(/[^0-9A-F]/gi, "").toUpperCase();
    const i = hex.indexOf("4902");
    if (i < 0) return null;
    let s = "";
    for (let k = i + 6; k + 1 < hex.length; k += 2) { const ch = parseInt(hex.substr(k, 2), 16); if (ch >= 48 && ch <= 90) s += String.fromCharCode(ch); }
    return s.slice(-17) || null;
  }
  async close() { await this.t.close(); }
}

function parseSupported(r) {
  const hex = r.replace(/[^0-9A-F]/gi, "").toUpperCase();
  const i = hex.indexOf("4100");
  const set = new Set();
  if (i < 0) return null;
  const bits = parseInt(hex.substr(i + 4, 8), 16);
  for (let n = 0; n < 32; n++) if (bits & (1 << (31 - n))) set.add((n + 1).toString(16).toUpperCase().padStart(2, "0"));
  set.add("42"); // beyond 0x20 range; try anyway
  return set;
}

export function parseDtcs(r) {
  const lines = r.split("\n").map((l) => l.replace(/[^0-9A-F]/gi, "").toUpperCase()).filter((l) => l.startsWith("43"));
  const codes = [];
  for (let l of lines) {
    l = l.slice(2);
    if ((l.length / 2) % 2 === 1) l = l.slice(2); // CAN: leading count byte
    for (let i = 0; i + 4 <= l.length; i += 4) {
      const w = l.substr(i, 4);
      if (w === "0000") continue;
      const n = parseInt(w, 16);
      const sys = "PCBU"[(n >> 14) & 3];
      codes.push(sys + ((n >> 12) & 3) + w.substr(1, 3));
    }
  }
  return [...new Set(codes)];
}

/* ---------------------------------------------------------- connection */
export async function connect(kind, { baud, log } = {}) {
  const t = kind === "ble" ? new BleTransport() : new SerialTransport(baud);
  await t.open();
  const elm = new Elm327(t);
  const info = await elm.init(log);
  const vin = await elm.readVin().catch(() => null);
  return { elm, name: t.name, info, vin, transport: t };
}

/* ------------------------------------------------------- demo engine */
/** Simulated vehicle that reacts to the current tune and a throttle input. */
export class DemoEngine {
  constructor(getTune) {
    this.getTune = getTune;
    this.throttle = 0;
    this.ect = 88; this.t0 = performance.now() / 1000;
    this.rpm = 800; this.speed = 0;
    this.ltft1 = 1.6; this.ltft2 = 2.3;
    this.faults = { vacuumLeak: false };
  }
  sample() {
    const tune = this.getTune();
    const est = idleEstimate(tune.idle, tune.cam);
    const t = performance.now() / 1000 - this.t0;
    const idleRpm = idleRpmAt(t, tune.idle.rpmPark, est);
    const target = idleRpm + this.throttle * 4600;
    this.rpm += (target - this.rpm) * (this.throttle > 0.02 ? 0.35 : 0.22);
    const thr = this.throttle;
    const map = clamp(est.vacuum + thr * 62 + (Math.random() - 0.5) * 2 * (1 + est.lope * 2), 18, 101);
    const leak = this.faults.vacuumLeak ? 9 : 0;
    const stft1 = (Math.random() - 0.5) * 4 + leak * (1 - thr) * 0.6;
    const stft2 = (Math.random() - 0.5) * 4 + leak * (1 - thr) * 0.6;
    const timing = thr > 0.05 ? 18 + thr * 10 : tune.idle.sparkIdle + (tune.idle.rpmPark - idleRpm) * 0.08 * (tune.idle.stability / 100) + (Math.random() - 0.5);
    this.ect = Math.min(93, this.ect + 0.002);
    return {
      t: performance.now() / 1000, rpm: this.rpm, map, ect: this.ect, iat: 31 + Math.sin(t / 30) * 2,
      stft1, stft2, ltft1: this.ltft1 + leak * 0.4, ltft2: this.ltft2 + leak * 0.4,
      timing, tps: thr * 100, speed: 0, volts: 14.1 + (Math.random() - 0.5) * 0.08 - thr * 0.05,
      load: clamp(map / 1.05, 0, 100), maf: 5 + (this.rpm / 800) * (map / 45) * 3,
    };
  }
  readDtcs() { return this.faults.vacuumLeak ? ["P0171", "P0174"] : []; }
}
