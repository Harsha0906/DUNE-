// Fully synthesized audio: no asset files needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicOn = true;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 3; }

    // wind bed
    this.wind = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.08;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // creature rumble
    this.rumbleSrc = this.loopNoise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110;
    this.rumbleOsc = ctx.createOscillator(); this.rumbleOsc.type = 'sine'; this.rumbleOsc.frequency.value = 34;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    this.rumbleSrc.connect(lp).connect(this.rumbleGain);
    const og = ctx.createGain(); og.gain.value = 0.6;
    this.rumbleOsc.connect(og).connect(this.rumbleGain);
    this.rumbleGain.connect(this.master);
    this.rumbleOsc.start();

    // skimmer engine
    this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 60;
    this.engOsc2 = ctx.createOscillator(); this.engOsc2.type = 'square'; this.engOsc2.frequency.value = 61.5;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engOsc.connect(this.engFilter); this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.engOsc.start(); this.engOsc2.start();

    // music pad
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = this.musicOn ? 0.05 : 0;
    const padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 900;
    padFilter.connect(this.musicGain).connect(this.master);
    this.padOscs = [];
    [55, 82.41, 110.5, 164.8].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.25;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.03;
      const lg = ctx.createGain(); lg.gain.value = 0.18; lfo.connect(lg).connect(g.gain); lfo.start();
      o.connect(g).connect(padFilter); o.start();
      this.padOscs.push(o);
    });
    this.nextNote = ctx.currentTime + 3;
  }

  loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true; s.start(0, Math.random() * 1.5);
    return s;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusic(on) { this.musicOn = on; if (this.musicGain) this.musicGain.gain.value = on ? 0.05 : 0; }

  /** Continuous parameters, called every frame. */
  update({ storm = 0, speed = 0, rumble = 0, engine = 0, engineSpeed = 0, danger = 0, paused = false }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = 0.08;
    const mute = paused ? 0.25 : 1;
    this.windGain.gain.setTargetAtTime((0.06 + storm * 0.5 + Math.min(speed, 40) * 0.003) * mute, t, k);
    this.windFilter.frequency.setTargetAtTime(380 + storm * 700 + Math.sin(t * 0.7) * 120, t, 0.2);
    this.rumbleGain.gain.setTargetAtTime(rumble * 0.9 * mute, t, k);
    this.engGain.gain.setTargetAtTime(engine * 0.06 * mute, t, k);
    this.engOsc.frequency.setTargetAtTime(48 + engineSpeed * 2.2, t, k);
    this.engOsc2.frequency.setTargetAtTime(49.3 + engineSpeed * 2.2, t, k);
    this.engFilter.frequency.setTargetAtTime(300 + engineSpeed * 25, t, k);

    if (this.musicOn && !paused && t > this.nextNote) {
      // sparse plucked notes from a hijaz-flavoured scale, more urgent in danger
      const scale = [220, 233.1, 277.2, 293.7, 329.6, 349.2, 415.3, 440];
      const f = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 0.5 : 1);
      this.pluck(f, 0.05 + danger * 0.03);
      this.nextNote = t + (danger > 0.3 ? 0.35 + Math.random() * 0.5 : 1.6 + Math.random() * 3.5);
    }
  }

  env(gainNode, t, a, peak, dcy) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + a);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }

  pluck(freq, vol = 0.06) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    this.env(g, t, 0.01, vol, 2.2);
    o.connect(g); o2.connect(g); g.connect(this.musicGain ? this.master : this.master);
    o.start(t); o2.start(t); o.stop(t + 2.4); o2.stop(t + 2.4);
  }

  noiseBurst({ freq = 800, q = 1, type = 'bandpass', vol = 0.2, dur = 0.15, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, vol, dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + attack + dur + 0.05);
  }

  tone(freq, { type = 'sine', vol = 0.15, dur = 0.3, at = 0, slide = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.01, vol, dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  footstep(soft = false, rock = false) { this.noiseBurst({ freq: rock ? 2600 : soft ? 900 : 1300, q: rock ? 2 : 0.8, vol: soft ? 0.04 : 0.09, dur: rock ? 0.05 : 0.09 }); }
  jump() { this.noiseBurst({ freq: 700, vol: 0.12, dur: 0.18 }); }
  pickup() { [880, 1174.7, 1568].forEach((f, i) => this.tone(f, { type: 'triangle', vol: 0.09, dur: 0.5, at: i * 0.07 })); }
  drink() { for (let i = 0; i < 5; i++) this.tone(300 + Math.random() * 300, { vol: 0.06, dur: 0.12, at: i * 0.09, slide: 200 }); }
  harvest() { this.noiseBurst({ freq: 2400, q: 4, vol: 0.05, dur: 0.12 }); }
  stake() { this.tone(70, { type: 'square', vol: 0.2, dur: 0.25, slide: -30 }); this.noiseBurst({ freq: 200, vol: 0.2, dur: 0.2, type: 'lowpass' }); }
  alert() { this.tone(110, { type: 'sawtooth', vol: 0.1, dur: 0.9, slide: -40 }); this.tone(116, { type: 'sawtooth', vol: 0.08, dur: 0.9, slide: -40 }); }
  breach() {
    this.noiseBurst({ freq: 180, type: 'lowpass', vol: 0.9, dur: 2.2, attack: 0.05 });
    this.noiseBurst({ freq: 1200, vol: 0.4, dur: 1.4, attack: 0.02 });
    this.tone(45, { type: 'sine', vol: 0.6, dur: 2, slide: -20 });
  }
  roar() { this.tone(90, { type: 'sawtooth', vol: 0.25, dur: 1.6, slide: -50 }); this.tone(133, { type: 'sawtooth', vol: 0.12, dur: 1.4, slide: -70 }); }
  ui() { this.tone(660, { type: 'triangle', vol: 0.06, dur: 0.12 }); }
  win() { [440, 554.4, 659.3, 880, 1108.7].forEach((f, i) => this.tone(f, { type: 'triangle', vol: 0.1, dur: 1.2, at: i * 0.15 })); }
  lose() { [220, 207.7, 196, 164.8].forEach((f, i) => this.tone(f, { type: 'sawtooth', vol: 0.06, dur: 0.9, at: i * 0.25 })); }
  hurt() { this.noiseBurst({ freq: 400, vol: 0.12, dur: 0.15 }); }
  mount() { this.tone(200, { type: 'square', vol: 0.05, dur: 0.4, slide: 300 }); }
}
