/*
 * SoundDrive – Bedienoberfläche & Hauptschleife
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('sd.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sd.' + k, JSON.stringify(v)); } catch (e) { /* privat/gesperrt */ } },
  };

  const PROFILES = window.SD_PROFILES;
  const settings = Object.assign(
    { volume: 70, bass: 4, intake: 1, crackle: 1, turbo: 1, width: 0.8, sens: 3, sport: false, unit: 'kmh' },
    store.get('settings', {})
  );
  let mode = store.get('mode', 'gps');
  let profile = PROFILES.find((p) => p.id === store.get('profile', 'v8-muscle')) || PROFILES[0];

  const audio = new AudioEngine();
  const drive = new Drivetrain();
  const gps = new GpsSource();
  const car = new SimCar();
  drive.setProfile(profile, 0);

  const input = { gas: 0, brake: 0, keyGas: 0, keyBrake: 0, keys: new Set() };
  let running = false;
  const view = { v: 0, o: drive.out(true, 0, false), needle: 0 };

  /* ---------- Motorauswahl ---------- */
  function renderProfiles() {
    const box = $('#profiles');
    box.innerHTML = '';
    for (const p of PROFILES) {
      const b = document.createElement('button');
      b.className = 'profile' + (p.id === profile.id ? ' active' : '');
      b.style.setProperty('--c', p.color);
      b.innerHTML = `<b></b><span class="sub"></span><span class="tag"></span>`;
      b.querySelector('b').textContent = p.name;
      b.querySelector('.sub').textContent = p.sub;
      b.querySelector('.tag').textContent = p.type === 'electric' ? p.tag : `${p.tag} · ${fmtInt(p.redline)} U/min`;
      b.addEventListener('click', () => selectProfile(p));
      box.appendChild(b);
    }
  }

  function selectProfile(p) {
    profile = p;
    store.set('profile', p.id);
    document.documentElement.style.setProperty('--accent', p.color);
    drive.setProfile(p, view.v);
    audio.setProfile(p);
    tacho.invalidate();
    $$('.profile').forEach((el, i) => el.classList.toggle('active', PROFILES[i].id === p.id));
  }

  /* ---------- Modus ---------- */
  function setMode(m) {
    mode = m;
    store.set('mode', m);
    document.body.classList.remove('mode-gps', 'mode-sim', 'mode-stand');
    document.body.classList.add('mode-' + m);
    $$('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    if (m !== 'sim') car.v = 0;
    if (m === 'gps' && running) gps.start(); else if (m !== 'gps') gps.stop();
    if (m === 'stand') drive.shift = null;
    tacho.resize();
    updateStatus();
  }

  /* ---------- Start / Stopp ---------- */
  let suspendTimer = null;
  async function togglePower() {
    const btn = $('#power');
    if (!running) {
      btn.disabled = true;
      clearTimeout(suspendTimer);
      try {
        await audio.start();
      } catch (e) {
        btn.disabled = false;
        setStatus('bad', 'Audio konnte nicht gestartet werden: ' + e.message);
        return;
      }
      audio.setProfile(profile);
      pushSettings();
      if (mode === 'gps') gps.start();
      drive.start();
      running = true;
      btn.disabled = false;
    } else {
      running = false;
      drive.stop();
      gps.stop();
      suspendTimer = setTimeout(() => { if (!running) audio.suspend(); }, 2000);
    }
    btn.classList.toggle('on', running);
    btn.querySelector('.power-label').textContent = running ? 'STOP' : 'START';
    updateStatus();
  }

  /* ---------- Einstellungen ---------- */
  function pushSettings() {
    audio.setSettings({ intake: settings.intake, crackle: settings.crackle, turbo: settings.turbo, width: settings.width });
    audio.setVolume(settings.volume);
    audio.setBass(settings.bass);
    drive.sport = settings.sport;
  }

  function bindSettings() {
    const pct = (v) => Math.round(v * 100) + ' %';
    const sliders = {
      bass: (v) => '+' + v + ' dB',
      intake: pct, crackle: pct, turbo: pct, width: pct,
      sens: (v) => (v / 9.81).toFixed(2) + ' g',
    };
    for (const [k, fmt] of Object.entries(sliders)) {
      const el = $('#s-' + k), out = $('#o-' + k);
      el.value = settings[k];
      out.textContent = fmt(+el.value);
      el.addEventListener('input', () => {
        settings[k] = +el.value;
        out.textContent = fmt(settings[k]);
        pushSettings();
        store.set('settings', settings);
      });
    }
    const vol = $('#volume');
    vol.value = settings.volume;
    vol.addEventListener('input', () => { settings.volume = +vol.value; audio.setVolume(settings.volume); store.set('settings', settings); });

    const sport = $('#s-sport');
    const syncSport = () => sport.setAttribute('aria-checked', String(settings.sport));
    syncSport();
    sport.addEventListener('click', () => { settings.sport = !settings.sport; syncSport(); pushSettings(); store.set('settings', settings); });

    const unitBtns = $$('#s-unit button');
    const syncUnit = () => unitBtns.forEach((b) => b.classList.toggle('active', b.dataset.unit === settings.unit));
    syncUnit();
    unitBtns.forEach((b) => b.addEventListener('click', () => { settings.unit = b.dataset.unit; syncUnit(); store.set('settings', settings); }));

    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + t.dataset.tab));
    }));
    $$('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('#power').addEventListener('click', togglePower);
  }

  /* ---------- Pedale (Touch, Maus, Tastatur) ---------- */
  function bindPedal(el, key) {
    const fill = el.querySelector('.fill');
    const pointers = new Map();
    const apply = () => {
      let v = 0;
      for (const y of pointers.values()) v = Math.max(v, y);
      input[key] = v;
    };
    const val = (e) => {
      const r = el.getBoundingClientRect();
      // Pedal: oben = voll durchgetreten; untere 12 % = leicht
      return key === 'brake' ? 1 : clamp(1 - (e.clientY - r.top) / r.height, 0.12, 1) ** 0.9;
    };
    el.addEventListener('pointerdown', (e) => {
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* z. B. synthetische Events */ }
      pointers.set(e.pointerId, val(e));
      apply();
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (pointers.has(e.pointerId)) { pointers.set(e.pointerId, val(e)); apply(); } });
    const up = (e) => { pointers.delete(e.pointerId); apply(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return fill;
  }
  const gasFill = bindPedal($('#gas'), 'gas');
  const brakeFill = bindPedal($('#brake'), 'brake');

  const GAS_KEYS = ['ArrowUp', 'KeyW', 'Space'], BRAKE_KEYS = ['ArrowDown', 'KeyS'];
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (GAS_KEYS.includes(e.code) || BRAKE_KEYS.includes(e.code)) { input.keys.add(e.code); e.preventDefault(); }
    if (e.code === 'Enter') togglePower();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => input.keys.clear());

  /* ---------- Hauptschleife (50 Hz) ---------- */
  let last = performance.now() / 1000;
  function tick() {
    const now = performance.now() / 1000;
    const dt = clamp(now - last, 0.001, 0.1);
    last = now;

    const kg = GAS_KEYS.some((k) => input.keys.has(k)) ? 1 : 0;
    const kb = BRAKE_KEYS.some((k) => input.keys.has(k)) ? 1 : 0;
    input.keyGas += (kg - input.keyGas) * (1 - Math.exp(-dt / 0.08));
    input.keyBrake = kb;
    const gas = Math.max(input.gas, input.keyGas);
    const brake = Math.max(input.brake, input.keyBrake);

    let v = 0, thr = 0;
    const neutral = mode === 'stand';
    if (mode === 'gps') {
      v = gps.update(dt, now);
      thr = gps.throttle(settings.sens);
    } else if (mode === 'sim') {
      const interrupt = drive.shift && drive.shift.dir > 0 && profile.shiftStyle !== 'auto';
      v = car.update(dt, running && drive.state !== 'crank' ? gas : 0, brake, interrupt);
      thr = gas;
    } else {
      thr = gas;
    }

    const o = drive.update(dt, v, running ? thr : 0, { neutral });
    audio.state(o);
    view.v = v;
    view.o = o;
    view.gas = gas; view.brake = brake;
  }
  setInterval(tick, 20);

  /* ---------- Drehzahlmesser ---------- */
  const tacho = (() => {
    const cv = $('#tacho');
    const ctx = cv.getContext('2d');
    const face = document.createElement('canvas');
    const fctx = face.getContext('2d');
    let W = 0, H = 0, dpr = 1, dirty = true;
    let geo = null;

    function resize() {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      cv.width = W; cv.height = H;
      face.width = W; face.height = H;
      dirty = true;
    }

    function scaleMax(p) {
      const top = p.type === 'electric' ? p.redline : p.limiter;
      const step = top > 12000 ? 2000 : 1000;
      return { max: Math.ceil((top + 300) / step) * step, step };
    }

    function drawFace() {
      const p = profile;
      const { max, step } = scaleMax(p);
      const cx = W / 2, cy = H * 0.54;
      const R = Math.min(W / 2, H * 0.52) * 0.94;
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      geo = { cx, cy, R, a0, a1, max };
      const c = fctx;
      c.clearRect(0, 0, W, H);

      // Ring
      c.lineCap = 'butt';
      c.beginPath(); c.arc(cx, cy, R, a0, a1);
      c.strokeStyle = '#1b2029'; c.lineWidth = R * 0.08; c.stroke();

      // roter Bereich
      if (p.type !== 'electric') {
        const ar = a0 + (a1 - a0) * (p.redline / max);
        c.beginPath(); c.arc(cx, cy, R, ar, a1);
        c.strokeStyle = '#b3141b'; c.lineWidth = R * 0.08; c.stroke();
      }

      // Skala
      const minor = step / 4;
      for (let v = 0; v <= max + 1; v += minor) {
        const a = a0 + (a1 - a0) * (v / max);
        const majorTick = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const r1 = R * (majorTick ? 0.8 : 0.86), r2 = R * 0.92;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        c.strokeStyle = v >= p.redline && p.type !== 'electric' ? '#ff5a5a' : majorTick ? '#d9dee6' : '#5b6472';
        c.lineWidth = majorTick ? R * 0.016 : R * 0.008;
        c.stroke();
        if (majorTick) {
          const rt = R * 0.68;
          c.fillStyle = v >= p.redline && p.type !== 'electric' ? '#ff6b6b' : '#e6eaf0';
          c.font = `700 ${Math.round(R * 0.1)}px system-ui, sans-serif`;
          c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(String(v / 1000), cx + Math.cos(a) * rt, cy + Math.sin(a) * rt);
        }
      }
      c.fillStyle = '#6d7684';
      c.font = `600 ${Math.round(R * 0.055)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.fillText('× 1000 U/min', cx, cy - R * 0.36);
      c.fillStyle = '#9aa3b1';
      c.font = `700 ${Math.round(R * 0.065)}px system-ui, sans-serif`;
      c.fillText(p.name.toUpperCase(), cx, cy + R * 0.86);
      dirty = false;
    }

    function draw() {
      if (!W) resize();
      if (dirty) drawFace();
      const p = profile, g = geo, o = view.o;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(face, 0, 0);

      view.needle += (o.rpm - view.needle) * 0.45;
      const rpm = clamp(view.needle, 0, g.max);
      const a = g.a0 + (g.a1 - g.a0) * (rpm / g.max);

      // Leuchtbogen bis zur Nadel
      ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R, g.a0, a);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.85; ctx.lineWidth = g.R * 0.08; ctx.stroke(); ctx.globalAlpha = 1;

      // Nadel
      ctx.save();
      ctx.translate(g.cx, g.cy); ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-g.R * 0.12, -g.R * 0.022); ctx.lineTo(g.R * 0.9, -g.R * 0.006);
      ctx.lineTo(g.R * 0.9, g.R * 0.006); ctx.lineTo(-g.R * 0.12, g.R * 0.022); ctx.closePath();
      ctx.fillStyle = '#ff3b2f'; ctx.shadowColor = 'rgba(255,60,40,.7)'; ctx.shadowBlur = 12 * dpr; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R * 0.075, 0, Math.PI * 2); ctx.fillStyle = '#20252e'; ctx.fill();
      ctx.lineWidth = g.R * 0.012; ctx.strokeStyle = '#3a414d'; ctx.stroke();

      // Gang
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f2f4f7';
      ctx.font = `800 ${Math.round(g.R * 0.28)}px system-ui, sans-serif`;
      ctx.fillText(running || drive.state !== 'off' ? o.gear : '–', g.cx, g.cy + g.R * 0.3);

      // Geschwindigkeit + Drehzahl digital
      const mph = settings.unit === 'mph';
      const sp = Math.round(view.v * (mph ? 2.23694 : 3.6));
      const rowY = g.cy + g.R * 0.56, dx = g.R * 0.25;
      ctx.font = `700 ${Math.round(g.R * 0.11)}px system-ui, sans-serif`;
      ctx.fillStyle = '#e6eaf0';
      ctx.fillText(String(sp), g.cx - dx, rowY);
      ctx.fillText(fmtInt(Math.round(o.rpm / 10) * 10), g.cx + dx, rowY);
      ctx.font = `600 ${Math.round(g.R * 0.045)}px system-ui, sans-serif`;
      ctx.fillStyle = '#7d8696';
      ctx.fillText(mph ? 'mph' : 'km/h', g.cx - dx, rowY + g.R * 0.09);
      ctx.fillText('U/min', g.cx + dx, rowY + g.R * 0.09);

      // Lastbalken
      const bw = g.R * 0.5, bx = g.cx - bw / 2, by = g.cy + g.R * 0.74, bh = g.R * 0.025;
      ctx.fillStyle = '#1d222b'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#e6eaf0'; ctx.fillRect(bx, by, bw * clamp(o.thr, 0, 1), bh);

      if (!running && drive.state === 'off') {
        ctx.fillStyle = 'rgba(10,12,15,.55)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#f2f4f7';
        ctx.font = `700 ${Math.round(g.R * 0.09)}px system-ui, sans-serif`;
        ctx.fillText('Motor wählen und START tippen', g.cx, g.cy);
      }
    }

    return { resize, draw, invalidate() { dirty = true; } };
  })();

  /* ---------- Schaltblitz ---------- */
  const lights = $('#shiftlights');
  const NL = 12;
  for (let i = 0; i < NL; i++) {
    const el = document.createElement('i');
    el.className = i < 5 ? 'g' : i < 9 ? 'y' : 'r';
    lights.appendChild(el);
  }
  const lightEls = Array.from(lights.children);
  function drawLights() {
    const p = profile, o = view.o;
    if (p.type === 'electric') { lightEls.forEach((el) => el.classList.remove('on')); lights.classList.remove('flash'); return; }
    const start = p.redline * 0.72, end = p.redline * 0.97;
    const n = Math.round(clamp((o.rpm - start) / (end - start), 0, 1) * NL);
    lightEls.forEach((el, i) => el.classList.toggle('on', i < n));
    lights.classList.toggle('flash', o.rpm > p.redline * 0.985 && Math.floor(performance.now() / 70) % 2 === 0);
  }

  /* ---------- Status ---------- */
  function setStatus(level, text) {
    const s = $('#status');
    s.innerHTML = '<span class="dot"></span><span class="txt"></span>';
    if (level) s.querySelector('.dot').classList.add(level);
    s.querySelector('.txt').textContent = text;
  }
  function updateStatus() {
    if (mode === 'gps') {
      if (!running) return setStatus('', 'GPS-Fahrt: Motor starten, dann Standortzugriff erlauben.');
      if (gps.err) return setStatus('bad', gps.err + (window.isSecureContext ? '' : ' Seite über https:// öffnen.'));
      if (!gps.ok) return setStatus('warn', 'Warte auf GPS-Signal …');
      const acc = gps.accuracy != null ? ` · ±${Math.round(gps.accuracy)} m` : '';
      const hz = gps.rateHz ? ` · ${gps.rateHz.toFixed(1)} Hz` : '';
      return setStatus('good', `GPS aktiv${acc}${hz}`);
    }
    if (mode === 'sim') return setStatus(running ? 'good' : '', 'Simulator: rechts Gas geben (höher tippen = mehr Gas), Bremse daneben. Tastatur: ↑ / ↓');
    return setStatus(running ? 'good' : '', 'Standgas: Gaspedal antippen oder halten zum Hochdrehen.');
  }
  gps.onchange = updateStatus;

  /* ---------- Render-Schleife ---------- */
  function frame() {
    tacho.draw();
    drawLights();
    gasFill.style.height = Math.round((view.gas || 0) * 100) + '%';
    brakeFill.style.height = Math.round((view.brake || 0) * 100) + '%';
    requestAnimationFrame(frame);
  }

  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  /* ---------- Init ---------- */
  renderProfiles();
  bindSettings();
  document.documentElement.style.setProperty('--accent', profile.color);
  setMode(mode);
  window.addEventListener('resize', () => tacho.resize());
  if (window.ResizeObserver) new ResizeObserver(() => tacho.resize()).observe($('#tacho').parentElement);
  setInterval(() => { if (mode === 'gps' && running) updateStatus(); }, 1000);
  requestAnimationFrame(frame);
  window.SoundDrive = { audio, drive, gps }; // für die Fehlersuche in der Konsole

  // Kommt die Seite wieder in den Vordergrund, ggf. pausiertes Audio fortsetzen
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && running && audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume();
  });
})();
