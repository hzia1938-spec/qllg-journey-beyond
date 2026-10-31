// Sound for Journey Beyond. The narration is the grandpa voice (mp3); everything else is
// synthesised live with WebAudio, so there is no music licence to worry about.

const WORLDS = {
  breath: { chord: [65.41, 98.0, 130.81, 196.0], type: 'sine', cutoff: 700, gain: 0.05, shimmer: 659.25 },
  lift:   { chord: [130.81, 196.0, 293.66, 329.63, 493.88], type: 'triangle', cutoff: 1100, gain: 0.035, shimmer: 987.77 },
  ocean:  { chord: [87.31, 130.81, 220.0, 329.63, 392.0], type: 'triangle', cutoff: 900, gain: 0.035, waves: true },
  forest: { chord: [110.0, 164.81, 196.0, 246.94, 261.63], type: 'triangle', cutoff: 800, gain: 0.032, twinkle: [880, 1046.5, 1174.66, 1318.51, 1567.98] },
  aurora: { chord: [146.83, 220.0, 277.18, 369.99, 415.3], type: 'sine', cutoff: 1400, gain: 0.04, wind: true },
  earth:  { chord: [73.42, 110.0, 185.0, 329.63, 440.0], type: 'triangle', cutoff: 1000, gain: 0.035, shimmer: 880 },
};

export class AudioEngine {
  constructor() {
    const C = window.AudioContext || window.webkitAudioContext;
    this.ctx = new C();
    const c = this.ctx;
    this.out = c.createDynamicsCompressor();
    this.out.threshold.value = -18; this.out.knee.value = 12; this.out.ratio.value = 3;
    this.master = c.createGain(); this.master.gain.value = 0.9;
    this.master.connect(this.out).connect(c.destination);

    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(3.8, 2.4);
    const wet = c.createGain(); wet.gain.value = 0.5;
    this.reverb.connect(wet).connect(this.master);

    this.ambient = c.createGain(); this.ambient.gain.value = 0.85;
    this.ambient.connect(this.master);
    const aSend = c.createGain(); aSend.gain.value = 0.6;
    this.ambient.connect(aSend).connect(this.reverb);

    this.voice = c.createGain(); this.voice.gain.value = 1.05;
    this.voice.connect(this.master);
    const vSend = c.createGain(); vSend.gain.value = 0.07;
    this.voice.connect(vSend).connect(this.reverb);

    this.fx = c.createGain(); this.fx.gain.value = 0.7;
    this.fx.connect(this.master);
    const fSend = c.createGain(); fSend.gain.value = 0.8;
    this.fx.connect(fSend).connect(this.reverb);

    this.noise = this.noiseBuffer(4);
    this.buffers = {};
    this.lines = {};
    this.layer = null;
    this.speaking = 0;
    this.twinkleTimer = null;
  }

  impulse(seconds, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * seconds);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  noiseBuffer(seconds) {
    const c = this.ctx, n = Math.floor(c.sampleRate * seconds);
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  async load(base, version, onProgress) {
    const get = async (url, tries = 4) => {
      for (let i = 0; ; i++) {
        try {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`${r.status} ${url}`);
          return r;
        } catch (e) {
          if (i >= tries - 1) throw e;
          await new Promise((res) => setTimeout(res, 400 * (i + 1)));
        }
      }
    };
    this.lines = await (await get(`${base}/lines.json?v=${version}`)).json();
    const ids = Object.keys(this.lines);
    let done = 0, next = 0;
    // a few downloads at a time, each retried, so a weak connection never drops a line
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        const data = await (await get(`${base}/${id}.mp3?v=${version}`)).arrayBuffer();
        this.buffers[id] = await new Promise((res, rej) => this.ctx.decodeAudioData(data, res, rej));
        done++;
        onProgress && onProgress(done / ids.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  resume() { return this.ctx.resume(); }

  // ---------------------------------------------------------------- narration
  say(id, onStart) {
    const buf = this.buffers[id];
    if (!buf) return Promise.resolve();
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(this.voice);
    this.speaking++;
    this.duck(true);
    onStart && onStart(this.lines[id].text, buf.duration);
    return new Promise((resolve) => {
      src.onended = () => {
        this.speaking = Math.max(0, this.speaking - 1);
        if (!this.speaking) this.duck(false);
        resolve();
      };
      src.start();
    });
  }

  duck(on) {
    const g = this.ambient.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(on ? 0.55 : 0.85, t, on ? 0.15 : 0.8);
  }

  // ------------------------------------------------------------------ ambience
  setWorld(name) {
    const p = WORLDS[name];
    const c = this.ctx, t = c.currentTime;
    if (this.layer) {
      const old = this.layer;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + 3.0);
      setTimeout(() => old.nodes.forEach((n) => { try { n.stop(); } catch (e) {} }), 3300);
    }
    clearInterval(this.twinkleTimer);
    if (!p) { this.layer = null; return; }

    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 3.5);
    gain.connect(this.ambient);
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = p.cutoff; filt.Q.value = 0.4;
    filt.connect(gain);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.045;
    const lfoAmt = c.createGain(); lfoAmt.gain.value = p.cutoff * 0.35;
    lfo.connect(lfoAmt).connect(filt.frequency);
    const nodes = [lfo];
    lfo.start();
    p.chord.forEach((f, i) => {
      for (const cents of [-7, 7]) {
        const o = c.createOscillator();
        o.type = p.type; o.frequency.value = f; o.detune.value = cents + (i % 2 ? 3 : -3);
        const g = c.createGain(); g.gain.value = p.gain * (i === 0 ? 1.3 : 1.0);
        o.connect(g).connect(filt);
        o.start(); nodes.push(o);
      }
    });
    if (p.shimmer) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = p.shimmer;
      const g = c.createGain(); g.gain.value = 0.0;
      const trem = c.createOscillator(); trem.frequency.value = 0.18;
      const tAmt = c.createGain(); tAmt.gain.value = 0.006;
      trem.connect(tAmt).connect(g.gain);
      o.connect(g).connect(gain);
      o.start(); trem.start(); nodes.push(o, trem);
    }
    if (p.waves || p.wind) {
      const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = p.waves ? 'lowpass' : 'bandpass';
      bp.frequency.value = p.waves ? 480 : 700; bp.Q.value = p.waves ? 0.3 : 0.6;
      const g = c.createGain(); g.gain.value = p.waves ? 0.05 : 0.03;
      const sw = c.createOscillator(); sw.frequency.value = p.waves ? 0.09 : 0.05;
      const swAmt = c.createGain(); swAmt.gain.value = p.waves ? 0.04 : 0.022;
      sw.connect(swAmt).connect(g.gain);
      if (p.wind) {
        const fs = c.createOscillator(); fs.frequency.value = 0.031;
        const fsAmt = c.createGain(); fsAmt.gain.value = 350;
        fs.connect(fsAmt).connect(bp.frequency); fs.start(); nodes.push(fs);
      }
      n.connect(bp).connect(g).connect(gain);
      n.start(); sw.start(); nodes.push(n, sw);
    }
    if (p.twinkle) {
      this.twinkleTimer = setInterval(() => {
        if (this.ctx.state === 'running' && Math.random() < 0.55) this.bell(p.twinkle[Math.floor(Math.random() * p.twinkle.length)], 0.035, 1.6);
      }, 700);
    }
    this.layer = { gain, nodes, filt };
  }

  brighten(seconds = 6) {
    if (!this.layer) return;
    const f = this.layer.filt.frequency, t = this.ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.linearRampToValueAtTime(2600, t + seconds);
  }

  fadeOutAll(seconds = 3) {
    const g = this.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.0001, t + seconds);
  }

  restoreMaster() {
    const g = this.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.9, t);
  }

  // ------------------------------------------------------------------- effects
  bell(freq, level = 0.12, length = 4.0) {
    const c = this.ctx, t = c.currentTime;
    const partials = [[1, 1, 1], [2.0, 0.42, 0.7], [2.76, 0.3, 0.5], [4.07, 0.16, 0.32], [5.4, 0.09, 0.22]];
    for (const [ratio, amp, dec] of partials) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq * ratio;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level * amp, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + length * dec);
      o.connect(g).connect(this.fx);
      o.start(t); o.stop(t + length * dec + 0.05);
    }
  }

  gather(note) {
    // a soft rising whoosh into a bell
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    n.connect(bp).connect(g).connect(this.fx);
    n.start(t); n.stop(t + 1.2);
    setTimeout(() => { this.bell(note, 0.14, 5); this.bell(note * 1.5, 0.05, 4); }, 650);
  }

  chord(notes) {
    notes.forEach((f, i) => setTimeout(() => this.bell(f, 0.1, 6), i * 220));
  }

  breath(inhale, exhale) {
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.linearRampToValueAtTime(1100, t + inhale);
    bp.frequency.linearRampToValueAtTime(380, t + inhale + exhale);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + inhale);
    g.gain.linearRampToValueAtTime(0.0001, t + inhale + exhale);
    n.connect(bp).connect(g).connect(this.fx);
    n.start(t); n.stop(t + inhale + exhale + 0.1);
  }
}
