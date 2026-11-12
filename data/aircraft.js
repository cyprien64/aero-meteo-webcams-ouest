// Fiches avions reprises du log de navigation ACB (pilot_logs_nav_acb_a4, édition GF 11.02 / ACB 3.3).
// Bras de levier en m, masses en kg, carburant en litres. À vérifier avec le manuel de vol et la dernière pesée.
window.AIRCRAFT_TYPES = {
  'DR400-ROTAX': {
    label: 'DR400 Rotax 912iS',
    fuel: { name: 'SP98 / UL91 (0,72)', density: 0.72, tanks: [{ name: 'Réservoir principal', cap: 109, arm: 1.12 }] },
    mtow: 865,
    arms: { pilot: 0.41, copilot: 0.41, pax: 1.19, bag: 1.19 },
    envelope: [[0.205, 0], [0.205, 750], [0.428, 865], [0.564, 865], [0.564, 0]],
    regimes: [
      { name: 'Croisière éco (5000 t/mn)', tas: 95, ff: 14 },
      { name: 'Croisière normale (5200 t/mn)', tas: 100, ff: 15 },
      { name: 'Croisière rapide (5400 t/mn)', tas: 105, ff: 18 },
    ],
    defaultRegime: 1,
    climb: { extraMin: 2, extraFuel: 4 },   // règle du log : +2 min et +4 L sur la 1re branche
    taxiFuel: 0,
    speeds: { VSO: 45, VR: 55, Vx: '59/73', Vy: 70, 'V finesse max': 73, VFE: 92, VNO: 140, VNE: 166, 'Vapp (1,45) volets 1': 75, 'Vatt (1,30) volets 2': 60, 'Vw 90° max': 22 },
    takeoff: { hard: 760, grass: 870, note: 'Distance de décollage 15 m, std +15, à la masse max' },
    minPerLitre: 4,
  },
  'DR401-CDI': {
    label: 'DR401 / DR400-140B CDI 155',
    fuel: {
      name: 'Jet A1 (0,84)', density: 0.84,
      tanks: [{ name: 'Réservoir principal', cap: 109, arm: 1.12 }, { name: 'Réservoir supplémentaire', cap: 50, arm: 1.61 }],
    },
    mtow: 1100,
    arms: { pilot: 0.41, copilot: 0.41, pax: 1.19, bag: 1.9 },
    envelope: [[0.257, 0], [0.257, 820], [0.462, 1100], [0.564, 1100], [0.564, 0]],
    regimes: [
      { name: 'Attente (50 %)', tas: 85, ff: 22 },
      { name: 'FL 60 - 72 %', tas: 115, ff: 24 },
      { name: 'Croisière normale (72 %)', tas: 120, ff: 24 },
      { name: 'FL 80 - 85 %', tas: 126, ff: 28 },
      { name: 'FL 100 - 72 %', tas: 118, ff: 23 },
    ],
    defaultRegime: 2,
    climb: { extraMin: 2, extraFuel: 4 },
    taxiFuel: 0,
    speeds: { VSO: 49, VR: 60, Vx: 68, Vy: 78, 'V finesse max': 78, VFE: 92, VNO: 140, VNE: 146, 'Vapp (1,45) volets 10°': 85, 'Vatt (1,30) volets 30°': 65, 'Vw 90° max': 22 },
    takeoff: { hard: 545, grass: 630, note: 'Distance de décollage 15 m, std +15, Zp 0, à la masse max' },
    minPerLitre: 2.5,
  },
};

window.AIRCRAFT = [
  { reg: 'F-HAFF', type: 'DR400-ROTAX', empty: 543, arm: 0.409 },
  { reg: 'F-HPYR', type: 'DR400-ROTAX', empty: 541, arm: 0.393 },
  { reg: 'F-GLDS', type: 'DR400-ROTAX', empty: 530, arm: 0.402, bagArm: 1.1 },
  { reg: 'F-GKQR', type: 'DR400-ROTAX', empty: 552, arm: 0.408 },
  { reg: 'F-HCOY', type: 'DR401-CDI', empty: 701, arm: 0.338 },
  { reg: 'F-HNDI', type: 'DR401-CDI', empty: 684, arm: 0.291 },
];
