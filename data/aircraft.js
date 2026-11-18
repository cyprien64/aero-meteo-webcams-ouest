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
    sheet: 'F-HAFF',
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
    sheet: 'F-HNDI',
  },
  'DR400-120': {
    label: 'DR400/120 2+2',
    fuel: { name: 'AVGAS 100LL (0,72)', density: 0.72, tanks: [{ name: 'Réservoir principal', cap: 109, arm: 1.12 }] },
    mtow: 900,
    arms: { pilot: 0.41, copilot: 0.41, pax: 1.19, bag: 1.9 },
    envelope: [[0.205, 0], [0.205, 750], [0.428, 900], [0.564, 900], [0.564, 0]],
    regimes: [{ name: 'Croisière éco (2500 t/mn)', tas: 100, ff: 24 }],
    defaultRegime: 0,
    climb: { extraMin: 2, extraFuel: 4 },
    speeds: { VSO: 45, VR: 55, Vx: '59/73', Vy: 70, 'V finesse max': 73, VFE: 92, VNO: 140, VNE: 166, 'Vapp (1,45) volets 1': 75, 'Vatt (1,30) volets 2': 60, 'Vw 90° max': 22 },
    takeoff: { hard: 760, grass: 870, note: 'Distance de décollage 15 m, std +15, à la masse max (feuille F-XXXX du log ACB)' },
    minPerLitre: 2.5,
    sheet: 'F-XXXX',
    source: 'Feuille DR400/120 (F-XXXX) du log ACB',
  },
  // ---- Avions ajoutés d'après des sources publiques : À VÉRIFIER avec le manuel de vol de l'avion ----
  'JODEL-D112': {
    label: 'Jodel D112',
    fuel: { name: 'AVGAS 100LL (0,72)', density: 0.72, tanks: [{ name: 'Réservoir', cap: 60, arm: null }] },
    mtow: 530,
    arms: { pilot: null, copilot: null, pax: null, bag: null },
    cgLimits: [0.27, 0.54],
    envelope: [[0.27, 0], [0.27, 530], [0.54, 530], [0.54, 0], [0.27, 0]],
    regimes: [
      { name: 'Croisière éco (1800 t/mn)', tas: 70, ff: 13 },
      { name: 'Croisière normale (2000 t/mn)', tas: 81, ff: 15 },
    ],
    defaultRegime: 1,
    climb: { extraMin: 2, extraFuel: 2 },
    speeds: { VSO: 30, 'V finesse max': 54, 'Vapp': 49, VNO: 108, VNE: 132 },
    takeoff: null,
    minPerLitre: 4,
    sheet: 'F-XXXX',
    source: 'Manuels d\'utilisation D112 (aéroclubs de Montluçon / ACB-JMG 2011), fiches FANA Air Rétro et Châteaudun',
  },
  'GROB-G120A': {
    label: 'Grob G120A',
    fuel: { name: 'AVGAS 100LL (0,72)', density: 0.72, tanks: [{ name: 'Réservoirs (utilisable)', cap: 252, arm: null }] },
    mtow: 1490,
    arms: { pilot: null, copilot: null, pax: null, bag: null },
    envelope: null,
    regimes: [
      { name: 'Croisière 65 % (estimation)', tas: 150, ff: 45 },
      { name: 'Croisière 75 % (5000 ft)', tas: 166, ff: 55 },
    ],
    defaultRegime: 0,
    climb: { extraMin: 2, extraFuel: 6 },
    speeds: { VSO: 55, VNE: 235 },
    takeoff: null,
    minPerLitre: 1.2,
    sheet: 'F-XXXX',
    source: 'Manuel de vol Grob G120A (extraits publics), Wikipedia, Learn ATC — consommations estimées (plage 34-83 L/h du manuel)',
  },
  // ---- Robin R3000/180 : manuel de vol (édition 1, janvier 1998, révision 1 de décembre 1999) ----
  'R3000-180': {
    label: 'Robin R3000/180',
    // Avion du club : 2 réservoirs d'aile de 80 L (le manuel indique 2 x 113 L) ; même bras de levier, donc comptés ensemble
    fuel: { name: 'AVGAS 100LL (0,72)', density: 0.72, tanks: [{ name: 'Réservoirs d\'aile G + D (2 x 80 L)', cap: 160, arm: 0.25 }] },
    mtow: 1150,   // catégorie N (catégorie U : 1000 kg)
    arms: { pilot: 0.55, copilot: 0.55, pax: 1.33, bag: 1.9 },   // sièges AV réglables : 0,50 à 0,60 m
    envelope: [[0.29, 0], [0.29, 825], [0.403, 1150], [0.548, 1150], [0.548, 0]],
    regimes: [
      { name: '2000 ft - 2400 t/mn', tas: 114, ff: 34 },
      { name: '2000 ft - 2500 t/mn', tas: 121, ff: 38 },
      { name: '5500 ft - 2500 t/mn', tas: 122, ff: 36 },
      { name: '5500 ft - 2600 t/mn', tas: 130, ff: 38 },
      { name: '8500 ft - 2500 t/mn', tas: 122, ff: 33 },
      { name: '8500 ft - 2700 t/mn', tas: 138, ff: 38 },
    ],
    defaultRegime: 1,
    // table : montée du manuel (§5.06), [altitude ft, temps min, carburant L (mise en route et roulage compris), distance NM]
    climb: { extraMin: 2, extraFuel: 4, table: [[0, 0, 0, 0], [3000, 3.5, 4, 5.2], [5500, 7, 7, 10], [8500, 12.5, 13, 18], [11500, 21, 20, 28]] },
    speeds: { VSO: 49, VS1: 57, VR: 59, 'V passage 15 m': 70, Vx: '67/78', Vy: '78/92', 'V finesse max': 86, VA: 115, VFE: 94, VNO: 134, VNE: 170,
      Vapp: 65, 'Vapp courte': 62, 'Vw 90° max': 22 },
    // table : tableaux du manuel (§5) — rows[altitude ft] = [température °C, distance 15 m à m[0] kg, à m[1] kg] ;
    // wind = coefficient selon le vent de face (kt), tail = +x par kt de vent arrière, grass = coefficient herbe sèche
    takeoff: { hard: 565, grass: 650, note: 'Décollage (passage 15 m), Zp 0, std +15, 1150 kg, volets décollage',
      table: { m: [1150, 950], grass: 1.15, tail: 0.05, wind: [[0, 1], [10, 0.8], [20, 0.65], [30, 0.55]],
        rows: { 0: [[-5, 485, 400], [15, 565, 465], [35, 645, 535]], 4000: [[-13, 730, 605], [7, 810, 670], [27, 935, 770]], 8000: [[-21, 995, 820], [-1, 1155, 955], [19, 1345, 1110]] } } },
    landing: { hard: 530, grass: 742, note: 'Atterrissage (depuis 15 m), Zp 0, std +15, 1150 kg, volets atterrissage',
      table: { m: [1150, 900], grass: 1.4, tail: 0.05, wind: [[0, 1], [10, 0.8], [20, 0.65], [30, 0.55]],
        rows: { 0: [[-5, 510, 420], [15, 530, 440], [35, 545, 450]], 4000: [[-13, 555, 460], [7, 585, 485], [27, 610, 505]], 8000: [[-21, 630, 520], [-1, 665, 550], [19, 705, 580]] } } },
    minPerLitre: 1.6,
    sheet: 'F-XXXX',
    source: 'Manuel de vol R3000/180 (édition 1, janvier 1998) - réservoirs 2 x 80 L selon le club',
  },

};

window.AIRCRAFT = [
  { reg: 'F-HAFF', type: 'DR400-ROTAX', empty: 543, arm: 0.409 },
  { reg: 'F-HPYR', type: 'DR400-ROTAX', empty: 541, arm: 0.393 },
  { reg: 'F-GLDS', type: 'DR400-ROTAX', empty: 530, arm: 0.402, bagArm: 1.1 },
  { reg: 'F-GKQR', type: 'DR400-ROTAX', empty: 552, arm: 0.408 },
  { reg: 'F-HCOY', type: 'DR401-CDI', empty: 701, arm: 0.338 },
  { reg: 'F-HNDI', type: 'DR401-CDI', empty: 684, arm: 0.291 },
  { reg: 'F-GSUR', type: 'DR400-120', empty: 582, arm: 0.358 },
  { reg: 'F-PKFC', type: 'JODEL-D112', empty: 300, arm: null, note: 'masse à vide à vérifier (pesée)' },
  { reg: 'D-EPDH', type: 'GROB-G120A', empty: 1050, arm: null, note: 'masse à vide à vérifier (pesée)' },
  { reg: 'F-HMRA', type: 'R3000-180', empty: 650, arm: null, note: 'masse à vide à vérifier (pesée)' },
];
