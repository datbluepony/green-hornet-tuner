// ==========================================================================
// Tune model: stock baseline tables, cam math, idle/lope estimator,
// guardrails per plan, and the drive-cycle simulator.
//
// IMPORTANT: everything here is a *simplified engineering model* meant to
// show direction and relative magnitude of a change. It is not a validated
// combustion model and it cannot know the condition of a real engine.
// ==========================================================================

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/* ----------------------------------------------------------- vehicles */
export const VEHICLES = {
  "gmt900-53": {
    label: "2007–2013 GM truck · 5.3L Gen IV (LY5 / LMG / LC9)",
    short: "5.3L Gen IV · E38",
    ecm: "E38",
    displacement: 5.3,
    binSize: 2 * 1024 * 1024,
    support: "preview",
  },
  "gmt900-48": { label: "2007–2013 GM truck · 4.8L Gen IV (LY2)", short: "4.8L Gen IV · E38", ecm: "E38", displacement: 4.8, binSize: 2 * 1024 * 1024, support: "preview" },
  "gmt900-60": { label: "2007–2013 GM truck · 6.0L Gen IV (LY6 / L96)", short: "6.0L Gen IV · E38", ecm: "E38", displacement: 6.0, binSize: 2 * 1024 * 1024, support: "preview" },
  "gmt900-62": { label: "2009–2013 GM truck · 6.2L Gen IV (L9H)", short: "6.2L Gen IV · E38", ecm: "E38", displacement: 6.2, binSize: 2 * 1024 * 1024, support: "preview" },
  "gen3-p01": { label: "1999–2003 Gen III LS (P01) · 4.8 / 5.3 / 5.7 / 6.0", short: "Gen III · P01", ecm: "P01", displacement: 5.3, binSize: 512 * 1024, support: "planned" },
  "gen3-p59": { label: "2004–2007 Gen III LS (P59) · 4.8 / 5.3 / 6.0", short: "Gen III · P59", ecm: "P59", displacement: 5.3, binSize: 1024 * 1024, support: "planned" },
};

// Typical published specs. Users should always enter their own cam card.
export const CAMS = {
  stock: { label: "Stock 5.3L Gen IV (approx.)", int: 191, exh: 190, lsa: 116, liftI: 0.457, liftE: 0.457 },
  stage1: { label: "Stage 1 truck cam (typical)", int: 212, exh: 218, lsa: 114, liftI: 0.55, liftE: 0.55 },
  stage2: { label: "Stage 2 truck cam (typical)", int: 218, exh: 226, lsa: 113, liftI: 0.575, liftE: 0.575 },
  stage3: { label: "Stage 3 truck cam (typical)", int: 224, exh: 232, lsa: 112, liftI: 0.595, liftE: 0.595 },
  custom: { label: "Custom — from my cam card", int: 224, exh: 232, lsa: 112, liftI: 0.595, liftE: 0.595 },
};

/** Valve overlap at .050" in crank degrees. */
export function overlap(cam) {
  return (cam.int + cam.exh) / 2 - 2 * cam.lsa;
}
/** 0 (stock, no lope) … ~1.2 (big cam). How much "chop" the cam can make. */
export function camFactor(cam) {
  return clamp((overlap(cam) + 45) / 50, 0, 1.25);
}

/* -------------------------------------------------------------- axes */
export const RPM_AXIS = Array.from({ length: 17 }, (_, i) => 400 + i * 400); // 400–6800
export const MAP_AXIS = Array.from({ length: 19 }, (_, i) => 15 + i * 5); // 15–105 kPa
export const CYLAIR_AXIS = Array.from({ length: 15 }, (_, i) => +(0.08 + i * 0.08).toFixed(2)); // g/cyl

/** Stock-like volumetric efficiency (% VE), rows = MAP, cols = RPM. */
export function stockVE() {
  return MAP_AXIS.map((map) =>
    RPM_AXIS.map((rpm) => {
      const r = (rpm - 4300) / 4300;
      const base = 0.5 + 0.42 * (1 - r * r);
      const m = 0.66 + 0.34 * ((map - 15) / 90);
      const ripple = 0.012 * Math.sin(rpm / 520) * (map / 105);
      return +(100 * clamp(base * m + ripple, 0.28, 0.98)).toFixed(1);
    })
  );
}

/** Stock-like high-octane spark (deg BTDC), rows = cyl airmass, cols = RPM. */
export function stockSpark() {
  return CYLAIR_AXIS.map((air) =>
    RPM_AXIS.map((rpm) => {
      const rf = Math.pow(clamp((rpm - 400) / 2800, 0, 1), 0.7);
      const lf = (air - 0.08) / (1.2 - 0.08);
      const s = 12 + 10 * rf + 23 * (1 - lf) * rf - 1.5 * lf * clamp((rpm - 4400) / 2400, 0, 1);
      return +clamp(s, 8, 46).toFixed(1);
    })
  );
}

export const zeros = (rows, cols) => Array.from({ length: rows }, () => Array(cols).fill(0));

/* -------------------------------------------------------- guardrails */
// [min, max] hard limits by plan, plus a "recommended" band.
export const GUARDS = {
  rpmPark: { unit: "rpm", step: 5, rec: [775, 875], street: [725, 925], advanced: [650, 1000] },
  rpmDrive: { unit: "rpm", step: 5, rec: [700, 800], street: [675, 850], advanced: [600, 900] },
  sparkIdle: { unit: "°", step: 0.5, rec: [15, 22], street: [12, 24], advanced: [8, 26] },
  stability: { unit: "%", step: 1, rec: [45, 100], street: [30, 100], advanced: [0, 100] },
  airflow: { unit: "%", step: 0.5, rec: [-2, 6], street: [-5, 8], advanced: [-10, 15] },
  enrich: { unit: "%", step: 0.5, rec: [0, 3], street: [0, 4], advanced: [0, 6] },
  ve: { unit: "%", street: [-5, 5], advanced: [-12, 12] },
  spark: { unit: "°", street: [-4, 1], advanced: [-8, 3] },
  revLimit: { unit: "rpm", step: 50, rec: [5800, 6200], street: [6000, 6000], advanced: [5000, 6400] },
};
export const limitFor = (key, plan) => GUARDS[key][plan === "advanced" ? "advanced" : "street"];

export function defaultIdle(camKey = "stage3") {
  const big = camFactor(CAMS[camKey] || CAMS.stage3) > 0.6;
  return {
    rpmPark: big ? 800 : 650,
    rpmDrive: big ? 750 : 600,
    sparkIdle: 20,
    stability: 100,
    airflow: 0,
    enrich: 0,
  };
}

export const LOPE_PRESETS = {
  smooth: { label: "Smooth", desc: "Cam-tune baseline. Quiet, very stable.", v: { rpmPark: 825, rpmDrive: 760, sparkIdle: 21, stability: 100, airflow: 1, enrich: 0 } },
  mild: { label: "Mild chop", desc: "Noticeable rhythm, stock-like manners.", v: { rpmPark: 800, rpmDrive: 750, sparkIdle: 18, stability: 75, airflow: 0.5, enrich: 1 } },
  aggressive: { label: "Aggressive", desc: "Strong lope while staying inside the safe band.", v: { rpmPark: 790, rpmDrive: 740, sparkIdle: 16, stability: 50, airflow: 1.5, enrich: 2 } },
  // only reachable with Advanced
  wild: { label: "Show (Advanced)", desc: "Maximum chop. Expect a heavier idle in gear.", advanced: true, v: { rpmPark: 760, rpmDrive: 720, sparkIdle: 13, stability: 25, airflow: 2.5, enrich: 3 } },
};

/* ---------------------------------------------------- idle estimator */
/**
 * Estimate idle character for a set of idle parameters and a cam.
 * Returns normalized lope (0–1) plus human-scale metrics.
 */
export function idleEstimate(p, cam) {
  const cf = camFactor(cam);
  const lopeRaw =
    0.36 +
    0.026 * (20 - p.sparkIdle) +
    0.0042 * (100 - p.stability) +
    0.0011 * (800 - p.rpmPark) +
    0.012 * p.enrich -
    0.006 * p.airflow;
  const lope = clamp(cf * lopeRaw, 0, 1);

  const swing = 6 + lope * 58 + Math.max(0, 14 - p.sparkIdle) * 2.5; // ± rpm
  const sparkReserve = p.sparkIdle - 10; // room the ECM has to catch a sag
  const stallRisk = clamp(
    ((700 - p.rpmDrive) / 160) * 0.55 +
      lope * 0.32 +
      Math.max(0, 15 - p.sparkIdle) * 0.045 +
      Math.max(0, -p.airflow) * 0.045 -
      (p.stability / 100) * 0.14 -
      (sparkReserve > 8 ? 0.04 : 0),
    0, 1
  );
  const startability = clamp(
    100 - Math.max(0, -p.airflow) * 4.5 - Math.max(0, 760 - p.rpmPark) * 0.12 - Math.max(0, lope - 0.75) * 28 - Math.max(0, 12 - p.sparkIdle) * 2,
    0, 100
  );
  const heat = clamp(Math.max(0, 19 - p.sparkIdle) * 0.11 + p.enrich * 0.02, 0, 1); // EGT / coolant load at long idle
  const vacuum = 30 + cf * 17 + (800 - p.rpmPark) * 0.012 + lope * 4; // MAP kPa at idle
  const drivability = clamp(100 - stallRisk * 70 - Math.max(0, lope - 0.6) * 25, 0, 100);
  const economy = -(p.enrich * 0.6 + Math.max(0, 20 - p.sparkIdle) * 0.35); // % idle fuel use change (neg = more fuel)
  return {
    lope, cf, swing, stallRisk, startability, heat, vacuum, drivability, economy,
    lopeHz: 0.9 + (p.rpmPark - 700) / 400, // perceived lope rhythm
  };
}

/** Deterministic instantaneous idle RPM — drives the trace and the synth. */
export function idleRpmAt(t, base, est) {
  const L = est.lope;
  const f = est.lopeHz;
  const a = est.swing;
  const lope = Math.sin(2 * Math.PI * f * t) * 0.62 + Math.sin(2 * Math.PI * f * 2.07 * t + 1.3) * 0.25 + Math.sin(2 * Math.PI * 7.3 * t) * 0.08;
  const sharp = Math.sign(lope) * Math.pow(Math.abs(lope), 1 - L * 0.5);
  return base + a * sharp;
}

/* --------------------------------------------------------- spark/ve util */
export function cellIndex(axis, v) {
  if (v <= axis[0]) return [0, 0, 0];
  if (v >= axis[axis.length - 1]) return [axis.length - 1, axis.length - 1, 0];
  for (let i = 0; i < axis.length - 1; i++) {
    if (v >= axis[i] && v <= axis[i + 1]) return [i, i + 1, (v - axis[i]) / (axis[i + 1] - axis[i])];
  }
  return [0, 0, 0];
}
export function sample2D(table, rowAxis, colAxis, rv, cv) {
  const [r0, r1, rt] = cellIndex(rowAxis, rv);
  const [c0, c1, ct] = cellIndex(colAxis, cv);
  const a = lerp(table[r0][c0], table[r0][c1], ct);
  const b = lerp(table[r1][c0], table[r1][c1], ct);
  return lerp(a, b, rt);
}

/* ----------------------------------------------------------- simulator */
// Octane → knock-safe additional advance at high load (deg) — conservative.
const OCTANE_MARGIN = { 87: -1.5, 89: 0, 91: 1.0, 93: 1.6, E85: 4 };

/**
 * Simulate a compressed drive cycle with the current tune.
 * Returns time series + scorecard. Pure & deterministic.
 */
export function simulateCycle(tune) {
  const cam = tune.cam;
  const idle = tune.idle;
  const est = idleEstimate(idle, cam);
  const cf = est.cf;
  const fuel = tune.fuel || "93";
  const margin = OCTANE_MARGIN[fuel] ?? 0;
  const ve = tune.veDelta, sp = tune.sparkDelta;
  const stockSp = STOCK_SPARK;
  const dt = 0.05;
  const T = 48;
  const out = { t: [], rpm: [], lambda: [], spark: [], knock: [], trim: [], phase: [], speed: [] };
  const phases = [
    [0, 3, "Crank & cold start"],
    [3, 13, "Warm idle · Park"],
    [13, 19, "Drive + A/C on"],
    [19, 31, "Light cruise"],
    [31, 39, "WOT pull"],
    [39, 48, "Decel & idle in gear"],
  ];
  let maxKnock = 0, minLambdaWot = 9, maxLambdaWot = 0, cruiseTrimSum = 0, cruiseN = 0, minRpmDrive = 9999;
  let torqueGain = 0, wotN = 0;

  for (let t = 0; t <= T + 1e-9; t += dt) {
    let rpm, map, lambda = 1, phase, speed = 0, trim = 0, knock = 0, spark;
    const ph = phases.find(([a, b]) => t >= a && t < b) || phases[phases.length - 1];
    phase = ph[2];

    if (t < 3) {
      // crank tables are locked → startup is identical to the baseline cam tune
      const k = t / 3;
      rpm = t < 0.6 ? 180 + t * 300 : 1350 * Math.exp(-(t - 0.6) * 0.5) + (idle.rpmPark + 280) * (1 - Math.exp(-(t - 0.6) * 0.9));
      rpm = Math.min(rpm, 1450);
      lambda = 0.88 + 0.1 * k;
      map = 60 - 25 * k;
      spark = 14 + 4 * k;
    } else if (t < 13) {
      rpm = idleRpmAt(t, idle.rpmPark, est);
      map = est.vacuum + Math.sin(t * 6) * est.lope * 3;
      lambda = 1 - idle.enrich / 100;
      spark = idle.sparkIdle + (rpm < idle.rpmPark ? 1 : -1) * Math.min(6, Math.abs(rpm - idle.rpmPark) / 10) * (idle.stability / 100);
    } else if (t < 19) {
      const k = t - 13;
      const sag = (60 + est.stallRisk * 260) * Math.exp(-k * (1.6 - est.stallRisk)) * Math.min(1, k * 4);
      rpm = idleRpmAt(t, idle.rpmDrive, { ...est, swing: est.swing * 0.8 }) - sag;
      minRpmDrive = Math.min(minRpmDrive, rpm);
      map = est.vacuum + 9;
      lambda = 1 - idle.enrich / 100;
      spark = idle.sparkIdle + 3;
    } else if (t < 31) {
      const k = (t - 19) / 12;
      rpm = 1500 + 300 * Math.sin(k * Math.PI) ;
      speed = 25 + 30 * Math.sin(k * Math.PI * 0.8);
      map = 42 + 6 * Math.sin(k * 6);
      const air = 0.36 + 0.04 * Math.sin(k * 6);
      const veErr = sample2D(ve, MAP_AXIS, RPM_AXIS, map, rpm);
      trim = -veErr; // ECM over/under-fuels by VE error; O2 pulls it back
      cruiseTrimSum += trim; cruiseN++;
      lambda = 1 + Math.sin(t * 3) * 0.006;
      spark = sample2D(stockSp, CYLAIR_AXIS, RPM_AXIS, air, rpm) + sample2D(sp, CYLAIR_AXIS, RPM_AXIS, air, rpm);
    } else if (t < 39) {
      const k = (t - 31) / 8;
      rpm = 2400 + 3400 * Math.pow(k, 0.85);
      speed = 40 + 45 * k;
      map = 98;
      const air = 0.95 + 0.12 * Math.sin(k * Math.PI);
      const veErr = sample2D(ve, MAP_AXIS, RPM_AXIS, map, rpm);
      lambda = 0.865 / (1 + veErr / 100); // open loop: VE error shows up directly in AFR
      const dS = sample2D(sp, CYLAIR_AXIS, RPM_AXIS, air, rpm);
      spark = sample2D(stockSp, CYLAIR_AXIS, RPM_AXIS, air, rpm) + dS;
      const excess = dS - margin - (lambda < 0.84 ? 0.5 : 0) + (lambda > 0.9 ? 1 : 0) + cf * 0.2;
      knock = clamp(excess > 0 ? excess * 1.6 : 0, 0, 8);
      maxKnock = Math.max(maxKnock, knock);
      minLambdaWot = Math.min(minLambdaWot, lambda); maxLambdaWot = Math.max(maxLambdaWot, lambda);
      const effAdv = dS - knock;
      torqueGain += clamp(effAdv * 0.55, -6, 1.6) - Math.abs(lambda - 0.865) * 18;
      wotN++;
      spark -= knock;
      if (rpm > tune.revLimit) rpm = tune.revLimit - 40 * Math.random();
    } else {
      const k = (t - 39) / 9;
      rpm = k < 0.5 ? 5600 - 4300 * (k / 0.5) : idleRpmAt(t, idle.rpmDrive, { ...est, swing: est.swing * 0.8 });
      speed = Math.max(0, 85 - 85 * k * 1.3);
      map = k < 0.5 ? 20 : est.vacuum + 9;
      lambda = k < 0.5 ? 1.6 : 1 - idle.enrich / 100;
      spark = k < 0.5 ? 10 : idle.sparkIdle + 3;
      if (k >= 0.5) minRpmDrive = Math.min(minRpmDrive, rpm);
    }
    out.t.push(+t.toFixed(2)); out.rpm.push(rpm); out.lambda.push(lambda); out.spark.push(spark);
    out.knock.push(knock); out.trim.push(trim); out.phase.push(phase); out.speed.push(speed);
  }

  const cruiseTrim = cruiseN ? cruiseTrimSum / cruiseN : 0;
  const wotAfrRich = 14.7 * minLambdaWot, wotAfrLean = 14.7 * maxLambdaWot;
  const torquePct = wotN ? torqueGain / wotN : 0;

  const scores = [
    score("Startability", est.startability, est.startability >= 85 ? "Crank & cold-start tables are locked; warm restarts unaffected." : "Reduced idle airflow can make hot restarts lazy."),
    score("Idle quality", clamp(100 - Math.max(0, est.swing - 45) * 1.6, 0, 100), `Idle swing ≈ ±${est.swing.toFixed(0)} rpm · lope ${(est.lope * 100).toFixed(0)}%`),
    score("Stall margin (in gear)", clamp(100 - est.stallRisk * 100, 0, 100), `Lowest RPM after shifting into Drive with A/C: ${Math.round(minRpmDrive)} rpm`),
    score("Cruise fueling", clamp(100 - Math.abs(cruiseTrim) * 9, 0, 100), `Predicted fuel-trim correction at cruise: ${cruiseTrim >= 0 ? "+" : ""}${cruiseTrim.toFixed(1)}%`),
    score("WOT air/fuel", clamp(100 - Math.max(0, wotAfrLean - 12.9) * 120 - Math.max(0, 11.6 - wotAfrRich) * 60, 0, 100), `Predicted WOT AFR ${wotAfrRich.toFixed(1)}–${wotAfrLean.toFixed(1)} : 1 (target ≈ 12.7)`),
    score("Knock margin", clamp(100 - maxKnock * 22, 0, 100), maxKnock > 0.05 ? `Predicted up to ${maxKnock.toFixed(1)}° knock retard on ${fuel} octane` : `No knock predicted on ${fuel} octane`),
  ];
  const overall = Math.round(scores.reduce((s, x) => s + x.value, 0) / scores.length);
  const worst = scores.reduce((a, b) => (b.value < a.value ? b : a));

  return {
    series: out, phases, est, scores, overall, worst,
    summary: {
      lope: est.lope, cruiseTrim, wotAfrRich, wotAfrLean, maxKnock, minRpmDrive,
      torquePct: clamp(torquePct, -8, 3),
    },
  };
}
function score(label, value, detail) {
  const v = Math.round(value);
  return { label, value: v, detail, status: v >= 85 ? "good" : v >= 65 ? "warn" : v >= 45 ? "serious" : "crit" };
}

export const STOCK_VE = stockVE();
export const STOCK_SPARK = stockSpark();
