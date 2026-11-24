// ==========================================================================
// Procedural V8 idle synthesizer (Web Audio).
// Cross-plane V8 → 4 firing events per crank revolution. "Lope" comes from
// cylinder-to-cylinder combustion variation caused by valve overlap: weak
// events followed by strong ones, plus a slow RPM surge. This is an audio
// *approximation* for comparing settings, not a recording of a real engine.
// ==========================================================================

export class SynthEngineAudio {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.rpm = 800;       // target / base rpm
    this.lope = 0.4;      // 0..1
    this.lopeHz = 1.1;
    this.swing = 30;
    this.throttle = 0;    // 0..1 (for revs)
    this.volume = 0.8;
    this.exhaust = "open"; // "open" headers (default) | "muffled"
    this._liveRpm = 800;
    this._cyl = 0;
    this._next = 0;
    this._listeners = new Set();
    this._seed = 1;
  }

  onFire(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  get liveRpm() { return this._liveRpm; }

  _rand() { // deterministic-ish LCG so the pattern has a recognisable rhythm
    this._seed = (this._seed * 1664525 + 1013904223) % 4294967296;
    return this._seed / 4294967296;
  }

  async start() {
    if (this.running) return;
    if (!this.ctx) this._build();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.running = true;
    this._next = this.ctx.currentTime + 0.05;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.25);
    this._timer = setInterval(() => this._schedule(), 20);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this._timer);
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.12);
  }

  set(params) { Object.assign(this, params); }

  _build() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.15;

    // exhaust tone shaping
    this.lp = ctx.createBiquadFilter(); this.lp.type = "lowpass"; this.lp.frequency.value = 520; this.lp.Q.value = 0.8;
    const body = ctx.createBiquadFilter(); body.type = "peaking"; body.frequency.value = 95; body.gain.value = 9; body.Q.value = 1.1;
    this.body = body;
    // open-header rasp: primary-tube resonance + bright crack
    this.rasp = ctx.createBiquadFilter(); this.rasp.type = "peaking"; this.rasp.frequency.value = 1350; this.rasp.Q.value = 0.9; this.rasp.gain.value = 7;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 28;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.2) * 0.9; }
    shaper.curve = curve; shaper.oversample = "2x";

    this.bus = ctx.createGain(); this.bus.gain.value = 0.9;
    this.bus.connect(shaper); shaper.connect(body); body.connect(this.rasp); this.rasp.connect(this.lp); this.lp.connect(hp); hp.connect(comp); comp.connect(this.master);
    this.master.connect(ctx.destination);

    // stereo banks
    this.panL = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    this.panR = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (this.panL.pan) { this.panL.pan.value = -0.35; this.panR.pan.value = 0.35; }
    this.panL.connect(this.bus); this.panR.connect(this.bus);

    // pre-rendered combustion pulse: low thump + filtered noise
    const len = Math.floor(ctx.sampleRate * 0.09);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let ph = 0, lpState = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const f = 46 + 110 * Math.exp(-t * 55);
      ph += (2 * Math.PI * f) / ctx.sampleRate;
      const thump = Math.sin(ph) * Math.exp(-t * 34);
      lpState += (Math.random() * 2 - 1 - lpState) * 0.18;
      const crack = lpState * Math.exp(-t * 70) * 1.6;
      const snap = (Math.random() * 2 - 1) * Math.exp(-t * 260) * 1.1; // header "bark" transient
      const ring = Math.sin(2 * Math.PI * 285 * t) * Math.exp(-t * 90) * 0.35; // primary-tube ring
      d[i] = (thump * 0.85 + crack + snap + ring) * (i < 6 ? i / 6 : 1);
    }
    this.pulse = buf;

    // continuous rumble bed
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let s = 0;
    for (let i = 0; i < nd.length; i++) { s += (Math.random() * 2 - 1 - s) * 0.04; nd[i] = s * 3; }
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0.12;
    ns.connect(this.rumble); this.rumble.connect(this.bus); ns.start();
  }

  _schedule() {
    const ctx = this.ctx;
    const ahead = ctx.currentTime + 0.12;
    while (this._next < ahead) {
      const t = this._next;
      // live rpm: idle surge + throttle
      const surge = Math.sin(2 * Math.PI * this.lopeHz * t) * 0.65 + Math.sin(2 * Math.PI * this.lopeHz * 2.07 * t + 1.3) * 0.25;
      const target = this.rpm + this.throttle * 4200;
      this._liveRpm += (target - this._liveRpm) * (this.throttle > this._lastThrottle ? 0.06 : 0.025);
      this._lastThrottle = this.throttle;
      const idleish = 1 - Math.min(1, this.throttle * 3 + Math.max(0, this._liveRpm - this.rpm - 150) / 900);
      const rpm = Math.max(350, this._liveRpm + surge * this.swing * idleish);

      // combustion strength per event
      const L = this.lope * idleish;
      let amp = 1;
      const phase = (Math.sin(2 * Math.PI * this.lopeHz * t) + 1) / 2; // 0..1 through the lope cycle
      if (L > 0.02) {
        const weak = this._rand() < L * 0.35 * (0.5 + phase);
        amp = weak ? 0.35 + 0.3 * (1 - L) : 1 + L * 0.45 * (1 - phase) * this._rand();
        if (this._lastWeak && !weak) amp += L * 0.5; // the "pop" after a lazy event
        this._lastWeak = weak;
      }
      amp *= 0.55 + this.throttle * 0.5;
      const src = ctx.createBufferSource();
      src.buffer = this.pulse;
      src.playbackRate.value = 0.92 + (rpm - 600) / 9000 + (this._rand() - 0.5) * 0.05 * (1 + L);
      const g = ctx.createGain();
      g.gain.value = amp;
      src.connect(g);
      g.connect(this._cyl % 2 ? this.panR : this.panL);
      src.start(t);

      // tone opens with rpm/throttle
      const open = this.exhaust !== "muffled";
      this.lp.frequency.setTargetAtTime(open ? 1700 + rpm * 0.55 + this.throttle * 2600 : 380 + rpm * 0.18 + this.throttle * 1200, t, 0.05);
      this.rasp.gain.setTargetAtTime(open ? 7 + this.throttle * 3 : -6, t, 0.1);
      this.body.gain.setTargetAtTime(open ? 6 : 10, t, 0.1);
      this.rumble.gain.setTargetAtTime(0.1 + L * 0.06 + this.throttle * 0.08, t, 0.1);

      // cross-plane: slightly uneven spacing per bank
      const base = 60 / (rpm * 4);
      const uneven = (this._cyl % 4 === 1 || this._cyl % 4 === 2 ? 1.06 : 0.94);
      this._next += base * uneven * (1 + (this._rand() - 0.5) * 0.06 * L);
      const cyl = this._cyl;
      this._cyl = (this._cyl + 1) % 8;
      const delay = Math.max(0, (t - ctx.currentTime) * 1000);
      if (this._listeners.size) setTimeout(() => this._listeners.forEach((fn) => fn({ amp, rpm, cyl })), delay);
    }
  }
}
