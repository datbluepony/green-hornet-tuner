// ==========================================================================
// Engine sound built from a real recording.
//
// The source is the owner's Wrangler idling (Gen IV 5.3, stage 3 truck cam,
// open headers) at ~803 rpm. It was sliced offline into phase-aligned engine
// cycles (2 crank turns = 8 firing pulses each) plus one phase-averaged
// "smooth" cycle. At runtime the cycles are re-sequenced as grains:
//
//   rpm            → playback rate of each cycle (pitch + firing rate)
//   lope           → scales the truck's own strong/weak cycle pattern (more)
//                    or blends in the averaged smooth cycle (less)
//   idle spark     → retard adds exhaust crack and lazier, lumpier cycles
//   stability      → cycle-to-cycle rpm wander and surge depth
//   airflow        → idle firmness; removing air adds stumbles
//   fueling        → low-end fullness
//   park / drive   → base rpm + converter load (deeper, heavier)
//   exhaust        → open (as recorded) or muffled
//
// If the recording can't load, the procedural synth is used instead.
// ==========================================================================

const BANK = new URL("../../audio/idle-bank.wav", import.meta.url);
const META = new URL("../../audio/idle-bank.json", import.meta.url);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// The recording = the "As recorded" preset (see model.js LOPE_PRESETS.recorded).
const REF_RPM = 800;
const REF_LOPE = 0.515;

let bankPromise = null;
async function loadBank(ctx) {
  if (!bankPromise) {
    bankPromise = (async () => {
      const [meta, bytes] = await Promise.all([fetch(META).then((r) => r.json()), fetch(BANK).then((r) => { if (!r.ok) throw new Error("bank"); return r.arrayBuffer(); })]);
      return { meta, bytes };
    })();
  }
  const { meta, bytes } = await bankPromise;
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  const data = buf.getChannelData(0);
  const G = meta.grainLen + meta.tail;
  const grains = [];
  for (let k = 0; k < meta.count; k++) {
    const b = ctx.createBuffer(1, G, buf.sampleRate);
    b.copyToChannel(data.subarray(k * G, (k + 1) * G), 0);
    grains.push(b);
  }
  // real grains sorted by lumpiness (index 0 is the smooth average)
  const order = meta.lump.map((l, i) => [l, i]).slice(1).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  return { meta, grains, smooth: grains[0], order, sr: buf.sampleRate };
}

/** Deterministic idle surge shape shared with the RPM trace. */
function surge(t, hz) {
  return Math.sin(2 * Math.PI * hz * t) * 0.62 + Math.sin(2 * Math.PI * hz * 2.07 * t + 1.3) * 0.25 + Math.sin(2 * Math.PI * 7.3 * t) * 0.08;
}

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.mode = "recording"; // or "synth"
    // public state
    this.rpm = 800; this.lope = 0.5; this.lopeHz = 1.1; this.swing = 30;
    this.params = { sparkIdle: 20, stability: 100, airflow: 0, enrich: 0 };
    this.gear = "park";
    this.exhaust = "open";
    this.throttle = 0;
    this.volume = 0.82;
    this._seed = 7;
    this._listeners = new Set();
    this._liveRpm = 800;
  }

  onFire(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  get liveRpm() { return this._liveRpm; }
  _rand() { this._seed = (this._seed * 16807) % 2147483647; return this._seed / 2147483647; }

  set(o) {
    if (o.params) { this.params = { ...this.params, ...o.params }; o = { ...o }; delete o.params; }
    Object.assign(this, o);
    this.synth?.set({ rpm: this.rpm, lope: this.lope, lopeHz: this.lopeHz, swing: this.swing, throttle: this.throttle, exhaust: this.exhaust });
    if (this.ctx && this.mode === "recording") this._tone(this.ctx.currentTime);
  }

  async start() {
    if (this.running) return;
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      try {
        this.bank = await loadBank(this.ctx);
        this._graph(this.ctx, this.ctx.destination);
      } catch (e) {
        this.mode = "synth";
        const { SynthEngineAudio } = await import("./audio-synth.js");
        this.synth = new SynthEngineAudio();
        this.synth.set({ rpm: this.rpm, lope: this.lope, lopeHz: this.lopeHz, swing: this.swing, exhaust: this.exhaust });
      }
    }
    if (this.mode === "synth") { await this.synth.start(); this.running = true; return; }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.running = true;
    this._next = this.ctx.currentTime + 0.06;
    this._liveRpm = this.rpm;
    this._t0 = this.ctx.currentTime;
    this._tone(this.ctx.currentTime);
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.2);
    this._timer = setInterval(() => this._pump(this.ctx, this.ctx.currentTime + 0.25), 25);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.mode === "synth") { this.synth.stop(); return; }
    clearInterval(this._timer);
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.1);
  }

  /* ------------------------------------------------------------- graph */
  _graph(ctx, dest) {
    this.bus = ctx.createGain();
    this.low = ctx.createBiquadFilter(); this.low.type = "lowshelf"; this.low.frequency.value = 110;
    this.crack = ctx.createBiquadFilter(); this.crack.type = "peaking"; this.crack.frequency.value = 2200; this.crack.Q.value = 0.5;
    this.lpf = ctx.createBiquadFilter(); this.lpf.type = "lowpass"; this.lpf.Q.value = 0.5;
    this.hpf = ctx.createBiquadFilter(); this.hpf.type = "highpass"; this.hpf.frequency.value = 24;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6; comp.knee.value = 10; comp.ratio.value = 2; comp.attack.value = 0.005; comp.release.value = 0.12;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.bus.connect(this.low); this.low.connect(this.crack); this.crack.connect(this.lpf); this.lpf.connect(this.hpf); this.hpf.connect(comp); comp.connect(this.master); this.master.connect(dest);
  }

  _tone(t) {
    const p = this.params, open = this.exhaust !== "muffled", drive = this.gear === "drive";
    const retard = clamp(18 - p.sparkIdle, -4, 10);
    const chop = Math.max(0, clamp(this.lope, 0, 1) - REF_LOPE - (drive ? 0.2 : 0));
    this.low.gain.setTargetAtTime(clamp((p.enrich - 1) * 1.3 + (drive ? 2.5 : 0) + chop * 6, -3, 9), t, 0.08);
    this.crack.gain.setTargetAtTime(open ? clamp(retard * 0.4, -2, 3) : -8, t, 0.08);
    this.lpf.frequency.setTargetAtTime(open ? 15000 - p.enrich * 600 - (drive ? 1500 : 0) + this.throttle * 6000 : 300 + this.throttle * 900, t, 0.08);
    this.bus.gain.setTargetAtTime((open ? 1 : 0.75) * (1 + p.airflow * 0.015 + (drive ? 0.1 : 0)), t, 0.08);
  }

  /* -------------------------------------------------------- scheduling */
  // Reference = the recording itself: cycles play in recorded order at their
  // recorded rpm and loudness. Settings scale the truck's own deviations
  // (E > 1 = more lope in the same rhythm, E < 1 = smoother).
  _pump(ctx, until) {
    const { meta, grains, smooth, sr } = this.bank;
    const p = this.params;
    const n = meta.count - 1; // real cycles 1..n
    const lvMean = meta.level.slice(1).reduce((a, b) => a + b, 0) / n;
    while (this._next < until) {
      const t = this._next;
      if (!this._k || this._k > n) this._k = 2; // loop 2..n keeps the strong/weak alternation intact
      const k = this._k++;
      const drive = this.gear === "drive";
      let dL = clamp(this.lope, 0, 1) - REF_LOPE - (drive ? 0.2 : 0);
      const E = dL >= 0 ? 1 + dL * 3.6 : clamp(1 + dL * 3.2, 0.15, 1);
      const idleish = clamp(1 - this.throttle * 3, 0, 1);
      const target = this.rpm + this.throttle * 2200;
      this._liveRpm += (target - this._liveRpm) * (this.throttle > (this._lastThr || 0) ? 0.5 : 0.3);
      this._lastThr = this.throttle;
      // the truck's own cycle-to-cycle rpm and loudness pattern, scaled
      const devR = (meta.cycleRpm[k] / meta.rpm - 1) * (idleish ? E : 0.3);
      const devL = meta.level[k] / lvMean;
      let rate = (this._liveRpm / REF_RPM) * (1 + devR);
      let gain = Math.pow(devL, idleish ? E : 0.5);
      // more chop than the recording: deepen the truck's own strong/weak cadence
      const chop = Math.max(0, dL) * idleish;
      if (chop > 0) {
        const strong = devL >= 1;
        rate *= 1 + (strong ? 1 : -1) * chop * 0.1;            // up to ~±80 rpm in rhythm
        if (!strong && k % 4 === 1) { gain *= 1 - chop * 1.5; rate *= 1 - chop * 0.06; } // lazy cycle every 2nd beat
      }
      // lean idle airflow: occasional soft sag (no rebound pop)
      if (p.airflow < 0 && idleish && this._rand() < -p.airflow * 0.02) { gain *= 0.88; rate *= 0.975; }
      rate = clamp(rate, 0.55, 2.8);
      const smoothMix = 0; // blending the averaged cycle caused beating; smoothing is done by scaling deviations
      const dur = (meta.grainLen + meta.tail) / sr / rate;
      const fade = meta.tail / sr / rate;
      this._play(ctx, grains[k], t, rate, gain * (1 - smoothMix), dur, fade);
      if (smoothMix > 0.01) this._play(ctx, smooth, t, rate, smoothMix, dur, fade);
      this._next = t + meta.grainLen / sr / rate;
      if (this._listeners.size) { const d = Math.max(0, (t - ctx.currentTime) * 1000); setTimeout(() => this._listeners.forEach((f) => f({ rpm: rate * REF_RPM, gain })), d); }
    }
  }

  _play(ctx, buffer, t, rate, gain, dur, fade) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + fade);
    g.gain.setValueAtTime(gain, t + dur - fade);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(g); g.connect(this.bus);
    src.start(t); src.stop(t + dur + 0.01);
  }

  /** Render offline (for testing / export). Returns an AudioBuffer. */
  async renderOffline(seconds = 6, sampleRate = 44100) {
    const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
    this.bank = await loadBank(ctx);
    const save = { bus: this.bus, low: this.low, crack: this.crack, lpf: this.lpf, hpf: this.hpf, master: this.master };
    this._graph(ctx, ctx.destination);
    this.master.gain.value = this.volume;
    this._tone(0);
    this._next = 0.0; this._t0 = 0; this._k = 2; this._liveRpm = this.rpm;
    this._pump(ctx, seconds);
    const out = await ctx.startRendering();
    Object.assign(this, save);
    return out;
  }
}
