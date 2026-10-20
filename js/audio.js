/*
 * Audio-Graph: Motor-DSP (AudioWorklet, sonst ScriptProcessor)
 *   -> Bass-Shelf -> Präsenz -> Kompressor -> Lautstärke -> Lautsprecher
 */
(function (G) {
  'use strict';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.node = null;
      this.dsp = null; // nur im Fallback
      this.ready = null;
      this.mode = '';
    }

    // Muss direkt im Klick-Handler aufgerufen werden (Autoplay-Regeln).
    start() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return Promise.reject(new Error('Web Audio wird nicht unterstützt'));
      if (!this.ctx) {
        try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { this.ctx = new AC(); }
        this.ready = this.build();
      }
      const r = this.ctx.resume();
      return Promise.all([this.ready, r]);
    }

    suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

    async build() {
      const ctx = this.ctx;
      this.bass = ctx.createBiquadFilter();
      this.bass.type = 'lowshelf'; this.bass.frequency.value = 110; this.bass.gain.value = 4;
      this.presence = ctx.createBiquadFilter();
      this.presence.type = 'peaking'; this.presence.frequency.value = 2600; this.presence.Q.value = 0.8; this.presence.gain.value = 1.5;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.knee.value = 10; this.comp.ratio.value = 3.5;
      this.comp.attack.value = 0.004; this.comp.release.value = 0.18;
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.bass.connect(this.presence).connect(this.comp).connect(this.master).connect(ctx.destination);

      let src = null;
      if (ctx.audioWorklet && typeof AudioWorkletNode === 'function') {
        try {
          await ctx.audioWorklet.addModule('js/engine-dsp.js');
          src = new AudioWorkletNode(ctx, 'engine-processor', {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
          });
          this.node = src;
          this.mode = 'AudioWorklet';
        } catch (e) {
          console.warn('AudioWorklet nicht verfügbar, nutze Fallback', e);
          src = null;
        }
      }
      if (!src) {
        this.dsp = new G.EngineDSP(ctx.sampleRate);
        src = ctx.createScriptProcessor(1024, 1, 2);
        src.onaudioprocess = (e) => {
          const ob = e.outputBuffer;
          this.dsp.process(ob.getChannelData(0), ob.getChannelData(1), ob.length);
        };
        // ScriptProcessor braucht einen Eingang, um zuverlässig zu laufen
        const silent = ctx.createConstantSource ? ctx.createConstantSource() : ctx.createOscillator();
        const zero = ctx.createGain(); zero.gain.value = 0;
        silent.connect(zero).connect(src);
        silent.start();
        this.mode = 'ScriptProcessor';
      }
      src.connect(this.bass);
      this.src = src;
      if (this.pending) for (const m of this.pending) this.post(m);
      this.pending = null;
    }

    post(msg) {
      if (this.node) this.node.port.postMessage(msg);
      else if (this.dsp) {
        if (msg.type === 'state') this.dsp.setState(msg);
        else if (msg.type === 'profile') this.dsp.setProfile(msg.profile);
        else if (msg.type === 'settings') this.dsp.setSettings(msg.settings);
      } else {
        (this.pending || (this.pending = [])).push(msg);
      }
    }

    setProfile(p) { this.post({ type: 'profile', profile: p }); }
    setSettings(s) { this.post({ type: 'settings', settings: s }); }
    state(o) {
      if (!this.node && !this.dsp) return;
      this.post({ type: 'state', rpm: o.rpm, thr: o.thr, cut: o.cut, overrun: o.overrun, starter: o.starter });
    }

    setVolume(v) { // 0..100, wahrnehmungsgerecht
      if (!this.master) return;
      const g = Math.pow(v / 100, 2) * 1.4;
      this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
    }
    setBass(db) { if (this.bass) this.bass.gain.setTargetAtTime(db, this.ctx.currentTime, 0.05); }
  }

  G.AudioEngine = AudioEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
