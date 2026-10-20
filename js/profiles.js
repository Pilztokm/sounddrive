/*
 * Motorprofile.
 *
 * fire:  Zündzeitpunkte im Arbeitsspiel (0..1 = 720° Kurbelwinkel beim Viertakter,
 *        360° beim Wankel) in Zündfolge
 * banks: Zylinderbank je Zündung (0 = links, 1 = rechts) – bestimmt, welches
 *        Endrohr den Impuls zuerst bekommt (Crossplane-V8-Blubbern!)
 * hdr:   Krümmerlänge je Zündung in ms Laufzeit (ungleich lang = Boxer-Grollen)
 */
(function (G) {
  'use strict';

  const even = (n) => Array.from({ length: n }, (_, i) => i / n);
  const alt = (n) => Array.from({ length: n }, (_, i) => i % 2);

  const BASE = {
    type: 'ice',
    cycleRevs: 2,
    attack: 0.08, pulseDeg: 140, noise: 0.25, rough: 0.05, lope: 0, jitterMs: 0.15,
    hdrRefl: -0.45, hdrDamp: 0.5,
    colMs: [4, 4.3], colRefl: -0.4, colDamp: 0.32,
    tailMs: [7, 7.6], tailRefl: -0.3, tailDamp: 0.28, cross: 0.2,
    boom: { f: 90, q: 1, db: 4 }, rasp: { f: 1800, q: 1, db: 3 },
    lpBase: 1200, lpOpen: 4500, drive: 1.6,
    intakeHz: 450, intake: 0.4, mech: 0.06, mechHz: 2800,
    turbo: null, sc: null,
    crackle: 0.5, shiftPop: 0.4,
    idle: 800, redline: 6500, limiter: 6700, revUp: 0.18, revDown: 0.5,
    gears: [3.5, 2.1, 1.4, 1.0, 0.8, 0.65], final: 3.7, tire: 0.67,
    shiftEco: 2400, shiftStyle: 'manual', shiftTime: 0.3, launchRpm: 2500, clutchV: 4.5,
    gain: 1,
    color: '#ff6a2b',
  };

  const P = (o) => Object.assign({}, BASE, o);

  const PROFILES = [
    P({
      id: 'v8-muscle', name: 'V8 Muscle', sub: '6.2 L Crossplane · Nockenwelle mit Lope', tag: 'V8 · Sauger',
      fire: even(8), banks: [0, 1, 0, 1, 1, 0, 1, 0], // GM 1-8-7-2-6-5-4-3
      hdr: [1.3, 1.5, 1.6, 1.2, 1.4, 1.7, 1.25, 1.45],
      attack: 0.07, pulseDeg: 150, noise: 0.3, rough: 0.07, lope: 0.55, jitterMs: 0.25,
      hdrRefl: -0.5, colMs: [4.2, 4.6], colRefl: -0.45, colDamp: 0.3,
      tailMs: [9, 9.7], tailRefl: -0.35, tailDamp: 0.25, cross: 0.12,
      boom: { f: 70, q: 0.9, db: 7 }, rasp: { f: 1400, q: 1, db: 2 },
      lpBase: 850, lpOpen: 3200, drive: 1.8, intakeHz: 330, intake: 0.35,
      crackle: 0.55, shiftPop: 0.35,
      idle: 750, redline: 6400, limiter: 6600, revUp: 0.22, revDown: 0.55,
      gears: [2.66, 1.78, 1.30, 1.00, 0.74, 0.50], final: 3.73, tire: 0.70,
      shiftEco: 2200, shiftStyle: 'manual', shiftTime: 0.38, launchRpm: 2200,
      gain: 0.45, color: '#ff5a1f',
    }),
    P({
      id: 'v8-sc', name: 'V8 Kompressor', sub: '6.2 L Supercharged · Heulen des Laders', tag: 'V8 · Kompressor',
      fire: even(8), banks: [0, 1, 0, 1, 1, 0, 1, 0],
      hdr: [1.4, 1.5, 1.55, 1.35, 1.45, 1.6, 1.4, 1.5],
      attack: 0.07, pulseDeg: 145, noise: 0.3, rough: 0.05, lope: 0.18, jitterMs: 0.2,
      hdrRefl: -0.5, colMs: [4.0, 4.4], colRefl: -0.42, colDamp: 0.3,
      tailMs: [8.4, 9.1], tailRefl: -0.33, tailDamp: 0.26, cross: 0.15,
      boom: { f: 75, q: 0.9, db: 6 }, rasp: { f: 1600, q: 1, db: 3 },
      lpBase: 950, lpOpen: 3800, drive: 1.9, intakeHz: 360, intake: 0.4,
      sc: { ratio: 19, gain: 0.07 },
      crackle: 0.45, shiftPop: 0.25,
      idle: 800, redline: 6200, limiter: 6400, revUp: 0.2, revDown: 0.5,
      gears: [4.71, 3.14, 2.11, 1.67, 1.29, 1.00, 0.84, 0.67], final: 2.62, tire: 0.72,
      shiftEco: 2000, shiftStyle: 'auto', shiftTime: 0.24, launchRpm: 2400,
      gain: 0.44, color: '#e8322b',
    }),
    P({
      id: 'v8-flat', name: 'V8 Flatplane', sub: '3.9 L Italien · kreischend bis 8250', tag: 'V8 · Flatplane',
      fire: even(8), banks: alt(8),
      hdr: [2.0, 2.05, 2.0, 2.1, 1.95, 2.05, 2.0, 2.1],
      attack: 0.06, pulseDeg: 120, noise: 0.22, rough: 0.04,
      colMs: [3.0, 3.2], colRefl: -0.4, tailMs: [5.5, 5.9], tailRefl: -0.3, cross: 0.3,
      boom: { f: 110, q: 1, db: 3 }, rasp: { f: 2400, q: 1.1, db: 5 },
      lpBase: 1600, lpOpen: 6500, drive: 1.6, intakeHz: 520, intake: 0.5,
      crackle: 0.6, shiftPop: 0.55,
      idle: 1000, redline: 8250, limiter: 8500, revUp: 0.14, revDown: 0.4,
      gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], final: 4.44, tire: 0.68,
      shiftEco: 3000, shiftStyle: 'dct', shiftTime: 0.1, launchRpm: 3500,
      gain: 0.56, color: '#ff2b3a',
    }),
    P({
      id: 'v10', name: 'V10 Supercar', sub: '5.2 L Sauger · Lambo-Schrei', tag: 'V10 · Sauger',
      fire: even(10), banks: alt(10),
      hdr: [1.8, 1.85, 1.9, 1.8, 1.85, 1.75, 1.9, 1.8, 1.85, 1.9],
      attack: 0.06, pulseDeg: 115, noise: 0.22, rough: 0.04,
      colMs: [3.2, 3.4], tailMs: [6.0, 6.5], cross: 0.25,
      boom: { f: 95, q: 1, db: 3 }, rasp: { f: 2800, q: 1.2, db: 5 },
      lpBase: 1700, lpOpen: 7000, drive: 1.7, intakeHz: 600, intake: 0.55,
      crackle: 0.7, shiftPop: 0.6,
      idle: 1000, redline: 8500, limiter: 8700, revUp: 0.13, revDown: 0.4,
      gears: [3.13, 2.12, 1.61, 1.27, 1.03, 0.85, 0.70], final: 4.2, tire: 0.70,
      shiftEco: 3000, shiftStyle: 'dct', shiftTime: 0.09, launchRpm: 3800,
      gain: 0.56, color: '#c6ff1a',
    }),
    P({
      id: 'v12', name: 'V12 GT', sub: '6.5 L Sauger · seidig bis 8900', tag: 'V12 · Sauger',
      fire: even(12), banks: alt(12),
      hdr: [2.2, 2.25, 2.2, 2.3, 2.15, 2.25, 2.2, 2.3, 2.2, 2.25, 2.15, 2.3],
      attack: 0.06, pulseDeg: 110, noise: 0.2, rough: 0.03,
      colMs: [2.8, 3.0], tailMs: [5.0, 5.4], cross: 0.35,
      boom: { f: 100, q: 1, db: 2 }, rasp: { f: 3200, q: 1.1, db: 5 },
      lpBase: 2000, lpOpen: 8000, drive: 1.5, intakeHz: 700, intake: 0.6,
      crackle: 0.4, shiftPop: 0.4,
      idle: 1000, redline: 8900, limiter: 9100, revUp: 0.12, revDown: 0.45,
      gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], final: 3.6, tire: 0.70,
      shiftEco: 3000, shiftStyle: 'dct', shiftTime: 0.09, launchRpm: 3500,
      gain: 0.61, color: '#ffcf1f',
    }),
    P({
      id: 'boxer6', name: 'Boxer 6 GT3', sub: '4.0 L Sechszylinder-Boxer · 9000 U/min', tag: 'B6 · Sauger',
      fire: even(6), banks: alt(6), // 1-6-2-4-3-5
      hdr: [1.7, 1.75, 1.8, 1.7, 1.75, 1.8],
      attack: 0.055, pulseDeg: 115, noise: 0.25, rough: 0.04,
      colMs: [3.4, 3.6], tailMs: [5.2, 5.6], cross: 0.4,
      boom: { f: 120, q: 1, db: 2 }, rasp: { f: 2600, q: 1, db: 6 },
      lpBase: 1800, lpOpen: 7500, drive: 1.7, intakeHz: 650, intake: 0.9, mech: 0.12,
      crackle: 0.5, shiftPop: 0.4,
      idle: 950, redline: 9000, limiter: 9100, revUp: 0.11, revDown: 0.38,
      gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], final: 3.97, tire: 0.68,
      shiftEco: 3200, shiftStyle: 'dct', shiftTime: 0.08, launchRpm: 4000,
      gain: 0.63, color: '#3ad1ff',
    }),
    P({
      id: 'i6-turbo', name: 'Reihensechser Turbo', sub: '3.0 L JDM-Legende · Pfeifen & Blow-Off', tag: 'R6 · Turbo',
      fire: even(6), banks: alt(6), // 1-5-3-6-2-4, zwei 3-in-1-Krümmer
      hdr: [1.9, 2.0, 2.05, 1.95, 2.0, 1.9],
      attack: 0.07, pulseDeg: 135, noise: 0.25, rough: 0.04,
      colMs: [3.0, 3.1], tailMs: [7.0, 7.5], cross: 0.5,
      boom: { f: 90, q: 1, db: 4 }, rasp: { f: 1900, q: 1, db: 3 },
      lpBase: 1100, lpOpen: 4200, drive: 1.6, intakeHz: 450, intake: 0.45,
      turbo: { spool0: 2500, spool1: 4500, gain: 1, whistle: [2200, 7200], flutter: 0.1, bov: 1 },
      crackle: 0.45, shiftPop: 0.35,
      idle: 800, redline: 7000, limiter: 7200, revUp: 0.18, revDown: 0.5,
      gears: [3.83, 2.36, 1.69, 1.31, 1.00, 0.79], final: 3.27, tire: 0.67,
      shiftEco: 2500, shiftStyle: 'manual', shiftTime: 0.32, launchRpm: 2800,
      gain: 0.58, color: '#ff8a1f',
    }),
    P({
      id: 'boxer4', name: 'Boxer 4 Turbo', sub: '2.5 L Rallye-Grollen · ungleiche Krümmer', tag: 'B4 · Turbo',
      fire: [0, 0.25, 0.52, 0.77], banks: [0, 0, 0, 0], // 1-3-2-4, ungleich lange Krümmer
      hdr: [1.0, 1.1, 2.4, 2.5],
      attack: 0.08, pulseDeg: 150, noise: 0.3, rough: 0.06, lope: 0.1,
      colMs: [3.8], tailMs: [8.0, 8.6], cross: 0,
      boom: { f: 100, q: 1, db: 4 }, rasp: { f: 1500, q: 1, db: 3 },
      lpBase: 1000, lpOpen: 3800, drive: 1.8, intakeHz: 380, intake: 0.5,
      turbo: { spool0: 2800, spool1: 4200, gain: 1.1, whistle: [2000, 6500], flutter: 0.75, bov: 1 },
      crackle: 0.5, shiftPop: 0.4,
      idle: 850, redline: 6700, limiter: 6900, revUp: 0.17, revDown: 0.5,
      gears: [3.64, 2.38, 1.76, 1.35, 0.97, 0.76], final: 3.9, tire: 0.66,
      shiftEco: 2500, shiftStyle: 'manual', shiftTime: 0.35, launchRpm: 3500,
      gain: 0.41, color: '#2b7bff',
    }),
    P({
      id: 'i4-turbo', name: 'Hot Hatch R4', sub: '2.0 L Turbo · DSG mit Schaltknallen', tag: 'R4 · Turbo',
      fire: even(4), banks: [0, 0, 0, 0], // 1-3-4-2
      hdr: [1.5, 1.6, 1.55, 1.65],
      attack: 0.08, pulseDeg: 140, noise: 0.3, rough: 0.05,
      colMs: [3.5], tailMs: [6.5, 7.2], cross: 0,
      boom: { f: 95, q: 1, db: 4 }, rasp: { f: 1700, q: 1, db: 3 },
      lpBase: 1200, lpOpen: 4200, drive: 2.0, intakeHz: 480, intake: 0.4,
      turbo: { spool0: 2200, spool1: 3800, gain: 0.8, whistle: [2500, 8000], flutter: 0, bov: 0.6 },
      crackle: 0.9, shiftPop: 0.9,
      idle: 800, redline: 6800, limiter: 6900, revUp: 0.15, revDown: 0.45,
      gears: [3.56, 2.53, 1.68, 1.14, 0.89, 0.73, 0.61], final: 3.7, tire: 0.66,
      shiftEco: 2300, shiftStyle: 'dct', shiftTime: 0.12, launchRpm: 3200,
      gain: 0.41, color: '#ff3d7f',
    }),
    P({
      id: 'rotary', name: 'Wankel 2-Rotor', sub: '1.3 L Kreiskolben · Brap-Brap im Leerlauf', tag: 'Wankel',
      cycleRevs: 1, fire: [0, 0.5], banks: [0, 0], hdr: [1.2, 1.25],
      attack: 0.03, pulseDeg: 190, noise: 0.45, rough: 0.12, lope: 0.7, jitterMs: 0.4,
      colMs: [2.6], tailMs: [5.5, 6.0], cross: 0,
      boom: { f: 90, q: 1, db: 3 }, rasp: { f: 2200, q: 1.2, db: 6 },
      lpBase: 1500, lpOpen: 6500, drive: 2.2, intakeHz: 550, intake: 0.6,
      crackle: 1.0, shiftPop: 0.8,
      idle: 1100, redline: 9000, limiter: 9200, revUp: 0.1, revDown: 0.35,
      gears: [3.76, 2.27, 1.65, 1.19, 1.00, 0.84], final: 4.44, tire: 0.66,
      shiftEco: 3500, shiftStyle: 'manual', shiftTime: 0.3, launchRpm: 4000,
      gain: 0.39, color: '#ff9f1c',
    }),
    P({
      id: 'f1-v10', name: 'Formel 1 V10', sub: '3.0 L · 19.000 U/min · Ära 2004', tag: 'V10 · F1',
      fire: even(10), banks: alt(10), hdr: [1.0, 1.0, 1.02, 1.0, 1.01, 1.0, 1.02, 1.0, 1.01, 1.0],
      attack: 0.05, pulseDeg: 100, noise: 0.18, rough: 0.02,
      colMs: [1.6, 1.7], colRefl: -0.35, tailMs: [2.2, 2.4], tailRefl: -0.25, cross: 0.3,
      boom: { f: 150, q: 1, db: 1 }, rasp: { f: 3500, q: 1, db: 4 },
      lpBase: 4000, lpOpen: 12000, drive: 1.4, intakeHz: 900, intake: 0.5, mech: 0.1, mechHz: 4200,
      crackle: 0.3, shiftPop: 0.2,
      idle: 4200, redline: 18800, limiter: 19000, revUp: 0.06, revDown: 0.25,
      gears: [21.5, 17.8, 14.75, 12.2, 10.1, 8.38, 6.94], final: 1, tire: 0.66,
      shiftEco: 11000, shiftStyle: 'dct', shiftTime: 0.04, launchRpm: 10000, clutchV: 6,
      gain: 0.66, color: '#ff1e1e',
    }),
    P({
      id: 'hyper', name: 'Hyperdrive', sub: 'Sci-Fi-Elektro · Raumschiff-Antrieb', tag: 'Elektro',
      type: 'electric', idle: 300, redline: 18000, limiter: 18000, evK: 70,
      gears: [], fire: [], banks: [], hdr: [],
      gain: 0.51, color: '#9b5cff',
    }),
  ];

  G.SD_PROFILES = PROFILES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
