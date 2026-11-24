// ==========================================================================
// Engine sound from the real recording.
//
// Source: the owner's Wrangler idling (Gen IV 5.3, stage 3 truck cam, open
// headers), 18 s of stereo joined from two clips, level-ridden, ~803 rpm.
// Offline we marked every firing pulse (8 per engine cycle, even 90° crank
// spacing) and which cycles are the strong "boom" of the lope.
//
// "As recorded" → the raw recording, unprocessed (bit-for-bit, just volume).
// Anything else  → pitch-synchronous overlap-add (PSOLA) of the real pulses:
//   rpm          spaces the same pulses closer/further apart without changing
//                their pitch (lower idle = more room between booms)
//   more lope    the soft cycle between booms slows and drops back, so the
//                strong booms stand apart: boom … boom, never random
//   less lope    evens out the gap and loudness between cycles
//   in gear      converter load: target in-gear rpm, a bit less lope
//   fueling / spark / exhaust  gentle tone changes; neutral at the recording
// If the recording can't load, the procedural synth is used instead.
// ==========================================================================

const SRC = new URL("../../audio/idle-recorded.wav", import.meta.url);
const META = new URL("../../audio/idle-recorded.json", import.meta.url);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// The recording corresponds to LOPE_PRESETS.recorded in model.js.
export const REF = { rpm: 800, lope: 0.515, sparkIdle: 18, stability: 75, airflow: 0.5, enrich: 1 };

const HANN = (() => { const c = new Float32Array(128); for (let i = 0; i < 128; i++) c[i] = Math.sin((Math.PI * i) / 127) ** 2; return c; })();

let srcPromise = null;
function fetchSource() {
  if (!srcPromise) srcPromise = Promise.all([fetch(META).then((r) => r.json()), fetch(SRC).then((r) => { if (!r.ok) throw new Error("source"); return r.arrayBuffer(); })]);
  return srcPromise;
}

export class EngineAudio {
  constructor() {
    this.ctx = null; this.running = false; this.mode = "recording";
    this.rpm = REF.rpm; this.lope = REF.lope; this.lopeHz = 3.3; this.swing = 20;
    this.params = { sparkIdle: REF.sparkIdle, stability: REF.stability, airflow: REF.airflow, enrich: REF.enrich };
    this.gear = "park"; this.exhaust = "open"; this.throttle = 0; this.volume = 0.85;
    this._listeners = new Set(); this._liveRpm = REF.rpm; this._raw = true;
  }
  onFire(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  get liveRpm() { return this._liveRpm; }

  /** True when every setting matches the recording, so it plays untouched. */
  isReference() {
    const p = this.params;
    return Math.abs(this.rpm - REF.rpm) < 0.5 && Math.abs(this.lope - REF.lope) < 0.01 && this.gear === "park" && this.exhaust !== "muffled" && this.throttle < 0.01 &&
      Math.abs(p.sparkIdle - REF.sparkIdle) < 0.01 && Math.abs(p.stability - REF.stability) < 0.5 && Math.abs(p.airflow - REF.airflow) < 0.01 && Math.abs(p.enrich - REF.enrich) < 0.01;
  }

  set(o) {
    if (o.params) { this.params = { ...this.params, ...o.params }; o = { ...o }; delete o.params; }
    Object.assign(this, o);
    this.synth?.set({ rpm: this.rpm, lope: this.lope, lopeHz: this.lopeHz, swing: this.swing, throttle: this.throttle, exhaust: this.exhaust });
    if (this.ctx && this.running && this.mode === "recording") { this._tone(this.ctx.currentTime); this._route(this.ctx.currentTime); }
  }

  async start() {
    if (this.running) return;
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      try { await this._load(this.ctx); this._graph(this.ctx, this.ctx.destination); }
      catch (e) {
        this.mode = "synth";
        const { SynthEngineAudio } = await import("./audio-synth.js");
        this.synth = new SynthEngineAudio();
        this.synth.set({ rpm: this.rpm, lope: this.lope, lopeHz: this.lopeHz, swing: this.swing, exhaust: this.exhaust });
      }
    }
    if (this.mode === "synth") { await this.synth.start(); this.running = true; return; }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const t = this.ctx.currentTime + 0.05;
    this.running = true;
    this._liveRpm = this.rpm;
    this._pos = this._pos || 0;
    this._raw = this.isReference();
    this._startRaw(this.ctx, t, this._pos);
    this.rawGain.gain.cancelScheduledValues(t); this.psolaGain.gain.cancelScheduledValues(t);
    this.rawGain.gain.setValueAtTime(this._raw ? 1 : 0, t);
    this.psolaGain.gain.setValueAtTime(this._raw ? 0 : 1, t);
    this._j = this._epochAt(this._pos); this._T = t;
    this._tone(t);
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0, t);
    this.master.gain.linearRampToValueAtTime(this.volume, t + 0.35);
    this._timer = setInterval(() => this._pump(this.ctx, this.ctx.currentTime + 0.25), 25);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.mode === "synth") { this.synth.stop(); return; }
    clearInterval(this._timer);
    const t = this.ctx.currentTime;
    this._pos = this._raw ? this._rawPos(t) : this.meta.epochs[this._j] || 0;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.2);
    const s = this.rawSrc; setTimeout(() => { try { s?.stop(); } catch {} }, 300);
  }

  /* ------------------------------------------------------------- setup */
  async _load(ctx) {
    const [meta, bytes] = await fetchSource();
    this.meta = meta;
    this.buf = await ctx.decodeAudioData(bytes.slice(0));
    this.frames = this.buf.length;
    this.lvMean = meta.level.reduce((a, b) => a + b, 0) / meta.level.length;
  }

  _graph(ctx, dest) {
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.1;
    this.master.connect(limiter); limiter.connect(dest);
    // raw path: straight to master
    this.rawGain = ctx.createGain(); this.rawGain.connect(this.master);
    // resynthesis path: tone shaping, neutral at the recorded settings
    this.bus = ctx.createGain();
    this.low = ctx.createBiquadFilter(); this.low.type = "lowshelf"; this.low.frequency.value = 110;
    this.crack = ctx.createBiquadFilter(); this.crack.type = "peaking"; this.crack.frequency.value = 2200; this.crack.Q.value = 0.5;
    this.lpf = ctx.createBiquadFilter(); this.lpf.type = "lowpass"; this.lpf.Q.value = 0.5; this.lpf.frequency.value = 20000;
    this.psolaGain = ctx.createGain();
    this.bus.connect(this.low); this.low.connect(this.crack); this.crack.connect(this.lpf); this.lpf.connect(this.psolaGain); this.psolaGain.connect(this.master);
  }

  _startRaw(ctx, t, pos) {
    try { this.rawSrc?.stop(t); } catch {}
    const s = ctx.createBufferSource();
    s.buffer = this.buf; s.loop = true; s.loopStart = 0; s.loopEnd = this.buf.duration;
    s.connect(this.rawGain);
    s.start(t, (pos % this.frames) / this.buf.sampleRate);
    this.rawSrc = s; this._rawT0 = t; this._rawPos0 = pos;
  }
  _rawPos(t) { return (this._rawPos0 + Math.max(0, t - this._rawT0) * this.buf.sampleRate) % this.frames; }
  _epochAt(pos) { const E = this.meta.epochs; for (let i = 0; i < E.length; i++) if (E[i] >= pos) return i; return 0; }

  /** Crossfade between the raw recording and the resynthesis. */
  _route(t) {
    const ref = this.isReference();
    if (ref === this._raw) return;
    this._raw = ref;
    const ramp = (g, v) => { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + 0.12); };
    if (ref) {
      this._startRaw(this.ctx, t, this.meta.epochs[this._j] || 0); // resume where the resynthesis is in the source
      this.rawGain.gain.cancelScheduledValues(t); this.rawGain.gain.setValueAtTime(0, t);
      ramp(this.rawGain, 1); ramp(this.psolaGain, 0);
    } else {
      this._j = this._epochAt(this._rawPos(t)); this._T = t + 0.01;
      ramp(this.rawGain, 0); ramp(this.psolaGain, 1);
    }
  }

  _tone(t) {
    const p = this.params, open = this.exhaust !== "muffled", drive = this.gear === "drive";
    const more = Math.max(0, this.lope - REF.lope);
    const to = (param, v) => param.setTargetAtTime(v, t, 0.08);
    to(this.low.gain, clamp((p.enrich - REF.enrich) * 1.2 + (drive ? 1.2 : 0) + more * 3, -3, 6));
    to(this.crack.gain, open ? clamp((REF.sparkIdle - p.sparkIdle) * 0.35, -2, 2.5) : -8);
    to(this.lpf.frequency, open ? 20000 - Math.max(0, p.enrich - REF.enrich) * 900 - (drive ? 2500 : 0) : 320 + this.throttle * 900);
    to(this.bus.gain, open ? 1 : 0.8);
  }

  /* ------------------------------------------------------ resynthesis */
  _pump(ctx, until) {
    if (this._raw) { this._T = Math.max(this._T || 0, ctx.currentTime); return; }
    const { epochs: E, strong, level } = this.meta;
    const sr = this.buf.sampleRate, N = E.length, F = this.frames;
    const drive = this.gear === "drive";
    while (this._T < until) {
      const j = this._j % N;
      const e = E[j];
      const Pp = ((e - E[(j - 1 + N) % N]) % F + F) % F || 824;
      const Pn = ((E[(j + 1) % N] - e) % F + F) % F || 824;
      const idleish = clamp(1 - this.throttle * 3, 0, 1);
      const target = this.rpm + this.throttle * 2400;
      this._liveRpm += (target - this._liveRpm) * (this.throttle > (this._lastThr || 0) ? 0.08 : 0.04);
      this._lastThr = this.throttle;
      const dL = (this.lope - REF.lope - (drive ? 0.12 : 0)) * idleish;
      const more = Math.max(0, dL), less = Math.max(0, -dL);
      const isStrong = strong[j] === 1;
      // more lope: the soft cycle between booms slows and drops back
      const stretch = isStrong ? 1 - more * 0.06 : 1 + more * 0.55;
      let gain = isStrong ? 1 + more * 0.12 : 1 - more * 0.45;
      // less lope: pull cycles toward the average loudness
      gain *= Math.pow(this.lvMean / level[j], clamp(less * 2.2, 0, 1));
      const spacing = Pn * (REF.rpm / Math.max(350, this._liveRpm)) * stretch;
      const rate = this._liveRpm > 1100 ? Math.pow(this._liveRpm / 1100, 0.55) : 1;
      gain *= Math.min(1, Math.sqrt(spacing / Pn));
      const before = Pp / sr / rate, dur = (Pp + Pn) / sr / rate;
      const t0 = this._T - before;
      if (t0 + dur > ctx.currentTime) this._grain(ctx, (((e - Pp) % F) + F) % F / sr, Math.max(ctx.currentTime || 0, t0), rate, gain, dur);
      this._T += spacing / sr;
      this._j = (j + 1) % N;
      if (this._listeners.size) { const d = Math.max(0, (this._T - ctx.currentTime) * 1000); setTimeout(() => this._listeners.forEach((f) => f({ strong: isStrong, gain })), d); }
    }
  }

  _grain(ctx, offset, t, rate, gain, dur) {
    const s = ctx.createBufferSource();
    s.buffer = this.buf; s.loop = true; s.loopStart = 0; s.loopEnd = this.buf.duration;
    s.playbackRate.value = rate;
    const g = ctx.createGain();
    const curve = new Float32Array(HANN.length); for (let i = 0; i < curve.length; i++) curve[i] = HANN[i] * gain;
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(curve, t, dur);
    s.connect(g); g.connect(this.bus);
    s.start(t, offset, dur * rate + 0.005);
  }

  /** Offline render for testing. */
  async renderOffline(seconds = 8, sampleRate = 44100) {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    await this._load(ctx);
    this._graph(ctx, ctx.destination);
    this.master.gain.value = this.volume;
    this._tone(0);
    this._raw = this.isReference();
    this._liveRpm = this.rpm; this._j = 0; this._T = 0.03;
    if (this._raw) { this._startRaw(ctx, 0, 0); this.rawGain.gain.value = 1; this.psolaGain.gain.value = 0; }
    else { this.rawGain.gain.value = 0; this.psolaGain.gain.value = 1; this._pump(ctx, seconds); }
    return ctx.startRendering();
  }
}
