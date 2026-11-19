// Audio engine: two licensed music tracks (menu + exploration) with an original
// reactive score layered on top (throat-drone, frame drums, eruption stinger),
// positional creature/engine/stake sounds, and synthesized effects.

const TRACKS = {
  menu: './music/dune-legacy-luminewave.mp3',
  explore: './music/dune-audioknap.mp3',
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicOn = true;
    this.scene = 'menu';
  }

  init() {
    if (this.ctx) { this.ctx.resume(); this.setScene(this.scene, true); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // gentle glue compressor so stingers and drums don't clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicOn ? 1 : 0; this.musicBus.connect(this.master);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 3; }

    // ---- music tracks (streamed media elements) ----
    this.tracks = {};
    for (const [key, src] of Object.entries(TRACKS)) {
      const el = new window.Audio();
      el.src = src; el.loop = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
      const node = ctx.createMediaElementSource(el);
      const g = ctx.createGain(); g.gain.value = 0;
      node.connect(g).connect(this.musicBus);
      this.tracks[key] = { el, gain: g, playing: false };
    }

    // ---- wind bed ----
    this.wind = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.08;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.sfx);
    // high whistle that only shows up in storms
    this.gust = this.loopNoise();
    this.gustFilter = ctx.createBiquadFilter(); this.gustFilter.type = 'bandpass'; this.gustFilter.frequency.value = 1800; this.gustFilter.Q.value = 6;
    this.gustGain = ctx.createGain(); this.gustGain.gain.value = 0;
    this.gust.connect(this.gustFilter).connect(this.gustGain).connect(this.sfx);

    // ---- positional sources ----
    this.listenerOk = !!ctx.listener;
    const mkPanner = () => {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 25; p.rolloffFactor = 0.35; p.maxDistance = 2000;
      p.connect(this.sfx);
      return p;
    };
    // creature rumble
    this.rumblePan = mkPanner();
    this.rumbleSrc = this.loopNoise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110;
    this.rumbleOsc = ctx.createOscillator(); this.rumbleOsc.type = 'sine'; this.rumbleOsc.frequency.value = 34;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    this.rumbleSrc.connect(lp).connect(this.rumbleGain);
    const og = ctx.createGain(); og.gain.value = 0.6;
    this.rumbleOsc.connect(og).connect(this.rumbleGain);
    // grinding sand hiss so you can locate it by ear
    const hiss = this.loopNoise();
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 700; hf.Q.value = 0.8;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0;
    hiss.connect(hf).connect(this.hissGain).connect(this.rumblePan);
    this.rumbleGain.connect(this.rumblePan);
    this.rumbleOsc.start();

    // skimmer engine
    this.engPan = mkPanner();
    this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 60;
    this.engOsc2 = ctx.createOscillator(); this.engOsc2.type = 'square'; this.engOsc2.frequency.value = 61.5;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engOsc.connect(this.engFilter); this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.engPan);
    this.engOsc.start(); this.engOsc2.start();
    this.mkPanner = mkPanner;

    // ---- reactive score ----
    this.scoreBus = ctx.createGain(); this.scoreBus.gain.value = 1; this.scoreBus.connect(this.musicBus);
    // throat-singing drone: buzzy low fundamentals through moving vowel formants
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
    this.droneGain.connect(this.scoreBus);
    this.formants = [];
    const voice = ctx.createGain(); voice.gain.value = 0.5;
    [55, 55.4, 82.4].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(voice); o.start();
    });
    [[400, 9], [800, 11], [2600, 14]].forEach(([f, q], i) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = i === 2 ? 0.35 : 1;
      voice.connect(bp).connect(g).connect(this.droneGain);
      this.formants.push(bp);
    });
    this.droneGain.gain.value = 0;
    this.drumLevel = 0;
    this.nextBeat = 0;
    this.beat = 0;
    this.danger = 0;
  }

  loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true; s.start(0, Math.random() * 1.5);
    return s;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.2);
    this.setScene(this.scene, true);
  }

  /** Crossfade between 'menu', 'explore' and 'off'. */
  setScene(scene, force = false) {
    if (!this.ctx || (scene === this.scene && !force)) { this.scene = scene; return; }
    this.scene = scene;
    const t = this.ctx.currentTime;
    for (const [key, tr] of Object.entries(this.tracks)) {
      const on = key === scene && this.musicOn;
      tr.gain.gain.cancelScheduledValues(t);
      tr.gain.gain.setTargetAtTime(on ? (key === 'menu' ? 0.55 : 0.4) : 0, t, on ? 1.2 : 0.8);
      if (on && !tr.playing) { tr.el.play().then(() => { tr.playing = true; }).catch(() => {}); }
      if (!on && tr.playing) {
        clearTimeout(tr.stopTimer);
        tr.stopTimer = setTimeout(() => { if (this.scene !== key) { tr.el.pause(); tr.playing = false; } }, 4000);
      }
    }
  }

  setPanner(p, x, y, z) {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  }

  /** Place the listener at the camera. */
  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** Continuous parameters, called every frame. */
  update({ storm = 0, speed = 0, rumble = 0, engine = 0, engineSpeed = 0, danger = 0, paused = false, creaturePos, skimmerPos, mounted = false, breach = false }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = 0.08;
    const mute = paused ? 0.25 : 1;
    this.windGain.gain.setTargetAtTime((0.06 + storm * 0.45 + Math.min(speed, 40) * 0.003) * mute, t, k);
    this.windFilter.frequency.setTargetAtTime(380 + storm * 700 + Math.sin(t * 0.7) * 120, t, 0.2);
    this.gustGain.gain.setTargetAtTime(storm * (0.02 + 0.02 * Math.sin(t * 1.3)) * mute, t, 0.3);
    this.gustFilter.frequency.setTargetAtTime(1500 + Math.sin(t * 0.4) * 500, t, 0.3);

    if (creaturePos) this.setPanner(this.rumblePan, creaturePos.x, creaturePos.y, creaturePos.z);
    this.rumbleGain.gain.setTargetAtTime(rumble * 1.1 * mute, t, k);
    this.hissGain.gain.setTargetAtTime(rumble * 0.25 * mute, t, k);

    if (skimmerPos) this.setPanner(this.engPan, skimmerPos.x, skimmerPos.y, skimmerPos.z);
    this.engGain.gain.setTargetAtTime(engine * 0.07 * mute, t, k);
    this.engOsc.frequency.setTargetAtTime(48 + engineSpeed * 2.2, t, k);
    this.engOsc2.frequency.setTargetAtTime(49.3 + engineSpeed * 2.2, t, k);
    this.engFilter.frequency.setTargetAtTime(300 + engineSpeed * 25, t, k);

    // ---- reactive score ----
    this.danger += (danger - this.danger) * 0.05;
    const dz = this.danger;
    const music = this.musicOn && !paused ? 1 : 0;
    // the exploration track ducks under the danger layers
    const ex = this.tracks.explore;
    if (this.scene === 'explore' && this.musicOn) ex.gain.gain.setTargetAtTime((0.4 - Math.min(0.32, dz * 0.4)) * (paused ? 0.4 : 1), t, 0.5);
    this.droneGain.gain.setTargetAtTime(music * Math.max(0, dz - 0.15) * 0.22, t, 0.6);
    // vowel slides from "oo" to "ah" as the danger rises
    this.formants[0].frequency.setTargetAtTime(350 + dz * 350 + Math.sin(t * 0.5) * 60, t, 0.4);
    this.formants[1].frequency.setTargetAtTime(700 + dz * 500 + Math.sin(t * 0.37) * 120, t, 0.4);
    this.drumLevel = music * (dz > 0.2 ? Math.min(1, (dz - 0.2) * 1.6) : 0);

    // frame-drum pattern with a short lookahead
    if (this.drumLevel > 0.01) {
      const bpm = 84 + dz * 50;
      const step = 60 / bpm / 2;
      if (this.nextBeat < t) this.nextBeat = t + 0.05;
      while (this.nextBeat < t + 0.15) {
        const pat = [1, 0, 0.4, 0, 0.8, 0.3, 0.5, 0, 1, 0, 0.4, 0.3, 0.8, 0, 0.6, 0.5];
        const v = pat[this.beat % 16];
        if (v > 0) this.drum(this.nextBeat, v * this.drumLevel, this.beat % 4 === 0);
        this.beat++;
        this.nextBeat += step;
      }
    }
  }

  drum(at, vol, low) {
    const ctx = this.ctx;
    // body: pitched thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(low ? 95 : 160, at); o.frequency.exponentialRampToValueAtTime(low ? 45 : 90, at + 0.25);
    const g = ctx.createGain(); this.envAt(g, at, 0.005, 0.5 * vol, low ? 0.45 : 0.22);
    o.connect(g).connect(this.scoreBus);
    o.start(at); o.stop(at + 0.6);
    // skin: noise slap
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = low ? 600 : 1400; f.Q.value = 1.2;
    const g2 = ctx.createGain(); this.envAt(g2, at, 0.002, 0.18 * vol, 0.08);
    s.connect(f).connect(g2).connect(this.scoreBus);
    s.start(at, Math.random()); s.stop(at + 0.2);
  }

  envAt(gainNode, t, a, peak, dcy) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }
  env(gainNode, t, a, peak, dcy) { this.envAt(gainNode, t, a, peak, dcy); }

  /** Rising choir-and-brass swell for an eruption: an original motif in D phrygian dominant. */
  stinger(power = 1) {
    if (!this.ctx || !this.musicOn) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = [146.8, 155.6, 185, 220, 293.7]; // D Eb F# A D
    notes.forEach((f, i) => {
      const at = t + i * 0.16;
      [1, 1.004, 0.996].forEach((det) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * det;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700 + i * 120; bp.Q.value = 2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.05 * power, at + 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
        o.connect(bp).connect(g).connect(this.scoreBus);
        o.start(at); o.stop(at + 2.7);
      });
    });
    this.drum(t, 1, true); this.drum(t + 0.64, 0.9, true);
  }

  /** A soft bell when a chapter starts or a tablet is read. */
  chapter() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [[293.7, 0], [440, 0.12], [587.3, 0.24]].forEach(([f, at]) => {
      [1, 2.76, 5.4].forEach((m, i) => {
        const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
        const g = this.ctx.createGain(); this.envAt(g, t + at, 0.005, 0.06 / (i + 1), 2.5 / (i + 1));
        o.connect(g).connect(this.musicBus); o.start(t + at); o.stop(t + at + 2.6);
      });
    });
  }

  /** A positional thump (thrum stakes). */
  thumpAt(x, y, z) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = this.mkPanner(); this.setPanner(p, x, y, z);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const g = ctx.createGain(); this.envAt(g, t, 0.003, 0.35, 0.25);
    o.connect(g).connect(p); o.start(t); o.stop(t + 0.3);
    setTimeout(() => p.disconnect(), 600);
  }

  noiseBurst({ freq = 800, q = 1, type = 'bandpass', vol = 0.2, dur = 0.15, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    this.envAt(g, t, attack, vol, dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random()); s.stop(t + attack + dur + 0.05);
  }

  tone(freq, { type = 'sine', vol = 0.15, dur = 0.3, at = 0, slide = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    this.envAt(g, t, 0.01, vol, dur);
    o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  footstep(soft = false, rock = false) { this.noiseBurst({ freq: (rock ? 2600 : soft ? 900 : 1300) * (0.9 + Math.random() * 0.2), q: rock ? 2 : 0.8, vol: soft ? 0.04 : 0.09, dur: rock ? 0.05 : 0.09 }); }
  jump() { this.noiseBurst({ freq: 700, vol: 0.12, dur: 0.18 }); }
  pickup() { [880, 1174.7, 1568].forEach((f, i) => this.tone(f, { type: 'triangle', vol: 0.09, dur: 0.5, at: i * 0.07 })); }
  drink() { for (let i = 0; i < 5; i++) this.tone(300 + Math.random() * 300, { vol: 0.06, dur: 0.12, at: i * 0.09, slide: 200 }); }
  harvest() { this.noiseBurst({ freq: 2400, q: 4, vol: 0.05, dur: 0.12 }); }
  stake() { this.tone(70, { type: 'square', vol: 0.2, dur: 0.25, slide: -30 }); this.noiseBurst({ freq: 200, vol: 0.2, dur: 0.2, type: 'lowpass' }); }
  alert() { this.tone(110, { type: 'sawtooth', vol: 0.1, dur: 0.9, slide: -40 }); this.tone(116, { type: 'sawtooth', vol: 0.08, dur: 0.9, slide: -40 }); }
  breach(power = 1) {
    this.noiseBurst({ freq: 180, type: 'lowpass', vol: 0.9 * power, dur: 2.2, attack: 0.05 });
    this.noiseBurst({ freq: 1200, vol: 0.4 * power, dur: 1.4, attack: 0.02 });
    this.tone(45, { type: 'sine', vol: 0.6 * power, dur: 2, slide: -20 });
    if (power > 0.5) this.stinger(power);
  }
  roar() { this.tone(90, { type: 'sawtooth', vol: 0.25, dur: 1.6, slide: -50 }); this.tone(133, { type: 'sawtooth', vol: 0.12, dur: 1.4, slide: -70 }); }
  ui() { this.tone(660, { type: 'triangle', vol: 0.06, dur: 0.12 }); }
  win() { [440, 554.4, 659.3, 880, 1108.7].forEach((f, i) => this.tone(f, { type: 'triangle', vol: 0.1, dur: 1.2, at: i * 0.15 })); }
  lose() { [220, 207.7, 196, 164.8].forEach((f, i) => this.tone(f, { type: 'sawtooth', vol: 0.06, dur: 0.9, at: i * 0.25 })); }
  hurt() { this.noiseBurst({ freq: 400, vol: 0.12, dur: 0.15 }); }
  mount() { this.tone(200, { type: 'square', vol: 0.05, dur: 0.4, slide: 300 }); }
}
