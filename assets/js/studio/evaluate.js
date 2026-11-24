// Diagnostics evaluation, log parsing, trim binning and tune recommendations.
import { RPM_AXIS, MAP_AXIS, CYLAIR_AXIS, limitFor, clamp, idleEstimate } from "./model.js";

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const std = (a) => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : NaN; };
const col = (S, k) => S.map((s) => s[k]).filter((v) => typeof v === "number" && Number.isFinite(v));
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "—");

const DTC_INFO = {
  P0171: "System too lean, bank 1", P0174: "System too lean, bank 2", P0172: "System too rich, bank 1", P0175: "System too rich, bank 2",
  P0300: "Random / multiple misfire", P0101: "MAF sensor performance", P0102: "MAF sensor low", P0103: "MAF sensor high",
  P0106: "MAP sensor performance", P0506: "Idle RPM lower than expected", P0507: "Idle RPM higher than expected",
  P0420: "Catalyst efficiency, bank 1", P0430: "Catalyst efficiency, bank 2", P0128: "Coolant below thermostat temperature",
  P0325: "Knock sensor circuit, bank 1", P0330: "Knock sensor circuit, bank 2", P0521: "Oil pressure sensor performance",
  P3400: "Cylinder deactivation (AFM) system", P0011: "Intake cam position timing over-advanced", P0016: "Crank/cam correlation",
};
export const dtcText = (c) => DTC_INFO[c] || (/^P030[1-8]$/.test(c) ? `Misfire detected, cylinder ${c[4]}` : "See service information");

/**
 * Evaluate a capture. mode: "idle" | "drive".
 * Returns readiness score and grouped, plain-language findings.
 */
export function evaluate(samples, { mode = "idle", dtcs = [], project = {} } = {}) {
  const G = { safe: [], attention: [], no: [], unneeded: [] };
  const checks = [];
  const S = samples.filter((s) => (s.rpm ?? 0) > 350);
  if (S.length < 8) {
    return { readiness: 0, verdict: "Not enough data", tone: "warn", stats: {}, checks: [{ label: "Samples", status: "warn", detail: `Only ${S.length} running samples. Capture at least 30 seconds with the engine running.` }], groups: G };
  }
  const idle = mode === "idle" ? S : S.filter((s) => (s.tps ?? 0) < 3 && (s.speed ?? 0) < 3);
  const ectArr = col(S, "ect");
  const stats = {
    n: S.length,
    duration: (S[S.length - 1].t ?? S.length) - (S[0].t ?? 0),
    rpm: mean(col(idle, "rpm")), rpmStd: std(col(idle, "rpm")),
    map: mean(col(idle, "map")), ect: ectArr.length ? ectArr[ectArr.length - 1] : NaN,
    b1: mean(col(idle, "stft1")) + (mean(col(idle, "ltft1")) || 0), b2: mean(col(idle, "stft2")) + (mean(col(idle, "ltft2")) || 0),
    timing: mean(col(idle, "timing")), timingStd: std(col(idle, "timing")),
    volts: mean(col(S, "volts")), voltsMin: Math.min(...col(S, "volts")),
    knockMax: Math.max(0, ...col(S, "knock")),
  };
  let score = 100;
  const open = project.exhaust === "open";

  // warm-up
  if (Number.isFinite(stats.ect)) {
    if (stats.ect < 75) { score -= 15; checks.push({ label: "Engine temperature", status: "warn", detail: `${f1(stats.ect)} °C. Idle numbers aren't representative until coolant reaches about 80 °C.` }); G.attention.push({ t: "Warm the engine up fully", d: "Re-run the test once coolant is above 80 °C. Cold idle runs richer and faster on purpose." }); }
    else checks.push({ label: "Engine temperature", status: "good", detail: `${f1(stats.ect)} °C, fully warm.` });
  }

  // electrical
  if (Number.isFinite(stats.volts)) {
    if (stats.volts < 13.2) { score -= 12; checks.push({ label: "Charging voltage", status: "warn", detail: `${stats.volts.toFixed(2)} V running. Expect 13.5–14.7 V.` }); G.attention.push({ t: "Check battery & charging", d: "Low running voltage. Fix it before flashing, and always use a battery maintainer during a write." }); }
    else if (stats.volts > 15) { score -= 8; checks.push({ label: "Charging voltage", status: "warn", detail: `${stats.volts.toFixed(2)} V is high. Check the regulator.` }); }
    else checks.push({ label: "Charging voltage", status: "good", detail: `${stats.volts.toFixed(2)} V. Healthy.` });
  }

  // fuel trims
  const trimRule = (bank, v) => {
    if (!Number.isFinite(v)) return;
    const a = Math.abs(v);
    if (a > 10) {
      score -= 25;
      checks.push({ label: `Fuel trim bank ${bank}`, status: "crit", detail: `${v > 0 ? "+" : ""}${f1(v)}% total correction at idle.` });
      G.no.push({ t: `Don't add lope yet. Bank ${bank} is correcting ${v > 0 ? "+" : ""}${f1(v)}%`, d: v > 0 ? `The ECM is adding a lot of fuel. Usual causes: vacuum leak, weak injector, MAF reading low${open ? ", or open headers letting outside air reach the O2 sensors (reversion), which reads falsely lean" : ""}. Lowering idle spark on top of a lean idle invites stalls.` : "The ECM is pulling a lot of fuel. Check for leaking injectors, high fuel pressure or a fouled O2 sensor." });
    } else if (a > 5) {
      score -= 10;
      checks.push({ label: `Fuel trim bank ${bank}`, status: "warn", detail: `${v > 0 ? "+" : ""}${f1(v)}% at idle. Workable, worth correcting.` });
      G.attention.push({ t: `Correct idle VE on bank ${bank}`, d: `Trims around ${f1(v)}% point to a small VE error at idle. The log assistant can stage a correction${open ? ". With open headers, confirm the O2 sensors aren't seeing reversion first" : ""}.` });
    } else {
      checks.push({ label: `Fuel trim bank ${bank}`, status: "good", detail: `${v > 0 ? "+" : ""}${f1(v)}%. Within ±5%.` });
    }
  };
  trimRule(1, stats.b1); trimRule(2, stats.b2);
  if (Number.isFinite(stats.b1) && Number.isFinite(stats.b2) && Math.abs(stats.b1 - stats.b2) > 6) {
    score -= 8;
    G.attention.push({ t: "Banks don't agree", d: `Bank 1 and bank 2 differ by ${f1(Math.abs(stats.b1 - stats.b2))}%. Look for a leak or injector issue on one side before tuning.` });
  }

  // idle stability
  if (Number.isFinite(stats.rpmStd)) {
    const est = project.cam && project.idle ? idleEstimate(project.idle, project.cam) : null;
    const expected = est ? est.swing * 0.7 : 35;
    if (stats.rpmStd > Math.max(55, expected * 1.6)) {
      score -= 15;
      checks.push({ label: "Idle stability", status: "warn", detail: `RPM varies ±${f1(stats.rpmStd)} (σ) around ${Math.round(stats.rpm)}.` });
      G.attention.push({ t: "Idle is less stable than the tune predicts", d: "Rule out a misfire, vacuum leak or worn plugs before adding more lope. A healthy cam idle repeats a rhythm. A sick one wanders." });
    } else checks.push({ label: "Idle stability", status: "good", detail: `±${f1(stats.rpmStd)} rpm (σ) around ${Math.round(stats.rpm)} rpm.` });
  }

  // vacuum
  if (Number.isFinite(stats.map)) {
    if (stats.map > 60) { score -= 6; checks.push({ label: "Idle vacuum", status: "warn", detail: `${Math.round(stats.map)} kPa MAP. Low vacuum.` }); G.attention.push({ t: "Low idle vacuum", d: "Above ~60 kPa the brake booster has less assist, and the in-gear idle needs more airflow. Keep the in-gear idle target conservative." }); }
    else checks.push({ label: "Idle vacuum", status: "good", detail: `${Math.round(stats.map)} kPa MAP.` });
  }

  // codes
  const misfire = dtcs.filter((c) => /^P030\d$/.test(c));
  if (dtcs.length) {
    score -= Math.min(40, dtcs.length * 10 + misfire.length * 15);
    checks.push({ label: "Trouble codes", status: misfire.length ? "crit" : "warn", detail: dtcs.map((c) => `${c} · ${dtcText(c)}`).join(" · ") });
    if (misfire.length) G.no.push({ t: "Fix misfires before any tuning", d: `Stored ${misfire.join(", ")}. Tuning can mask a mechanical problem. Check plugs, wires, coils and compression first.` });
    else G.attention.push({ t: `Resolve ${dtcs.length} stored code${dtcs.length > 1 ? "s" : ""}`, d: dtcs.map((c) => `${c}: ${dtcText(c)}`).join(". ") + "." });
  } else checks.push({ label: "Trouble codes", status: "good", detail: "No stored codes." });

  // driving-only checks
  if (mode === "drive") {
    const wot = S.filter((s) => (s.tps ?? 0) > 60 && (s.rpm ?? 0) > 2500);
    if (wot.length > 3) {
      const tdrop = col(wot, "timing");
      const drops = tdrop.slice(1).filter((v, i) => tdrop[i] - v > 4).length;
      if (stats.knockMax > 1.5 || drops > 1) { score -= 15; G.no.push({ t: "Don't add timing", d: stats.knockMax > 0 ? `Knock retard reached ${f1(stats.knockMax)}°. Run better fuel or pull timing in that area first.` : "Timing dropped sharply under load, which usually means knock retard. Log real knock retard with HP Tuners or EFILive before changing spark." }); }
      else G.safe.push({ t: "Spark is stable under load", d: "No sudden timing drops at wide-open throttle in this capture." });
    } else {
      G.unneeded.push({ t: "WOT analysis", d: "No wide-open-throttle data in this capture. That's fine for an idle and lope tune." });
    }
  }

  // positive / guidance lists
  const trimsOk = [stats.b1, stats.b2].every((v) => !Number.isFinite(v) || Math.abs(v) <= 5);
  const noMisfire = misfire.length === 0;
  if (trimsOk && noMisfire && (stats.ect ?? 90) >= 75) {
    G.safe.push({ t: "Idle & lope tuning (Street presets)", d: "Fueling and stability look healthy enough to shape the idle within the Street safe band." });
    G.safe.push({ t: "Small idle-target adjustments (±25 rpm)", d: "Raise the in-gear target if the idle feels heavy with the A/C on." });
  }
  if (trimsOk) G.unneeded.push({ t: "Large VE rework", d: "Trims are within ±5%. A full VE rescale isn't needed for an idle tune." });
  G.unneeded.push({ t: "Higher rev limit", d: "Not needed for lope or drivability. Leave it at 6,000 rpm unless the valvetrain is built for more." });
  G.no.push({ t: "Changing knock, cranking or cold-start tables", d: "These protect the engine and startability, so Stagline keeps them locked." });
  if (!G.no.some((x) => x.t.startsWith("Don't add timing"))) G.no.push({ t: "Adding WOT timing without knock data", d: "Standard OBD2 can't read GM knock retard. Use a full scan tool log before touching high-load spark." });

  score = clamp(Math.round(score), 0, 100);
  const tone = score >= 80 ? "good" : score >= 55 ? "warn" : "crit";
  const verdict = score >= 80 ? "Ready for an idle & lope tune" : score >= 55 ? "Fix the flagged items, then tune" : "Not ready to tune";
  return { readiness: score, verdict, tone, stats, checks, groups: G };
}

/* -------------------------------------------------------------- CSV logs */
const CH = [
  ["time", /^(time|offset|seconds|timestamp|elapsed)/i],
  ["rpm", /(engine\s*)?(rpm|speed\s*\(rpm\))|engine rpm/i],
  ["map", /manifold\s*abs|\bmap\b|intake manifold.*pressure/i],
  ["ect", /coolant|\bect\b/i],
  ["iat", /intake air temp|\biat\b/i],
  ["knock", /knock\s*retard|\bkr\b|knock/i],
  ["timing", /timing\s*adv|spark\s*adv|ignition timing/i],
  ["tps", /throttle\s*pos|\btps\b|throttle/i],
  ["speed", /vehicle\s*speed|\bspeed\b|\bvss\b/i],
  ["volts", /volt|battery/i],
  ["afr", /wideband|air.?fuel|\bafr\b|lambda|eq.*ratio/i],
];
function classify(name) {
  const n = name.trim();
  const st = /(short\s*term|\bstft\b)/i.test(n), lt = /(long\s*term|\bltft\b)/i.test(n);
  if (st || lt) { const b2 = /(bank\s*2|\bb2\b|bk\s*2|bank2)/i.test(n); return (st ? "stft" : "ltft") + (b2 ? "2" : "1"); }
  for (const [k, re] of CH) if (re.test(n)) {
    if (k === "rpm" && /desired|target/i.test(n)) return null;
    if (k === "speed" && /engine/i.test(n)) return "rpm";
    return k;
  }
  return null;
}
function splitCsv(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if ((ch === "," || ch === ";" || ch === "\t") && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseLogCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const cells = splitCsv(lines[i]);
    const score = cells.filter((c) => classify(c)).length;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best < 0 || bestScore < 2) throw new Error("Couldn't find channel names. Export the log as CSV with a header row that includes RPM.");
  const header = splitCsv(lines[best]);
  const map = {};
  header.forEach((h, i) => { const k = classify(h); if (k && map[k] == null) map[k] = i; });
  if (map.rpm == null) throw new Error("The log needs an engine RPM channel.");
  const samples = [];
  for (let i = best + 1; i < lines.length; i++) {
    const cells = splitCsv(lines[i]);
    const s = {};
    let ok = false;
    for (const [k, idx] of Object.entries(map)) {
      const v = parseFloat(cells[idx]);
      if (Number.isFinite(v)) { s[k] = v; ok = true; }
    }
    if (ok && Number.isFinite(s.rpm)) { s.t = s.time ?? samples.length * 0.1; samples.push(s); }
  }
  const warnings = [];
  // unit fixes
  for (const k of ["ect", "iat"]) {
    const m = mean(col(samples, k));
    if (m > 130) { samples.forEach((s) => { if (s[k] != null) s[k] = ((s[k] - 32) * 5) / 9; }); warnings.push(`${k.toUpperCase()} looked like °F, converted to °C.`); }
  }
  const afr = mean(col(samples, "afr"));
  if (afr > 0.5 && afr < 1.5) { samples.forEach((s) => { if (s.afr != null) s.afr *= 14.7; }); warnings.push("Wideband looked like lambda, converted to AFR."); }
  const missing = ["map", "stft1", "ltft1", "timing", "ect"].filter((k) => map[k] == null);
  if (missing.length) warnings.push(`Missing channels: ${missing.join(", ")}. Some analysis is limited.`);
  return { samples, columns: Object.fromEntries(Object.entries(map).map(([k, i]) => [k, header[i].trim()])), warnings };
}

/** Bin total fuel trim into the VE grid (MAP rows × RPM cols). */
export function binTrims(samples) {
  const R = MAP_AXIS.length, C = RPM_AXIS.length;
  const sum = Array.from({ length: R }, () => Array(C).fill(0));
  const n = Array.from({ length: R }, () => Array(C).fill(0));
  const near = (axis, v) => { let bi = 0, bd = Infinity; axis.forEach((a, i) => { const d = Math.abs(a - v); if (d < bd) { bd = d; bi = i; } }); return bi; };
  for (const s of samples) {
    if (!Number.isFinite(s.rpm) || !Number.isFinite(s.map)) continue;
    const banks = [];
    if (Number.isFinite(s.stft1) || Number.isFinite(s.ltft1)) banks.push((s.stft1 || 0) + (s.ltft1 || 0));
    if (Number.isFinite(s.stft2) || Number.isFinite(s.ltft2)) banks.push((s.stft2 || 0) + (s.ltft2 || 0));
    if (!banks.length) continue;
    if ((s.tps ?? 0) > 75) continue; // open loop — trims frozen
    const r = near(MAP_AXIS, s.map), c = near(RPM_AXIS, s.rpm);
    sum[r][c] += mean(banks); n[r][c]++;
  }
  return { mean: sum.map((row, r) => row.map((v, c) => (n[r][c] ? v / n[r][c] : null))), n };
}

/**
 * Turn binned trims + knock into staged recommendations.
 * Each rec: { id, kind, title, detail, confidence, cells:[{r,c,delta}] }
 */
export function recommend(samples, plan, project = {}) {
  const recs = [];
  const { mean: tm, n } = binTrims(samples);
  const [vlo, vhi] = limitFor("ve", plan);
  const cells = [];
  tm.forEach((row, r) => row.forEach((v, c) => { if (v != null && n[r][c] >= 5 && Math.abs(v) >= 2) cells.push({ r, c, delta: +clamp(v * 0.9, vlo, vhi).toFixed(1), n: n[r][c], trim: v }); }));
  if (cells.length) {
    const pos = cells.filter((x) => x.delta > 0), neg = cells.filter((x) => x.delta < 0);
    const group = (arr, sign) => {
      if (!arr.length) return;
      const rpms = arr.map((x) => RPM_AXIS[x.c]), maps = arr.map((x) => MAP_AXIS[x.r]);
      const avg = mean(arr.map((x) => x.trim));
      const total = arr.reduce((s, x) => s + x.n, 0);
      recs.push({
        id: "ve" + sign, kind: "ve",
        title: `${sign > 0 ? "Add" : "Remove"} ~${Math.abs(avg).toFixed(1)}% VE in ${arr.length} cell${arr.length > 1 ? "s" : ""}`,
        detail: `${Math.min(...rpms)}–${Math.max(...rpms)} rpm, ${Math.min(...maps)}–${Math.max(...maps)} kPa. Closed-loop trims averaged ${avg > 0 ? "+" : ""}${avg.toFixed(1)}% over ${total} samples. Correcting 90% of it leaves margin for O2 noise.${project.exhaust === "open" && sign > 0 ? " With open headers, confirm the O2 sensors aren't reading reversion air before applying." : ""}`,
        confidence: clamp(total / 120, 0.35, 0.95),
        cells: arr.map(({ r, c, delta }) => ({ r, c, delta })),
      });
    };
    group(pos, 1); group(neg, -1);
  }
  // knock → spark pull
  const knocks = samples.filter((s) => (s.knock ?? 0) >= 1 && Number.isFinite(s.rpm));
  if (knocks.length) {
    const [slo] = limitFor("spark", plan);
    const near = (axis, v) => axis.reduce((bi, a, i) => (Math.abs(a - v) < Math.abs(axis[bi] - v) ? i : bi), 0);
    const set = new Map();
    for (const s of knocks) {
      const load = s.map != null ? clamp(0.08 + ((s.map - 15) / 90) * 1.12, 0.08, 1.2) : 0.9;
      const r = near(CYLAIR_AXIS, load), c = near(RPM_AXIS, s.rpm);
      const k = r + ":" + c;
      set.set(k, Math.max(set.get(k) || 0, s.knock));
    }
    const kc = [...set.entries()].map(([k, kr]) => { const [r, c] = k.split(":").map(Number); return { r, c, delta: -clamp(Math.ceil(kr), 1, -slo) }; });
    const maxK = Math.max(...knocks.map((s) => s.knock));
    recs.unshift({
      id: "knock", kind: "spark", severity: "crit",
      title: `Pull timing where knock was logged (up to ${maxK.toFixed(1)}°)`,
      detail: `${knocks.length} samples showed knock retard of 1° or more. Removing that much timing (rounded up) in the affected cells is the conservative fix. Check fuel quality too.`,
      confidence: 0.9, cells: kc,
    });
  }
  // idle character
  if (project.idle) {
    const idleS = samples.filter((s) => (s.tps ?? 0) < 2 && (s.speed ?? 0) < 2 && s.rpm > 400 && s.rpm < 1100);
    if (idleS.length > 20) {
      const sd = std(col(idleS, "rpm"));
      const m = mean(col(idleS, "rpm"));
      if (m < project.idle.rpmDrive - 60) recs.push({ id: "idle-low", kind: "idle", title: "Raise the in-gear idle target 25 rpm", detail: `Logged idle averaged ${Math.round(m)} rpm, well below the ${project.idle.rpmDrive} rpm target. The ECM is running out of airflow or spark reserve.`, confidence: 0.7, idle: { rpmDrive: project.idle.rpmDrive + 25 } });
      if (sd < 12 && project.idle.stability > 60) recs.push({ id: "idle-smooth", kind: "idle", title: "There's room for more lope", detail: `Idle is very steady (σ ${sd.toFixed(1)} rpm). Lowering stability correction to 70% adds rhythm with little stall risk.`, confidence: 0.6, idle: { stability: 70 } });
    }
  }
  return recs;
}

/* ------------------------------------------------------- sample log */
export function sampleLog() {
  // Deterministic synthetic log: warm idle, light cruise, one pull with a knock blip.
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = []; let t = 0;
  const push = (o) => { out.push({ t: +t.toFixed(2), ...o }); t += 0.1; };
  for (let i = 0; i < 400; i++) { const rpm = 790 + Math.sin(t * 6.5) * 38 + (rnd() - 0.5) * 14; push({ rpm, map: 47 + (rnd() - 0.5) * 4, ect: 89, iat: 33, stft1: 2 + (rnd() - 0.5) * 3, ltft1: 3.1, stft2: 1.4 + (rnd() - 0.5) * 3, ltft2: 3.5, timing: 16 + (rnd() - 0.5) * 3, tps: 0, speed: 0, volts: 14.2, knock: 0 }); }
  for (let i = 0; i < 900; i++) { const k = i / 900; const rpm = 1250 + 900 * Math.sin(k * Math.PI) + (rnd() - 0.5) * 40; const map = 34 + 22 * Math.abs(Math.sin(k * 9)) + (rnd() - 0.5) * 3; const bias = map < 46 && rpm < 2000 ? 6.2 : map > 50 && rpm > 1800 ? -4.1 : 0.8; push({ rpm, map, ect: 91, iat: 36, stft1: bias * 0.4 + (rnd() - 0.5) * 3, ltft1: bias * 0.6, stft2: bias * 0.4 + (rnd() - 0.5) * 3, ltft2: bias * 0.6 + 0.5, timing: 28 + (rnd() - 0.5) * 4, tps: 12 + 10 * Math.abs(Math.sin(k * 9)), speed: 55 + 25 * Math.sin(k * Math.PI), volts: 14.1, knock: 0 }); }
  for (let i = 0; i < 60; i++) { const k = i / 60; const rpm = 2600 + 3100 * k; push({ rpm, map: 98, ect: 92, iat: 38, stft1: 0, ltft1: 3, stft2: 0, ltft2: 3, timing: rpm > 3000 && rpm < 3500 ? 19.5 : 23, tps: 100, speed: 70 + 40 * k, volts: 14.0, knock: rpm > 3000 && rpm < 3500 ? 1.5 + rnd() : 0, afr: 12.6 + (rnd() - 0.5) * 0.3 }); }
  for (let i = 0; i < 200; i++) { push({ rpm: 760 + Math.sin(t * 6.5) * 30 + (rnd() - 0.5) * 12, map: 52, ect: 92, iat: 38, stft1: 1, ltft1: 3, stft2: 1, ltft2: 3.4, timing: 18, tps: 0, speed: 0, volts: 14.1, knock: 0 }); }
  return out;
}
export function toCSV(samples) {
  const keys = ["t", "rpm", "map", "ect", "iat", "stft1", "ltft1", "stft2", "ltft2", "timing", "knock", "tps", "speed", "volts", "afr"];
  const names = ["Time (s)", "Engine RPM", "MAP (kPa)", "Coolant Temp (C)", "Intake Air Temp (C)", "Short Term Fuel Trim Bank 1 (%)", "Long Term Fuel Trim Bank 1 (%)", "Short Term Fuel Trim Bank 2 (%)", "Long Term Fuel Trim Bank 2 (%)", "Timing Advance (deg)", "Knock Retard (deg)", "Throttle Position (%)", "Vehicle Speed (km/h)", "Module Voltage (V)", "Wideband AFR"];
  return [names.join(","), ...samples.map((s) => keys.map((k) => (s[k] == null ? "" : +(+s[k]).toFixed(3))).join(","))].join("\n");
}
