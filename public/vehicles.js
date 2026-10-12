// Enthusiast vehicle catalog shared by the browser (autocomplete, "did you mean") and the server
// (saving makes under one standard spelling). Plain data and functions only, so it runs in both.
//
// MAKES: standard name → other ways people write it. Anything not listed can still be typed in.

export const MAKES = {
  Abarth: [],
  AC: ['ac cars'],
  Acura: [],
  'Alfa Romeo': ['alfa', 'alpha romeo'],
  Alpina: ['bmw alpina'],
  Alpine: [],
  AMC: ['american motors'],
  Ascari: [],
  'Aston Martin': ['aston', 'astonmartin'],
  Audi: ['audi sport'],
  Austin: [],
  'Austin-Healey': ['austin healey', 'healey'],
  Bentley: [],
  Bizzarrini: [],
  BMW: ['bmw m', 'beemer', 'bimmer'],
  Brabham: [],
  Brabus: [],
  Bristol: [],
  Bugatti: [],
  Buick: [],
  Cadillac: ['caddy', 'caddi'],
  Callaway: [],
  Caterham: [],
  Chevrolet: ['chevy', 'chev'],
  Chrysler: [],
  'Citroën': ['citroen'],
  Cizeta: ['cizeta-moroder'],
  Cord: [],
  Czinger: [],
  Daimler: [],
  Datsun: [],
  'De Tomaso': ['detomaso'],
  DeLorean: ['dmc', 'delorean motor company'],
  Dodge: [],
  Donkervoort: [],
  Duesenberg: [],
  'Facel Vega': [],
  Ferrari: [],
  Fiat: [],
  Fisker: [],
  Ford: [],
  Genesis: [],
  Ginetta: [],
  GMC: [],
  'Gordon Murray': ['gma', 'gordon murray automotive'],
  Hennessey: [],
  'Hispano-Suiza': ['hispano suiza'],
  Holden: ['hsv'],
  Honda: [],
  Hummer: [],
  Hyundai: [],
  Infiniti: [],
  Iso: ['iso rivolta'],
  Isuzu: [],
  Jaguar: ['jag'],
  Jensen: ['jensen healey'],
  Jeep: [],
  Kia: [],
  Lada: [],
  Koenigsegg: [],
  KTM: [],
  Lagonda: [],
  Lamborghini: ['lambo'],
  Lancia: [],
  'Land Rover': ['landrover', 'range rover'],
  Lexus: [],
  Lincoln: [],
  Lister: [],
  Lotus: [],
  Lucid: [],
  Marcos: [],
  Maserati: [],
  Matra: [],
  Maybach: ['mercedes-maybach'],
  Mazda: [],
  McLaren: ['mclaren automotive'],
  'Mercedes-AMG': ['amg', 'mercedes amg'],
  'Mercedes-Benz': ['mercedes', 'merc', 'benz', 'mb', 'mercedes benz', 'mercedez', 'mercedez benz'],
  Mercury: [],
  MG: [],
  Mini: ['mini cooper'],
  Mitsubishi: [],
  Morgan: [],
  Mosler: [],
  Nissan: [],
  Noble: [],
  NSU: [],
  Oldsmobile: ['olds'],
  Opel: [],
  Packard: [],
  Pagani: [],
  Panoz: [],
  Peugeot: [],
  Plymouth: [],
  Polestar: [],
  Pontiac: [],
  Porsche: [],
  Radical: [],
  Ram: [],
  Renault: [],
  Rimac: [],
  Rivian: [],
  'Rolls-Royce': ['rolls royce', 'rolls'],
  Rover: [],
  RUF: ['ruf automobile'],
  Saab: [],
  Saleen: [],
  Scion: [],
  Shelby: ['shelby american'],
  Singer: ['singer vehicle design'],
  Spyker: [],
  SSC: [],
  Studebaker: [],
  Subaru: [],
  Sunbeam: [],
  Suzuki: [],
  'Talbot-Lago': ['talbot lago'],
  Tesla: [],
  Toyota: [],
  Triumph: [],
  Tucker: [],
  TVR: [],
  Ultima: [],
  Vauxhall: [],
  Vector: [],
  Venturi: [],
  Volkswagen: ['vw', 'volkswagon', 'volks wagen'],
  Volvo: [],
  Wiesmann: [],
  Willys: ['willys-overland'],
  Zagato: [],
  Zenvo: [],
};

// Model suggestions for popular enthusiast makes. Suggestions only: any model can be typed.
export const MODELS = {
  'Alfa Romeo': ['4C', '8C Competizione', 'Giulia', 'Giulia GTA', 'Giulia Quadrifoglio', 'GTV', 'Montreal', 'Spider', 'SZ'],
  Alpina: ['B3', 'B5', 'B6', 'B7', 'B8', 'D3', 'Roadster V8', 'XB7'],
  Alpine: ['A110', 'A310'],
  'Aston Martin': ['DB4', 'DB5', 'DB6', 'DB7', 'DB9', 'DB11', 'DB12', 'DBS', 'DBX', 'Lagonda', 'One-77', 'V12 Vantage', 'V8 Vantage', 'Valkyrie', 'Vanquish', 'Vantage', 'Virage'],
  Audi: ['e-tron GT', 'Quattro', 'R8', 'RS2 Avant', 'RS3', 'RS4', 'RS5', 'RS6', 'RS7', 'RS Q8', 'S4', 'Sport Quattro', 'TT RS'],
  Bentley: ['Arnage', 'Bentayga', 'Continental GT', 'Continental R', 'Flying Spur', 'Mulsanne', 'Turbo R'],
  BMW: ['1M Coupe', '2002', '3.0 CSL', '507', '850CSi', 'i8', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M635CSi', 'M8', 'Z1', 'Z3', 'Z3 M', 'Z4', 'Z4 M', 'Z8'],
  Bugatti: ['Bolide', 'Chiron', 'Divo', 'EB110', 'Type 35', 'Veyron'],
  Buick: ['GNX', 'Grand National', 'Riviera'],
  Cadillac: ['CTS-V', 'DeVille', 'Eldorado', 'Escalade'],
  Chevrolet: ['Bel Air', 'Blazer', 'C10', 'Camaro', 'Chevelle', 'Corvette', 'El Camino', 'Impala', 'Nova'],
  Datsun: ['1600 Roadster', '240Z', '260Z', '280Z', '510'],
  'De Tomaso': ['Guarà', 'Mangusta', 'P72', 'Pantera'],
  Dodge: ['Challenger', 'Challenger SRT Demon', 'Charger', 'Dart', 'Super Bee', 'Viper'],
  Ferrari: ['250 GT', '250 GTO', '275 GTB', '288 GTO', '296 GTB', '308', '328', '348', '360', '360 Challenge Stradale', '430 Scuderia', '458 Italia', '458 Speciale', '488 GTB', '488 Pista', '512 BB', '512 TR', '550 Maranello', '575M', '599 GTB', '599 GTO', '612 Scaglietti', '812 Competizione', '812 Superfast', 'California', 'Daytona SP3', 'Dino 246 GT', 'Enzo', 'F12berlinetta', 'F355', 'F40', 'F430', 'F50', 'F8 Tributo', 'FF', 'GTC4Lusso', 'LaFerrari', 'Portofino', 'Purosangue', 'Roma', 'SF90 Stradale', 'Testarossa'],
  Ford: ['Bronco', 'Escort RS Cosworth', 'F-150 Raptor', 'Focus RS', 'GT', 'GT40', 'Model A', 'Mustang', 'RS200', 'Sierra RS Cosworth', 'Thunderbird'],
  Honda: ['Beat', 'Civic Type R', 'CR-X', 'Integra Type R', 'NSX', 'Prelude', 'S2000', 'S600', 'S800'],
  Acura: ['Integra', 'Integra Type R', 'NSX', 'RSX Type-S'],
  Jaguar: ['E-Type', 'F-Type', 'Mark 2', 'XJ', 'XJ220', 'XJS', 'XK120', 'XK140', 'XK150', 'XKR'],
  Jeep: ['Cherokee', 'CJ-5', 'CJ-7', 'Gladiator', 'Grand Wagoneer', 'Wrangler'],
  Koenigsegg: ['Agera', 'CCX', 'Gemera', 'Jesko', 'One:1', 'Regera'],
  Lamborghini: ['Aventador', 'Countach', 'Diablo', 'Espada', 'Gallardo', 'Huracán', 'Jalpa', 'LM002', 'Miura', 'Murciélago', 'Revuelto', 'Sián', 'Urus'],
  Lancia: ['037', 'Aurelia', 'Delta Integrale', 'Fulvia', 'Stratos'],
  'Land Rover': ['Defender', 'Discovery', 'Range Rover', 'Series I', 'Series II', 'Series III'],
  Lexus: ['GS F', 'GX', 'IS F', 'LC 500', 'LFA', 'LX', 'RC F', 'SC300', 'SC400'],
  Lotus: ['Elan', 'Elise', 'Emira', 'Esprit', 'Europa', 'Evija', 'Evora', 'Exige', 'Seven'],
  Maserati: ['3200 GT', 'Bora', 'Ghibli', 'GranTurismo', 'MC12', 'MC20', 'Merak', 'Quattroporte'],
  Mazda: ['Cosmo', 'MX-5 Miata', 'RX-3', 'RX-7', 'RX-8'],
  McLaren: ['12C', '570S', '600LT', '650S', '675LT', '720S', '750S', '765LT', 'Artura', 'Elva', 'F1', 'GT', 'P1', 'Senna', 'Speedtail'],
  'Mercedes-AMG': ['C63', 'E63', 'G63', 'GT', 'GT Black Series', 'GT R', 'One', 'SLS'],
  'Mercedes-Benz': ['190E 2.3-16', '190E 2.5-16 Evolution', '230SL', '250SL', '280SL', '300SL', '500E', 'C63 AMG', 'CLK 63 Black Series', 'CLK GTR', 'E63 AMG', 'G-Class', 'S-Class', 'SL', 'SLK', 'SLR McLaren', 'SLS AMG'],
  Mini: ['Cooper S', 'GP', 'John Cooper Works'],
  Mitsubishi: ['3000GT VR-4', 'GTO', 'Lancer Evolution', 'Pajero', 'Starion'],
  Morgan: ['3 Wheeler', 'Aero 8', 'Plus 4', 'Plus 8', 'Plus Six'],
  Nissan: ['240SX', '300ZX', '350Z', '370Z', 'Fairlady Z', 'GT-R', 'Patrol', 'Silvia', 'Skyline GT-R', 'Z'],
  Noble: ['M12', 'M400', 'M600'],
  Pagani: ['Huayra', 'Utopia', 'Zonda'],
  Plymouth: ['Barracuda', 'Cuda', 'GTX', 'Road Runner', 'Superbird'],
  Pontiac: ['Fiero', 'Firebird', 'GTO', 'Trans Am'],
  Porsche: ['356', '550 Spyder', '911', '912', '914', '918 Spyder', '924', '928', '930', '944', '959', '964', '968', '991', '992', '993', '996', '997', 'Boxster', 'Carrera GT', 'Cayenne', 'Cayman', 'Macan', 'Panamera', 'Taycan'],
  'Rolls-Royce': ['Corniche', 'Cullinan', 'Dawn', 'Ghost', 'Phantom', 'Silver Cloud', 'Silver Shadow', 'Spectre', 'Wraith'],
  RUF: ['BTR', 'CTR', 'CTR Yellowbird', 'CTR2', 'Rodeo', 'RT 12', 'SCR'],
  Shelby: ['Cobra', 'Daytona Coupe', 'GT350', 'GT500'],
  Singer: ['Classic', 'DLS', 'Turbo Study'],
  Subaru: ['22B', 'BRZ', 'Impreza WRX STI', 'Legacy', 'SVX', 'WRX'],
  Toyota: ['2000GT', 'AE86', 'Celica', 'Century', 'GR Corolla', 'GR Supra', 'GR Yaris', 'GR86', 'Land Cruiser', 'MR2', 'Supra'],
  TVR: ['Cerbera', 'Chimaera', 'Griffith', 'Sagaris', 'Tuscan'],
  Volkswagen: ['Beetle', 'Corrado', 'Golf GTI', 'Golf R', 'Golf R32', 'Karmann Ghia', 'Phaeton', 'Scirocco', 'Type 2'],
};

export const MAKE_NAMES = Object.keys(MAKES).sort((a, b) => a.localeCompare(b));

// "Mercedes Benz", "mercedes-benz" and "MercedesBenz" all compare the same.
const key = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const LOOKUP = new Map();
for (const [make, aliases] of Object.entries(MAKES)) {
  LOOKUP.set(key(make), make);
  for (const alias of aliases) LOOKUP.set(key(alias), make);
}

// The standard spelling of a make if we recognise it (including common alternatives), else null.
export function normalizeMake(text) {
  return LOOKUP.get(key(text)) ?? null;
}

// Edit distance that also counts swapped neighbours ("Porhse") as one typo.
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// For an unrecognised make, the closest known one if it's plausibly a typo ("Porshe" → "Porsche").
export function suggestMake(text) {
  const typed = key(text);
  if (typed.length < 3 || LOOKUP.has(typed)) return null;
  const allowed = typed.length <= 4 ? 1 : typed.length <= 8 ? 2 : 3;
  let best = null;
  let bestScore = Infinity;
  for (const [candidate, make] of LOOKUP) {
    if (Math.abs(candidate.length - typed.length) > allowed) continue;
    const score = distance(typed, candidate);
    if (score <= allowed && score < bestScore) {
      best = make;
      bestScore = score;
    }
  }
  return best;
}

// Autocomplete: makes (or their alternatives, e.g. "vw") starting with what's typed, then makes whose
// own name contains it (e.g. "rover" → Land Rover).
export function matchMakes(text, limit = 8) {
  const typed = key(text);
  if (!typed) return MAKE_NAMES.slice(0, limit);
  const starts = new Set();
  for (const [candidate, make] of LOOKUP) if (candidate.startsWith(typed)) starts.add(make);
  const contains = typed.length >= 3 ? MAKE_NAMES.filter((m) => !starts.has(m) && key(m).includes(typed)) : [];
  return [...[...starts].sort((a, b) => a.localeCompare(b)), ...contains].slice(0, limit);
}

export function matchModels(make, text, limit = 8) {
  const models = MODELS[normalizeMake(make) ?? make] ?? [];
  const typed = key(text);
  if (!typed) return models.slice(0, limit);
  const starts = models.filter((m) => key(m).startsWith(typed));
  const contains = models.filter((m) => !starts.includes(m) && key(m).includes(typed));
  return [...starts, ...contains].slice(0, limit);
}
