/*
 * SoundDrive – Motor-Synthese
 *
 * Physikalisch inspiriertes Modell statt Samples:
 *   Zylinder-Zündimpulse (echte Zündfolge + Zündabstände)
 *   -> je Zylinder ein Krümmerrohr (Wellenleiter mit Reflexion)
 *   -> Sammler je Zylinderbank -> X-/H-Rohr -> Endrohre (Stereo)
 *   -> Schalldämpfer (Resonanzen, Klappe öffnet mit Last/Drehzahl)
 * plus Ansauggeräusch, Mechanik, Turbo (Pfeifen, Blow-Off, Flattern),
 * Kompressor-Heulen, Schubknallen/Nachverbrennung und Anlasser.
 *
 * Die Datei läuft sowohl als AudioWorklet als auch im Hauptthread
 * (ScriptProcessor-Fallback für ältere Browser).
 */
(function (G) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;

  function pow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

  // Ringpuffer mit fraktionaler (linear interpolierter) Verzögerung
  class Delay {
    constructor(n) {
      this.size = pow2(n + 4);
      this.mask = this.size - 1;
      this.buf = new Float32Array(this.size);
      this.w = 0;
    }
    write(x) { this.buf[this.w] = x; this.w = (this.w + 1) & this.mask; }
    // d >= 1: d = 1 liefert das zuletzt geschriebene Sample
    read(d) {
      const p = this.w - d;
      const i = Math.floor(p);
      const f = p - i;
      const b = this.buf, m = this.mask;
      const a = b[i & m];
      return a + (b[(i + 1) & m] - a) * f;
    }
    clear() { this.buf.fill(0); this.w = 0; }
  }

  // Rohr als Wellenleiter: Hin- und Rücklauf mit Reflexion am offenen Ende
  // und Dämpfung (Tiefpass) im Rückkopplungszweig.
  class Pipe {
    constructor(maxLen) { this.line = new Delay(Math.ceil(maxLen * 2) + 4); this.lp = 0; }
    process(x, len, refl, damp) {
      const back = this.line.read(len * 2);
      this.lp += (back - this.lp) * damp;
      const y = x + refl * this.lp;
      this.line.write(y);
      return this.line.read(len);
    }
    clear() { this.line.clear(); this.lp = 0; }
  }

  // Biquad (RBJ-Kochbuch), transponierte Direktform II
  class Biquad {
    constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
    _set(b0, b1, b2, a0, a1, a2) {
      const i = 1 / a0;
      this.b0 = b0 * i; this.b1 = b1 * i; this.b2 = b2 * i; this.a1 = a1 * i; this.a2 = a2 * i;
      return this;
    }
    _w(sr, f, q) {
      const w = TAU * clamp(f, 10, sr * 0.45) / sr;
      return [Math.cos(w), Math.sin(w) / (2 * q)];
    }
    lp(sr, f, q) { const [c, a] = this._w(sr, f, q); return this._set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + a, -2 * c, 1 - a); }
    hp(sr, f, q) { const [c, a] = this._w(sr, f, q); return this._set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a); }
    bp(sr, f, q) { const [c, a] = this._w(sr, f, q); return this._set(a, 0, -a, 1 + a, -2 * c, 1 - a); }
    peak(sr, f, q, db) {
      const [c, a] = this._w(sr, f, q);
      const A = Math.pow(10, db / 40);
      return this._set(1 + a * A, -2 * c, 1 - a * A, 1 + a / A, -2 * c, 1 - a / A);
    }
    lowShelf(sr, f, db) {
      const [c, a] = this._w(sr, f, 0.7071);
      const A = Math.pow(10, db / 40), k = 2 * Math.sqrt(A) * a;
      return this._set(
        A * ((A + 1) - (A - 1) * c + k), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - k),
        (A + 1) + (A - 1) * c + k, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - k);
    }
    process(x) {
      const y = this.b0 * x + this.z1;
      this.z1 = this.b1 * x - this.a1 * y + this.z2;
      this.z2 = this.b2 * x - this.a2 * y;
      return y;
    }
    reset() { this.z1 = 0; this.z2 = 0; }
  }

  // Druckimpuls beim Öffnen des Auslassventils: steiler Anstieg (Vorauslassstoß),
  // abklingende Schwingung mit Unterdruckphase, mittelwertfrei.
  function buildPulse(N, attack) {
    const t = new Float32Array(N + 2);
    let sum = 0;
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      let v;
      if (x < attack) v = 0.5 - 0.5 * Math.cos(Math.PI * x / attack);
      else {
        const y = (x - attack) / (1 - attack);
        v = Math.exp(-3.6 * y) * Math.cos(Math.PI * 1.55 * y);
      }
      if (x > 0.85) v *= 0.5 + 0.5 * Math.cos(Math.PI * (x - 0.85) / 0.15);
      t[i] = v;
      sum += v;
    }
    const mean = sum / (N + 1);
    for (let i = 0; i <= N; i++) {
      const w = Math.sin(Math.PI * i / N);
      t[i] -= mean * 2 * w * w;
    }
    t[N + 1] = 0;
    return t;
  }

  // Bandbegrenzter Sägezahn (PolyBLEP) für den Elektro-Modus
  function blepSaw(ph, inc) {
    let v = 2 * ph - 1;
    if (ph < inc) { const t = ph / inc; v -= t + t - t * t - 1; }
    else if (ph > 1 - inc) { const t = (ph - 1) / inc; v -= t * t + t + t + 1; }
    return v;
  }

  /*
   * Ausgangsstufe: Klangregelung, Innenraum-Hall (kleines Feedback-Delay-Netz,
   * gibt Teslas Immersive-Sound-Upmix dekorreliertes Material), Lautheit und
   * Limiter ohne Vorlauf (keine zusätzliche Latenz).
   */
  class Output {
    constructor(sr) {
      this.sr = sr;
      this.shL = new Biquad(); this.shR = new Biquad();
      this.prL = new Biquad(); this.prR = new Biquad();
      this.len = [7.3, 11.1, 13.9, 17.3].map((ms) => Math.round(ms * sr / 1000));
      this.lines = this.len.map((n) => new Delay(n + 2));
      this.lp = [0, 0, 0, 0];
      this.env = 0;
      this.att = 1 - Math.exp(-1 / (0.0008 * sr));
      this.rel = Math.exp(-1 / (0.15 * sr));
      this.wet = 0.1;
      this.configure({ bass: 4, room: 0.35 });
    }
    configure(s) {
      if (typeof s.bass === 'number') { this.shL.lowShelf(this.sr, 110, s.bass); this.shR.lowShelf(this.sr, 110, s.bass); }
      this.prL.peak(this.sr, 2600, 0.8, 1.5); this.prR.peak(this.sr, 2600, 0.8, 1.5);
      if (typeof s.room === 'number') this.wet = s.room * 0.32;
    }
    reset() { for (const d of this.lines) d.clear(); this.lp = [0, 0, 0, 0]; this.env = 0; }
    process(L, R, off, m, loud) {
      const CEIL = 0.84, lines = this.lines, len = this.len, lp = this.lp, wet = this.wet;
      for (let s = off; s < off + m; s++) {
        let l = this.prL.process(this.shL.process(L[s]));
        let r = this.prR.process(this.shR.process(R[s]));
        if (wet > 0.001) {
          const y0 = lines[0].read(len[0]), y1 = lines[1].read(len[1]);
          const y2 = lines[2].read(len[2]), y3 = lines[3].read(len[3]);
          const m0 = (y0 + y1 + y2 + y3) * 0.5, m1 = (y0 - y1 + y2 - y3) * 0.5;
          const m2 = (y0 + y1 - y2 - y3) * 0.5, m3 = (y0 - y1 - y2 + y3) * 0.5;
          lp[0] += (m0 - lp[0]) * 0.42; lp[1] += (m1 - lp[1]) * 0.38;
          lp[2] += (m2 - lp[2]) * 0.35; lp[3] += (m3 - lp[3]) * 0.31;
          lines[0].write(l * 0.5 + lp[0] * 0.62); lines[1].write(r * 0.5 + lp[1] * 0.62);
          lines[2].write(l * 0.5 + lp[2] * 0.62); lines[3].write(r * 0.5 + lp[3] * 0.62);
          l += (y0 + 0.6 * y2) * wet;
          r += (y1 + 0.6 * y3) * wet;
        }
        l *= loud; r *= loud;
        const pk = Math.max(l < 0 ? -l : l, r < 0 ? -r : r);
        this.env = pk > this.env ? this.env + (pk - this.env) * this.att : this.env * this.rel;
        const g = this.env > CEIL ? CEIL / this.env : 1;
        L[s] = softClip(l * g);
        R[s] = softClip(r * g);
      }
    }
  }

  function softClip(x) {
    const a = x < 0 ? -x : x;
    if (a <= 0.85) return x;
    const y = 0.85 + 0.09 * Math.tanh((a - 0.85) * 11);
    return x < 0 ? -y : y;
  }

  // Lautheit: bringt den Motor bei gleicher Fahrzeug-Lautstärke auf Musik-Niveau
  const LOUD = 1.6;

  const BLOCK = 64;
  const MAX_CYL = 12;

  class EngineDSP {
    constructor(sr) {
      this.sr = sr;
      this.maxLen = Math.ceil(sr * 0.016);
      this.hdr = [];
      for (let i = 0; i < MAX_CYL; i++) this.hdr.push(new Pipe(this.maxLen));
      this.col = [new Pipe(this.maxLen), new Pipe(this.maxLen)];
      this.tail = [new Pipe(this.maxLen), new Pipe(this.maxLen)];
      this.pulses = [];
      for (let i = 0; i < MAX_CYL; i++) this.pulses.push({ pos: 2, rate: 0, amp: 0, nAmp: 0 });
      this.crk = [];
      for (let i = 0; i < 8; i++) this.crk.push({ env: 0, dec: 0, amp: 0, lp: 0, col: 0.3, bank: 0, body: 0 });

      const names = ['boomL', 'boomR', 'raspL', 'raspR', 'lpL', 'lpR', 'lp2L', 'lp2R', 'intRes', 'intNz',
        'mech', 'hiss', 'bov', 'bovHp', 'noiseLp', 'evL', 'evR', 'evWind', 'intNzR', 'body1', 'body2'];
      this.f = {};
      for (const n of names) this.f[n] = new Biquad();
      this.out = new Output(sr);

      this.N = 1024;
      this.tab = buildPulse(this.N, 0.08);
      this.p = null;
      this.ev = [];
      this.cylGain = [];

      this.set = { intake: 1, crackle: 1, turbo: 1, width: 0.8, sub: 1, bass: 4, room: 0.35 };
      this.subPh = [0, 0, 0]; this.subInc = [0, 0, 0]; this.subW = [0, 0, 0];
      this.subEnv = 0; this.subAmt = 0;
      this.kSubEnv = 1 - Math.exp(-TAU * 25 / sr);

      // Zustand (Zielwerte kommen 50x/s vom Hauptthread, hier wird geglättet)
      this.rpm = 0; this.rpmT = 0;
      this.thr = 0; this.thrT = 0;
      this.cut = false; this.prevCut = false;
      this.overrun = 0;
      this.starter = 0; this.starterT = 0;
      this.phase = 0; this.next = 0;
      this.nz = 0;
      this.kRpm = 1 - Math.exp(-1 / (sr * 0.012));
      this.kThr = 1 - Math.exp(-1 / (sr * 0.02));
      this.kSt = 1 - Math.exp(-1 / (sr * 0.05));

      this.boost = 0; this.boostPeak = 0; this.thrSlow = 0; this.bovCool = 0;
      this.bovEnv = 0; this.bovDec = Math.exp(-1 / (0.3 * sr)); this.bovT = 0;
      this.whPh = 0; this.whInc = 0; this.scPh = 0; this.stPh = 0;
      this.crRate = 0; this.popWait = -1;
      this.dcL = { x: 0, y: 0 }; this.dcR = { x: 0, y: 0 };
      this.dcK = Math.exp(-TAU * 18 / sr);

      // Elektro
      this.ePh = [0, 0, 0, 0, 0, 0];
      this.lfo = 0;
    }

    setSettings(s) { Object.assign(this.set, s); this.out.configure(this.set); }

    setState(d) {
      if (typeof d.rpm === 'number' && isFinite(d.rpm)) this.rpmT = clamp(d.rpm, 0, 25000);
      if (typeof d.thr === 'number' && isFinite(d.thr)) this.thrT = clamp(d.thr, 0, 1);
      this.cut = !!d.cut;
      this.overrun = clamp(d.overrun || 0, 0, 1);
      this.starterT = clamp(d.starter || 0, 0, 1);
    }

    setProfile(p) {
      const sr = this.sr, ms = (x) => clamp(x * sr / 1000, 1, this.maxLen);
      this.p = p;
      for (const h of this.hdr) h.clear();
      for (const c of this.col) c.clear();
      for (const t of this.tail) t.clear();
      for (const k in this.f) this.f[k].reset();
      for (const pl of this.pulses) pl.pos = 2;
      for (const c of this.crk) c.env = 0;
      this.boost = 0; this.bovEnv = 0; this.phase = 0; this.next = 0;

      if (p.type === 'electric') {
        this.f.evWind.bp(sr, 900, 0.5);
        return;
      }

      const ev = p.fire.map((o, i) => ({ o: o - Math.floor(o), bank: p.banks[i] || 0, hdr: ms(p.hdr[i]) }));
      ev.sort((a, b) => a.o - b.o);
      this.ev = ev;
      this.cylGain = ev.map(() => 1 + (Math.random() * 2 - 1) * 0.05);
      this.lopeS = ev.map(() => 0);
      this.tab = buildPulse(this.N, p.attack);
      this.dual = ev.some((e) => e.bank === 1);
      this.colLen = [ms(p.colMs[0]), ms(p.colMs[1] != null ? p.colMs[1] : p.colMs[0])];
      this.tailLen = [ms(p.tailMs[0]), ms(p.tailMs[1] != null ? p.tailMs[1] : p.tailMs[0] * 1.08)];

      const f = this.f;
      f.boomL.peak(sr, p.boom.f, p.boom.q, p.boom.db);
      f.boomR.peak(sr, p.boom.f * 1.03, p.boom.q, p.boom.db);
      f.raspL.peak(sr, p.rasp.f, p.rasp.q, p.rasp.db);
      f.raspR.peak(sr, p.rasp.f * 0.97, p.rasp.q, p.rasp.db);
      f.intRes.bp(sr, p.intakeHz, 3);
      // Karosserie-Eigenmoden: dröhnen, wenn Zünd- oder Halbordnungen sie treffen
      f.body1.bp(sr, 42, 4);
      f.body2.bp(sr, 71, 4);
      f.mech.bp(sr, p.mechHz || 2800, 1.4);
      f.noiseLp.lp(sr, 3800, 0.7);
      f.bov.bp(sr, 2300, 0.9);
      f.bovHp.hp(sr, 700, 0.7);
    }

    reset() {
      if (this.p) this.setProfile(this.p);
      this.out.reset();
      this.dcL.x = this.dcL.y = this.dcR.x = this.dcR.y = 0;
    }

    fire(e) {
      const p = this.p, pl = this.pulses[e];
      const rpm = Math.max(this.rpm, 60);
      if (this.rpm < 40) return;
      const rpmN = rpm / p.redline;
      const thr = this.cut ? 0 : this.thr;

      // ohne Verbrennung (Schaltunterbrechung, Begrenzer, Anlasser) bleibt nur das Pumpen
      let load = this.cut ? 0.05 + 0.04 * Math.random() : 0.24 + 0.76 * thr;
      const lope = p.lope * (1 - thr) * Math.max(0, 1 - rpmN * 2.6);
      const rough = p.rough + lope;
      let amp = load * (0.5 + 0.5 * Math.min(1, rpmN * 1.4)) * this.cylGain[e] * (1 + rough * (Math.random() * 2 - 1));
      if (lope > 0 && !this.cut) {
        // Nockenwellen-Lope: Verbrennungsgüte je Zylinder schwankt über mehrere Arbeitsspiele
        // korreliert -> rhythmisches „ba-dumm“ statt bloßem Rauschen
        const ls = this.lopeS[e] = this.lopeS[e] * 0.85 + (Math.random() * 2 - 1) * 0.15;
        amp *= 1 + lope * 2.5 * ls;
        if (Math.random() < lope * 0.12) amp *= 0.35 + 0.3 * Math.random();
      }

      const deg = p.pulseDeg * (1.25 - 0.45 * thr);
      const dur = clamp(deg / (rpm * 6), 0.0011, 0.014);
      pl.rate = 1 / (dur * this.sr);
      pl.pos = -Math.random() * p.jitterMs * 0.001 * this.sr * pl.rate;
      pl.amp = amp;
      pl.nAmp = amp * p.noise * (0.6 + 0.8 * thr);
    }

    spawnCrackle(big) {
      let c = null;
      for (const k of this.crk) if (k.env < 0.002) { c = k; break; }
      if (!c) return;
      const boom = Math.random() < 0.14 * big;
      const tau = boom ? 0.012 + Math.random() * 0.012 : 0.0018 + Math.random() * 0.007;
      c.env = 1;
      c.dec = Math.exp(-1 / (tau * this.sr));
      c.amp = (0.35 + Math.random() * 0.85) * (boom ? 2.4 : 1) * big;
      c.col = 0.18 + Math.random() * 0.45;
      c.bank = this.dual && Math.random() < 0.5 ? 1 : 0;
      c.body = boom ? 1.2 : 0.5;
    }

    block(m) {
      const p = this.p, sr = this.sr, dt = m / sr, f = this.f;
      const rpmN = clamp(this.rpm / p.redline, 0, 1.2);
      const thr = this.cut ? 0 : this.thr;

      // Schalldämpfer: Klappe/Tiefpass öffnet mit Last und Drehzahl
      const open = clamp(0.55 * thr + 0.45 * rpmN * rpmN, 0, 1);
      const fc = lerp(p.lpBase, p.lpOpen, open);
      f.lpL.lp(sr, fc, 0.62); f.lpR.lp(sr, fc * 1.05, 0.62);
      f.lp2L.lp(sr, fc * 1.6, 0.55); f.lp2R.lp(sr, fc * 1.65, 0.55);

      f.intNz.bp(sr, 450 + 2400 * rpmN, 1.1);
      f.intNzR.bp(sr, 470 + 2350 * rpmN, 1.1);

      // Subwoofer-Ebene: Zündfrequenz und ihre Halb-/Viertelordnungen, gewichtet auf
      // den Bereich, den der Subwoofer wirklich spielt (~25–110 Hz)
      const fireHz = this.rpm / 60 * this.ev.length / p.cycleRevs;
      const ratios = [1, 0.5, 0.25], weights = [1, 0.7, 0.45];
      for (let k = 0; k < 3; k++) {
        const fk = fireHz * ratios[k];
        this.subInc[k] = fk / sr;
        this.subW[k] = fk < 20 || fk > 150 ? 0 : weights[k] * Math.exp(-0.5 * Math.pow(Math.log2(fk / 48) / 0.8, 2));
      }
      this.subAmt = this.set.sub * (p.subGain != null ? p.subGain : 1) * (0.35 + 0.65 * thr) * clamp(this.rpm / p.idle, 0, 1);
      this.intakeAmt = p.intake * this.set.intake * (0.08 + thr) * (0.25 + 0.75 * rpmN);
      this.mechAmt = p.mech * (0.35 + 0.65 * rpmN);

      // Schubknallen / Nachverbrennung
      let rate = 0;
      if (p.crackle > 0 && this.set.crackle > 0) {
        const rpmF = clamp((this.rpm - p.idle * 1.5) / (p.redline * 0.35), 0, 1);
        if (this.thr < 0.08) rate += this.overrun * rpmF * 24;
        if (this.cut && this.rpm > p.idle * 1.3) rate += 9 + 30 * rpmF;
        rate *= p.crackle * this.set.crackle;
      }
      this.crRate = rate / sr;
      if (this.cut && !this.prevCut && this.rpm > p.idle * 1.8 && Math.random() < p.shiftPop * this.set.crackle) {
        this.spawnCrackle(1.5);
        if (Math.random() < 0.6) this.popWait = Math.floor(sr * (0.025 + Math.random() * 0.05));
      }
      this.prevCut = this.cut;

      // Turbo
      if (p.turbo) {
        const T = p.turbo;
        const spool = clamp((this.rpm - T.spool0) / (T.spool1 - T.spool0), 0, 1);
        const tgt = thr * spool;
        const k = tgt > this.boost ? 1 - Math.exp(-dt / 0.6) : 1 - Math.exp(-dt / 0.35);
        this.boost += (tgt - this.boost) * k;
        this.boostPeak = Math.max(this.boost, this.boostPeak - dt * 1.2);
        this.thrSlow += (thr - this.thrSlow) * (1 - Math.exp(-dt / 0.3));
        this.bovCool -= dt;
        if (this.bovCool <= 0 && this.boostPeak > 0.3 && this.thrSlow - thr > 0.22) {
          this.bovEnv = Math.min(1, this.boostPeak * 1.25);
          this.bovT = 0;
          this.bovCool = 0.8;
          this.boost *= 0.35;
          this.boostPeak = this.boost;
        }
        this.whInc = lerp(T.whistle[0], T.whistle[1], this.boost) / sr;
        f.hiss.bp(sr, 3200 + 4200 * this.boost, 1.4);
        this.turboAmt = T.gain * this.set.turbo;
      }
    }

    process(L, R, n) {
      if (!this.p) { L.fill(0); if (R !== L) R.fill(0); return; }
      let i = 0;
      while (i < n) {
        const m = Math.min(BLOCK, n - i);
        if (this.p.type === 'electric') this.renderEV(L, R, i, m);
        else { this.block(m); this.renderICE(L, R, i, m); }
        this.out.process(L, R, i, m, LOUD);
        i += m;
      }
      // Notbremse bei numerischen Problemen
      if (!isFinite(L[n - 1]) || Math.abs(L[n - 1]) > 40) {
        L.fill(0); if (R !== L) R.fill(0);
        this.reset();
      }
    }

    renderICE(L, R, off, m) {
      const p = this.p, sr = this.sr, ev = this.ev, nEv = ev.length, pulses = this.pulses;
      const tab = this.tab, N = this.N, hdr = this.hdr, f = this.f, crk = this.crk;
      const hRefl = p.hdrRefl, hDamp = p.hdrDamp;
      const cRefl = p.colRefl, cDamp = p.colDamp, tRefl = p.tailRefl, tDamp = p.tailDamp;
      const heat = 1 - 0.05 * this.thr; // heißes Gas -> etwas schnellere Schallgeschwindigkeit
      const c0Len = this.colLen[0] * heat, c1Len = this.colLen[1] * heat;
      const t0Len = this.tailLen[0] * heat, t1Len = this.tailLen[1] * heat;
      const dual = this.dual, x = p.cross;
      const drive = p.drive, invD = 1 / Math.tanh(drive);
      const width = this.set.width;
      const gain = p.gain;
      const cycleK = 1 / (60 * p.cycleRevs * sr);
      const crRate = this.crRate;
      const intakeAmt = this.intakeAmt, mechAmt = this.mechAmt;
      const T = p.turbo, turboAmt = T ? this.turboAmt : 0;
      const sc = p.sc;
      const dcK = this.dcK;
      const subInc = this.subInc, subW = this.subW, subAmt = this.subAmt, kSub = this.kSubEnv;

      for (let s = 0; s < m; s++) {
        this.rpm += (this.rpmT - this.rpm) * this.kRpm;
        this.thr += (this.thrT - this.thr) * this.kThr;
        this.starter += (this.starterT - this.starter) * this.kSt;

        // Kurbelwinkel weiterdrehen, Zündungen auslösen
        let ph = this.phase + this.rpm * cycleK;
        if (ph >= 1) {
          while (this.next < nEv) this.fire(this.next++);
          ph -= 1; this.next = 0;
        }
        while (this.next < nEv && ev[this.next].o <= ph) this.fire(this.next++);
        this.phase = ph;

        const white = Math.random() * 2 - 1;
        const nz = f.noiseLp.process(white) * 1.6;

        // Zylinderimpulse -> Krümmerrohre -> Bänke
        let b0 = 0, b1 = 0, ind = 0, raw = 0;
        for (let e = 0; e < nEv; e++) {
          const pl = pulses[e];
          let v = 0, xs = 0;
          if (pl.pos < 1) {
            pl.pos += pl.rate;
            if (pl.pos >= 0 && pl.pos < 1) {
              const fi = pl.pos * N, ii = fi | 0;
              v = tab[ii] + (tab[ii + 1] - tab[ii]) * (fi - ii);
              xs = v * pl.amp + (v < 0 ? -v : v) * pl.nAmp * nz;
              if (v > 0) ind += v * pl.amp;
            }
          }
          raw += xs;
          const h = hdr[e].process(xs, ev[e].hdr, hRefl, hDamp);
          if (ev[e].bank === 1) b1 += h; else b0 += h;
        }

        // Knallen in den Sammler einspeisen (klingt dann durch die Anlage)
        if (crRate > 0 && Math.random() < crRate) this.spawnCrackle(1);
        if (this.popWait >= 0 && this.popWait-- === 0) this.spawnCrackle(1.2);
        for (let k = 0; k < 8; k++) {
          const c = crk[k];
          if (c.env > 0.002) {
            c.env *= c.dec;
            c.lp += (Math.random() * 2 - 1 - c.lp) * c.col;
            const cv = (c.lp + c.env * c.body) * c.env * c.amp;
            if (c.bank === 1) b1 += cv; else b0 += cv;
          }
        }

        const c0 = this.col[0].process(b0, c0Len, cRefl, cDamp);
        let tl, tr;
        if (dual) {
          const c1 = this.col[1].process(b1, c1Len, cRefl, cDamp);
          tl = c0 * (1 - x) + c1 * x;
          tr = c1 * (1 - x) + c0 * x;
        } else { tl = c0; tr = c0; }
        let eL = this.tail[0].process(tl, t0Len, tRefl, tDamp);
        let eR = this.tail[1].process(tr, t1Len, tRefl, tDamp);

        // Schalldämpfer
        eL = f.lpL.process(f.raspL.process(f.boomL.process(eL)));
        eR = f.lpR.process(f.raspR.process(f.boomR.process(eR)));
        eL = Math.tanh(eL * drive) * invD;
        eR = Math.tanh(eR * drive) * invD;

        // Ansaugung (Resonanz mittig, Rauschen dekorreliert links/rechts) + Mechanik
        const white2 = Math.random() * 2 - 1;
        const inMod = 0.12 + ind * 0.9;
        const inRes = f.intRes.process(ind) * 1.4 * intakeAmt;
        const inL = f.intNz.process(white) * inMod * intakeAmt;
        const inR = f.intNzR.process(white2) * inMod * intakeAmt;
        let mid = inRes + f.mech.process(raw) * mechAmt;

        // Subwoofer-Ebene + Karosserie-Dröhnen (mono, wie echter Tiefbass)
        this.subEnv += (ind - this.subEnv) * kSub;
        let sb = 0;
        for (let k = 0; k < 3; k++) {
          const ph = this.subPh[k] + subInc[k];
          this.subPh[k] = ph >= 1 ? ph - 1 : ph;
          sb += subW[k] * Math.sin(TAU * this.subPh[k]);
        }
        sb = sb * (0.5 + 0.9 * this.subEnv) * 0.24 +(f.body1.process(raw) + f.body2.process(raw) * 0.7) * 0.9;
        mid += Math.tanh(sb * subAmt * 2) * 0.5;

        // Turbo: Laderpfeifen, Rauschen, Blow-Off-Ventil (mit Flattern)
        if (T) {
          const b = this.boost;
          this.whPh += this.whInc; if (this.whPh >= 1) this.whPh -= 1;
          let t = (Math.sin(TAU * this.whPh) * 0.035 * b * b + f.hiss.process(white) * 0.05 * b) * turboAmt;
          if (this.bovEnv > 0.002) {
            this.bovEnv *= this.bovDec;
            this.bovT += 1 / sr;
            let fl = 1;
            if (T.flutter > 0) {
              const s = 0.5 + 0.5 * Math.sin(TAU * (17 + 6 * this.bovEnv) * this.bovT);
              fl = 1 - T.flutter + T.flutter * s * s * 2;
            }
            t += f.bovHp.process(f.bov.process(white)) * this.bovEnv * T.bov * 0.5 * fl * this.set.turbo;
          }
          mid += t;
        }

        // Kompressor-Heulen (Roots/Twin-Screw)
        if (sc) {
          this.scPh += this.rpm / 60 * sc.ratio / sr; if (this.scPh >= 1) this.scPh -= 1;
          const rN = this.rpm / p.redline;
          mid += (Math.sin(TAU * this.scPh) + 0.25 * Math.sin(TAU * 2 * this.scPh)) * sc.gain * (0.25 + 0.75 * this.thr) * rN * rN * this.set.turbo;
        }

        // Anlasser
        if (this.starter > 0.002) {
          this.stPh += 1150 / sr; if (this.stPh >= 1) this.stPh -= 1;
          const comp = 0.65 + 0.35 * Math.cos(TAU * this.phase * Math.max(1, nEv / 2));
          mid += (Math.sin(TAU * this.stPh) * 0.5 + (this.stPh * 2 - 1) * 0.25 + nz * 0.2) * 0.05 * this.starter * comp;
        }

        let l = eL + inL + mid, r = eR + inR + mid;
        // Stereobreite (Mitte/Seite)
        const M = (l + r) * 0.5, S = (l - r) * 0.5 * width;
        l = (M + S) * gain; r = (M - S) * gain;

        // Gleichanteil entfernen (Limiter folgt in der Ausgangsstufe)
        let y = l - this.dcL.x + dcK * this.dcL.y; this.dcL.x = l; this.dcL.y = y; L[off + s] = y;
        y = r - this.dcR.x + dcK * this.dcR.y; this.dcR.x = r; this.dcR.y = y; R[off + s] = y;
      }
    }

    // „Hyperdrive“: futuristischer E-Sound (Sägezähne + resonanter Filter + Inverter-Pfeifen)
    renderEV(L, R, off, m) {
      const p = this.p, sr = this.sr, f = this.f, ph = this.ePh;
      const rpmN = clamp(this.rpm / p.redline, 0, 1.1);
      const thr = this.thr;
      const fc = 140 + 900 * rpmN + 2600 * thr;
      f.evL.lp(sr, fc, 3.2); f.evR.lp(sr, fc * 1.04, 3.2);
      const width = this.set.width, gain = p.gain;
      for (let s = 0; s < m; s++) {
        this.rpm += (this.rpmT - this.rpm) * this.kRpm;
        this.thr += (this.thrT - this.thr) * this.kThr;
        const on = clamp(this.rpm / 250, 0, 1);
        const f0 = 36 + this.rpm / 60 * 0.6;
        const i1 = f0 * 1.006 / sr, i2 = f0 * 0.994 / sr, i3 = f0 * 0.5 / sr;
        const iw = f0 * 12 / sr, is = f0 * 18.5 / sr;
        ph[0] += i1; if (ph[0] >= 1) ph[0] -= 1;
        ph[1] += i2; if (ph[1] >= 1) ph[1] -= 1;
        ph[2] += i3; if (ph[2] >= 1) ph[2] -= 1;
        ph[3] += iw; if (ph[3] >= 1) ph[3] -= 1;
        ph[4] += is; if (ph[4] >= 1) ph[4] -= 1;
        this.lfo += (0.4 + 3 * rpmN) / sr; if (this.lfo >= 1) this.lfo -= 1;
        const throb = 1 - 0.12 * (0.5 + 0.5 * Math.sin(TAU * this.lfo));
        const sub = Math.sin(TAU * ph[2]) * 0.5;
        const a = blepSaw(ph[0], i1), b = blepSaw(ph[1], i2);
        const lvl = (0.15 + 0.85 * thr) * (0.55 + 0.45 * Math.min(1, rpmN * 4)) * on * throb;
        const whine = (Math.sin(TAU * ph[3]) * 0.06 * Math.min(1, this.rpm / 1500) * (0.25 + thr)
          + Math.sin(TAU * ph[4]) * 0.025 * thr) * on;
        const wind = f.evWind.process(Math.random() * 2 - 1) * 0.06 * rpmN * rpmN;
        const subL = sub * lvl * 0.8 * this.set.sub;
        let l = f.evL.process((a * 0.6 + b * 0.25) * lvl) + subL + whine + wind;
        let r = f.evR.process((b * 0.6 + a * 0.25) * lvl) + subL + whine + wind;
        const M = (l + r) * 0.5, S = (l - r) * 0.5 * width;
        L[off + s] = (M + S) * gain;
        R[off + s] = (M - S) * gain;
      }
    }
  }

  G.EngineDSP = EngineDSP;

  if (typeof registerProcessor === 'function') {
    class EngineProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.dsp = new EngineDSP(sampleRate);
        this.port.onmessage = (e) => {
          const d = e.data;
          if (d.type === 'state') this.dsp.setState(d);
          else if (d.type === 'profile') this.dsp.setProfile(d.profile);
          else if (d.type === 'settings') this.dsp.setSettings(d.settings);
        };
      }
      process(inputs, outputs) {
        const out = outputs[0];
        if (!out || !out[0]) return true;
        const Lc = out[0], Rc = out[1] || out[0];
        this.dsp.process(Lc, Rc, Lc.length);
        return true;
      }
    }
    registerProcessor('engine-processor', EngineProcessor);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
