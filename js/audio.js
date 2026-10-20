/*
 * Audio-Graph: Motor-DSP (AudioWorklet, sonst ScriptProcessor) -> Lautstärke -> Lautsprecher
 *
 * Klangregelung, Hall und Limiter laufen im DSP selbst – bewusst ohne
 * DynamicsCompressorNode, denn der hat eingebauten Vorlauf (zusätzliche Latenz).
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
      this.unlockIOS();
      if (!this.ctx) {
        try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { this.ctx = new AC(); }
        this.ctx.onstatechange = () => { if (this.onstate) this.onstate(this.ctx.state); };
        this.ready = this.build();
      }
      const r = this.ctx.resume();
      return Promise.all([this.ready, r]);
    }

    suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

    // Nach Unterbrechung (iOS: Anruf, Benachrichtigung, Sperrbildschirm) wieder anwerfen.
    // Muss aus einer Nutzergeste heraus aufgerufen werden.
    resumeIfNeeded() {
      if (!this.ctx || this.ctx.state === 'running') return;
      this.unlockIOS();
      this.ctx.resume().catch(() => {});
    }

    get running() { return !!this.ctx && this.ctx.state === 'running'; }

    // iPhone/iPad: Web Audio läuft sonst in der „Umgebungs“-Kategorie und wird vom
    // Stummschalter stummgeschaltet. iOS 17+: Audio-Session auf „playback“ stellen,
    // ältere Versionen: stilles <audio> in Schleife schaltet die Session ebenfalls um.
    unlockIOS() {
      if (!isIOS()) return;
      try {
        if (navigator.audioSession) { navigator.audioSession.type = 'playback'; return; }
      } catch (e) { /* weiter mit Fallback */ }
      if (!this.silentEl) {
        const el = document.createElement('audio');
        el.setAttribute('playsinline', '');
        el.setAttribute('webkit-playsinline', '');
        el.loop = true;
        el.src = silentWavUrl();
        this.silentEl = el;
      }
      const p = this.silentEl.play();
      if (p && p.catch) p.catch(() => {});
    }

    // Gesamtverzögerung der Audio-Ausgabe in ms (soweit der Browser sie meldet)
    latencyMs() {
      if (!this.ctx) return null;
      const b = this.ctx.baseLatency || 0, o = this.ctx.outputLatency || 0;
      return Math.round((b + o) * 1000);
    }

    async build() {
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(ctx.destination);

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
        // kleinster Puffer, den alle Browser akzeptieren, für geringe Latenz
        src = ctx.createScriptProcessor(512, 1, 2);
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
      src.connect(this.master);
      this.src = src;
      if (this.pending) for (const m of this.pending) this.post(m);
      this.pending = null;
      if (this.volume != null) this.setVolume(this.volume);
    }

    post(msg) {
      if (this.node) this.node.port.postMessage(msg);
      else if (this.dsp) {
        if (msg.type === 'state') this.dsp.setState(msg);
        else if (msg.type === 'profile') this.dsp.setProfile(msg.profile);
        else if (msg.type === 'settings') this.dsp.setSettings(msg.settings);
      } else if (msg.type !== 'state') {
        (this.pending || (this.pending = [])).push(msg);
      }
    }

    setProfile(p) { this.post({ type: 'profile', profile: p }); }
    setSettings(s) { this.post({ type: 'settings', settings: s }); }
    state(o) {
      if (!this.node && !this.dsp) return;
      this.post({ type: 'state', rpm: o.rpm, thr: o.thr, cut: o.cut, overrun: o.overrun, starter: o.starter });
    }

    setVolume(v) { // 0..100, wahrnehmungsgerecht; Limiter im DSP hält die Spitzen unter 0 dB
      this.volume = v;
      if (!this.master) return;
      this.master.gain.setTargetAtTime(Math.pow(v / 100, 1.6), this.ctx.currentTime, 0.03);
    }
  }

  function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  // 0,5 s Stille als WAV (8 kHz, 16 Bit, mono)
  function silentWavUrl() {
    const n = 4000, b = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
    b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
    b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true);
    str(36, 'data'); b.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }));
  }

  G.AudioEngine = AudioEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
