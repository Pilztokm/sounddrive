/*
 * Fahrzeug-Logik: virtuelles Getriebe, Geschwindigkeit aus GPS, Simulator.
 */
(function (G) {
  'use strict';

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (dt, tau) => 1 - Math.exp(-dt / tau);

  /* ---------- Virtueller Antriebsstrang ---------- */
  class Drivetrain {
    constructor() {
      this.p = null;
      this.gear = 1;
      this.rpm = 0;
      this.thr = 0;
      this.shift = null;
      this.sinceShift = 10;
      this.limT = 0; this.limCool = 0;
      this.overrun = 0; this.thrMem = 0; this.lifted = false;
      this.state = 'off'; this.stateT = 0;
      this.sport = false;
      this.t = 0;
    }

    setProfile(p, v) {
      this.p = p;
      this.shift = null;
      this.gear = p.type === 'electric' ? 0 : this.bestGear(v || 0);
      if (this.state === 'run' && p.type !== 'electric') this.rpm = Math.max(this.rpm, p.idle);
    }

    get electric() { return this.p.type === 'electric'; }

    wheelRpm(v, g) {
      const p = this.p;
      return v / (Math.PI * p.tire) * 60 * p.gears[g - 1] * p.final;
    }

    bestGear(v) {
      const p = this.p;
      if (!p.gears.length) return 0;
      let g = 1;
      for (let i = 1; i <= p.gears.length; i++) if (this.wheelRpm(v, i) > p.shiftEco * 0.8) g = i;
      return g;
    }

    upThr(thr) {
      const p = this.p;
      return this.sport
        ? lerp(p.shiftEco * 1.45, p.redline * 0.97, Math.pow(thr, 0.8))
        : lerp(p.shiftEco, p.redline * 0.95, Math.pow(thr, 1.4));
    }

    downThr(thr) {
      const p = this.p;
      if (thr < 0.06) return this.sport ? p.redline * 0.42 : p.idle * 1.3;
      return this.sport
        ? lerp(p.idle * 1.9, p.redline * 0.62, thr)
        : lerp(p.idle * 1.35, p.redline * 0.5, Math.pow(thr, 1.3));
    }

    start() { this.state = this.electric ? 'run' : 'crank'; this.stateT = 0; }
    stop() { if (this.state !== 'off') { this.state = 'stopping'; this.stateT = 0; } }

    update(dt, v, thrIn, opts) {
      const p = this.p;
      const neutral = !!opts.neutral;
      this.t += dt;
      this.stateT += dt;
      this.sinceShift += dt;
      let cut = false, starter = 0;
      let thr = thrIn;

      if (this.state === 'off') {
        this.rpm = 0; this.thr = 0;
        return this.out(true, 0, neutral);
      }
      if (this.state === 'stopping') {
        this.rpm *= Math.exp(-dt / (this.electric ? 0.25 : 0.32));
        this.thr = 0;
        if (this.rpm < 40) { this.rpm = 0; this.state = 'off'; }
        return this.out(true, 0, neutral);
      }
      if (this.state === 'crank') {
        this.rpm = 230 + 35 * Math.sin(this.stateT * 26);
        this.thr = 0;
        if (this.stateT > 0.9) { this.state = 'catch'; this.stateT = 0; }
        return this.out(true, 1, neutral);
      }

      // ---- Elektro: kein Getriebe, Drehzahl folgt der Geschwindigkeit ----
      if (this.electric) {
        const tgt = Math.max(p.idle, v * 3.6 * p.evK);
        this.rpm += (tgt - this.rpm) * smooth(dt, 0.12);
        if (neutral) this.rpm += (p.idle + thr * 9000 - this.rpm) * smooth(dt, 0.3);
        this.thr += (thr - this.thr) * smooth(dt, 0.08);
        return this.out(false, 0, neutral);
      }

      // ---- Verbrenner ----
      let tgt;
      let tauUp = 0.07, tauDown = 0.09;
      if (neutral) {
        this.shift = null;
        tgt = p.idle + thr * (p.limiter + 400 - p.idle);
        tauUp = p.revUp; tauDown = p.revDown;
      } else {
        if (v < 1.2 && !this.shift) this.gear = 1;
        const coasting = thr < 0.06;
        const n = p.gears.length;
        if (!this.shift && this.sinceShift > 0.6) {
          const r = this.wheelRpm(v, this.gear);
          if (this.gear < n && v > 2 && r > this.upThr(thr) && (!coasting || r > p.redline * 0.9)) {
            if (coasting || this.wheelRpm(v, this.gear + 1) > this.downThr(thr) * 1.08) this.beginShift(1);
          } else if (this.gear > 1 && v > 1.2) {
            const rLow = this.wheelRpm(v, this.gear - 1);
            const ceil = coasting ? p.redline * 0.85 : this.upThr(thr) * 0.92;
            if (r < this.downThr(thr) && rLow < ceil) this.beginShift(-1);
          }
        }

        if (this.shift) {
          const sh = this.shift;
          sh.t += dt;
          const dur = p.shiftTime * (sh.dir < 0 ? 1.3 : 1);
          const k = clamp(sh.t / dur, 0, 1);
          const e = k * k * (3 - 2 * k);
          const to = Math.max(this.wheelRpm(v, sh.to), p.idle);
          tgt = lerp(sh.from, to, e);
          if (sh.dir > 0) {
            if (p.shiftStyle === 'auto') thr *= 0.35; else { cut = k < 0.9; thr = 0; }
          } else {
            const blip = p.shiftStyle === 'auto' ? 0.35 : 0.7;
            thr = Math.max(thr, k < 0.65 ? blip : thr);
          }
          if (k >= 1) { this.gear = sh.to; this.shift = null; this.sinceShift = 0; }
          this.rpm = tgt;
        } else {
          const r = this.wheelRpm(v, this.gear);
          const slip = clamp(1 - v / p.clutchV, 0, 1);
          const launch = lerp(p.idle, p.launchRpm, thr);
          tgt = Math.max(r, slip * launch, p.idle);
          if (slip > 0.3 || r < p.idle * 1.05) { tauUp = p.revUp; tauDown = p.revDown; }
        }
      }

      if (this.state === 'catch') {
        const t = this.stateT;
        const flare = t < 0.3 ? lerp(230, p.idle * 2.1, t / 0.3) : lerp(p.idle * 2.1, p.idle, clamp((t - 0.3) / 0.9, 0, 1));
        tgt = Math.max(tgt, flare);
        if (t < 0.35) thr = Math.max(thr, 0.45);
        starter = clamp(1 - t / 0.15, 0, 1);
        if (t > 1.3) this.state = 'run';
      }

      if (!this.shift) {
        // Leerlauf lebt: leichte Drehzahlschwankung
        if (tgt < p.idle * 1.2) tgt += p.idle * (0.012 * Math.sin(this.t * 2.3) + 0.008 * Math.sin(this.t * 5.7));
        this.rpm += (tgt - this.rpm) * smooth(dt, tgt > this.rpm ? tauUp : tauDown);
      }

      // Drehzahlbegrenzer
      this.limCool -= dt;
      if (this.rpm >= p.limiter && this.limCool <= 0) {
        this.limT = 0.045 + Math.random() * 0.025;
        this.limCool = this.limT + 0.03;
      }
      if (this.limT > 0) {
        this.limT -= dt;
        cut = true;
        this.rpm -= p.redline * 0.9 * dt;
      }
      if (this.rpm > p.limiter + 150) this.rpm = p.limiter + 150;

      // Gaswegnahme erkennen -> Schubphase (Blubbern & Knallen)
      this.thrMem = Math.max(thrIn, this.thrMem - dt * 0.8);
      if (thrIn > 0.15) { this.lifted = false; this.overrun = 0; }
      if (!this.lifted && this.thrMem > 0.2 && thrIn < 0.08) { this.lifted = true; this.overrun = clamp(this.thrMem * 1.4, 0.5, 1); }
      const floor = thrIn < 0.08 && this.rpm > p.idle * 1.8 ? 0.25 : 0;
      this.overrun = Math.max(floor, this.overrun - dt / 2.4);

      this.thr += (thr - this.thr) * smooth(dt, 0.05);
      return this.out(cut, starter, neutral);
    }

    beginShift(dir) {
      this.shift = { dir, t: 0, from: this.rpm, to: this.gear + dir };
    }

    out(cut, starter, neutral) {
      return {
        rpm: this.rpm, thr: this.thr, cut, starter, overrun: this.overrun,
        gear: this.electric ? 'D' : neutral ? 'N' : String(this.shift ? this.shift.to : this.gear),
        shifting: !!this.shift && this.shift.dir > 0 && this.p.shiftStyle !== 'auto',
      };
    }
  }

  /* ---------- Geschwindigkeit aus GPS ---------- */
  function haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  class GpsSource {
    constructor() {
      this.id = null;
      this.v = 0; this.fixV = 0; this.fixT = 0; this.acc = 0;
      this.ok = false; this.err = null; this.accuracy = null; this.rateHz = 0;
      this.last = null; this.onchange = null;
    }

    get supported() { return 'geolocation' in navigator; }

    start() {
      if (this.id != null) return true;
      if (!this.supported) { this.err = 'Dieser Browser bietet kein GPS an.'; return false; }
      if (!window.isSecureContext) { this.err = 'GPS braucht eine HTTPS-Adresse.'; return false; }
      this.err = null;
      this.id = navigator.geolocation.watchPosition(
        (p) => this.onPos(p),
        (e) => this.onErr(e),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
      return true;
    }

    stop() {
      if (this.id != null) navigator.geolocation.clearWatch(this.id);
      this.id = null; this.ok = false; this.last = null; this.v = 0; this.acc = 0;
    }

    onErr(e) {
      const msg = { 1: 'Standortzugriff verweigert – bitte im Browser erlauben.', 2: 'Kein GPS-Signal.', 3: 'GPS antwortet nicht (Timeout).' };
      this.err = msg[e.code] || 'GPS-Fehler';
      if (this.onchange) this.onchange();
    }

    onPos(pos) {
      const now = performance.now() / 1000;
      const c = pos.coords;
      const here = { lat: c.latitude, lon: c.longitude, ts: pos.timestamp };
      let s = typeof c.speed === 'number' && isFinite(c.speed) && c.speed >= 0 ? c.speed : null;
      if (this.last) {
        const dtp = Math.max(0.1, (here.ts - this.last.ts) / 1000);
        if (s === null) {
          s = haversine(this.last, here) / dtp;
          if (c.accuracy > 25) s = lerp(this.fixV, s, 0.4);
        }
        this.rateHz = lerp(this.rateHz || 1 / dtp, 1 / dtp, 0.3);
        const aRaw = clamp((s - this.fixV) / dtp, -12, 12);
        this.acc = lerp(this.acc, aRaw, 0.65);
      }
      if (s === null || s < 0.6) s = 0;
      if (s === 0 && this.fixV === 0) this.acc = Math.min(this.acc, 0);
      this.fixV = s; this.fixT = now;
      this.last = here; this.ok = true; this.err = null; this.accuracy = c.accuracy;
      if (this.onchange) this.onchange();
    }

    update(dt, now) {
      if (!this.ok) return 0;
      const age = now - this.fixT;
      // zwischen den GPS-Punkten (meist 1 Hz) mit der Beschleunigung weiterrechnen
      let target = age > 4 ? this.fixV : this.fixV + this.acc * Math.min(age, 0.8);
      target = Math.max(0, target);
      this.v += (target - this.v) * smooth(dt, 0.35);
      return this.v;
    }

    // Gaspedalstellung aus der Beschleunigung schätzen
    throttle(aFull) {
      const v = this.v, a = this.acc;
      if (v < 0.5 && a < 0.3) return 0;
      if (a < -0.35) return 0;
      return clamp(0.1 + v * 0.004 + a / aFull, 0, 1);
    }
  }

  /* ---------- Simulator (virtuelles Auto mit Gas/Bremse) ---------- */
  class SimCar {
    constructor() { this.v = 0; }
    update(dt, gas, brake, interrupt) {
      const drive = interrupt ? 0 : gas * Math.min(6.5, 210 / Math.max(this.v, 1));
      const a = drive - (0.25 + 0.00042 * this.v * this.v) - brake * 9;
      this.v = Math.max(0, this.v + a * dt);
      return this.v;
    }
  }

  G.Drivetrain = Drivetrain;
  G.GpsSource = GpsSource;
  G.SimCar = SimCar;
})(typeof globalThis !== 'undefined' ? globalThis : this);
