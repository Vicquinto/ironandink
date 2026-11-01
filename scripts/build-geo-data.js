#!/usr/bin/env node
// ─── Build geo/ for the tooltip maps (ancient places + Roman roads) ──────────
// Downloads the trusted sources and writes slim files to geo/ (top level — NOT
// data/, which is member data and backed up nightly):
//
//   geo/places.json   Pleiades places that have a location: id, title, names
//                     (title variants, romanized ancient names, English names,
//                     plus the curated biblical/English names below), lat, lon,
//                     place types, and a short region/description used to
//                     disambiguate "{{place:Antioch, Pisidia}}". Also a
//                     `primary` table: curated names that settle a name the
//                     reader would read one way ("Berea" → the Macedonian city).
//   geo/roads.json    Itiner-e road segments grouped by road name, geometry
//                     reprojected to lat/lon and simplified for zoom 5–9, with
//                     each segment's certainty (Certain/Conjectured/Hypothetical).
//   geo/SOURCES.md    Sources, versions, licenses, required attribution.
//
// Re-runnable any time to refresh (Pleiades updates daily; the Itiner-e release
// is a fixed Zenodo version). Node built-ins only — no npm install needed.
//
//   node scripts/build-geo-data.js            # download fresh, build geo/
//   node scripts/build-geo-data.js --cached   # reuse the downloads from a previous run
//
// Downloads (~90 MB) go to <os tmpdir>/iron-ink-geo-build and are left there for
// --cached; delete that folder to reclaim the space. Read by lib/geo.js.

const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const https = require('https');
const zlib  = require('zlib');
const { spawnSync } = require('child_process');

// The Itiner-e GeoJSON is ~78 MB; parsing it wants more heap than some default
// Node limits allow. Re-run self once with a larger heap.
if (!process.env.GEO_BUILD_CHILD) {
  const r = spawnSync(process.execPath,
    ['--max-old-space-size=4096', __filename].concat(process.argv.slice(2)),
    { stdio: 'inherit', env: Object.assign({}, process.env, { GEO_BUILD_CHILD: '1' }) });
  process.exit(r.status == null ? 1 : r.status);
}

const { normName, normRoad } = require(path.join(__dirname, '../lib/geo'));

const args    = process.argv.slice(2);
const cached  = args.includes('--cached');
const OUT_DIR = path.join(__dirname, '..', 'geo');
const DL_DIR  = path.join(os.tmpdir(), 'iron-ink-geo-build');

const SOURCES = {
  pleiadesPlaces: 'https://atlantides.org/downloads/pleiades/dumps/pleiades-places-latest.csv.gz',
  pleiadesNames:  'https://atlantides.org/downloads/pleiades/dumps/pleiades-names-latest.csv.gz',
  itinereRecord:  'https://zenodo.org/api/records/17122148',
  itinereFile:    'itinere_roads.geojson',
};

// ── Curated biblical / English names ──────────────────────────────────────────
// [Pleiades id, text the Pleiades title must contain (checked at build), region
// used for ", Region" hints, names]. Every id here was looked up in the Pleiades
// data and checked by its title, description and location. A name listed for
// exactly one entry becomes a `primary` (the reading a Bible reader means);
// a name listed for two entries (Antioch, Samaria, Apollonia) stays ambiguous and
// resolves only with a region hint. NO_PRIMARY lists single-entry names that are
// still too ambiguous to settle without a hint.
const CURATED = [
  // Judea, Samaria, Galilee and around
  [687928, 'Ierusalem', 'Judea', ['Jerusalem', 'Aelia Capitolina']],
  [687856, 'Bethlehem', 'Judea', ['Bethlehem']],
  [156668177, 'Bethania', 'Judea, Mount of Olives', ['Bethany']],
  [687917, 'Jericho', 'Judea, Jordan valley', ['Jericho']],
  [687915, 'Hebron', 'Judea', ['Hebron']],
  [687846, 'Beer Sheva/Berosaba', 'Negev, southern Judah', ['Beersheba', 'Beer-sheba', 'Beer Sheba', 'Beer Sheva']],
  [687868, 'Cadesh Barnea', 'Negev, wilderness of Zin (Kadesh-barnea)', ['Kadesh-barnea', 'Kadesh Barnea', 'Cadesh Barnea', 'Kadesh']],
  [697709, 'Mortuum Mare', 'Judea, Jordan valley', ['Dead Sea', 'Salt Sea']],
  [687934, 'Iudaea (region)', 'Judea', ['Judea', 'Judaea']],
  [687927, 'Idumaea', 'Idumea, Edom', ['Idumea', 'Idumaea', 'Edom']],
  [697724, 'Peraea', 'Perea, east of the Jordan', ['Perea', 'Peraea']],
  [678370, 'Samaria/Sebaste', 'Samaria, the city (Sebaste)', ['Samaria', 'Sebaste']],
  [678369, 'Samaria (region)', 'Samaria, the region between Judea and Galilee', ['Samaria']],
  [678145, 'Galilaea', 'Galilee', ['Galilee']],
  [678299, 'Nazareth', 'Galilee', ['Nazareth']],
  [678231, 'Kapharnaoum', 'Galilee, Sea of Galilee', ['Capernaum', 'Capharnaum']],
  [678065, 'Bethsaida', 'Galilee, Sea of Galilee', ['Bethsaida']],
  [678091, 'Chorazin', 'Galilee', ['Chorazin', 'Korazin']],
  [678272, 'Magdala', 'Galilee, Sea of Galilee', ['Magdala']],
  [678431, 'Tiberias', 'Galilee, Sea of Galilee', ['Tiberias']],
  [678430, 'Tiberiadis Mare', 'Galilee', ['Sea of Galilee', 'Sea of Tiberias', 'Lake of Gennesaret']],
  [687932, 'Iordanes', 'Judea, Galilee, Jordan valley', ['Jordan', 'Jordan River', 'River Jordan']],
  [678142, 'Gadara/Pompeia', 'Decapolis', ['Gadara']],
  [678158, 'Gerasa', 'Decapolis', ['Gerasa']],
  [678401, 'Caesarea', 'Judea, Mediterranean coast (Caesarea Maritima)', ['Caesarea', 'Caesarea Maritima']],
  [678324, 'Caesarea Philippi', 'Gaulanitis, foot of Mount Hermon', ['Caesarea Philippi', 'Paneas']],
  [687931, 'Ioppe', 'Judea, Mediterranean coast', ['Joppa']],
  [687953, 'Lydda', 'Judea', ['Lydda']],
  [687902, 'Gaza', 'Philistia, Mediterranean coast', ['Gaza']],
  [687838, 'Ashdod', 'Philistia', ['Ashdod']],
  [687888, 'Ekron', 'Philistia', ['Ekron']],
  [687951, 'Lachish', 'Judah', ['Lachish']],
  [779967430, 'Tel Hazor', 'Galilee', ['Hazor']],
  [678109, 'Dan', 'Upper Galilee', ['Dan']],
  [678084, 'Carmel', 'Mediterranean coast', ['Mount Carmel', 'Carmel']],
  [678181, 'Hermon', 'north of Galilee', ['Mount Hermon', 'Hermon']],
  [678437, 'Tyrus', 'Phoenicia', ['Tyre']],
  [678393, 'Sidon', 'Phoenicia', ['Sidon']],
  [678010, 'Ake/Ptolemais', 'Phoenicia, Galilee coast', ['Ptolemais', 'Acco', 'Akko']],
  [678334, 'Phoenice', 'Phoenicia', ['Phoenicia']],
  // Transjordan, Syria, Arabia
  [697654, 'Dibon', 'Moab', ['Dibon']],
  [857932176, 'Moab', 'east of the Dead Sea', ['Moab']],
  [697728, 'Amman/Philadelpheia', 'Ammon', ['Rabbah', 'Rabbath Ammon']],
  [678073, 'Bostra', 'Arabia, Hauran', ['Bostra']],
  [697725, 'Petra', 'Nabataea, Arabia', ['Petra']],
  [678106, 'Damascus', 'Syria', ['Damascus']],
  [981550, 'Syria (Roman', 'Syria', ['Syria']],
  [658483, 'Seleukeia Pieria', 'Syria, port of Antioch', ['Seleucia', 'Seleucia Pieria']],
  [658381, 'Antiochia/Theoupolis', 'Syria, on the Orontes', ['Antioch', 'Syrian Antioch', 'Antioch of Syria', 'Antioch in Syria', 'Antioch on the Orontes']],
  [29475, 'Arabia (region)', 'Arabia', ['Arabia']],
  // Mesopotamia, Persia
  [658427, 'Harran', 'Mesopotamia', ['Haran', 'Harran', 'Carrhae']],
  [874621, 'Nineveh', 'Assyria, on the Tigris', ['Nineveh']],
  [29492, 'Assyria', 'Mesopotamia', ['Assyria']],
  [893951, 'Babylon', 'Mesopotamia, on the Euphrates', ['Babylon']],
  [912816, 'Babylonia', 'Mesopotamia', ['Babylonia']],
  [912985, 'Ur(i)', 'Sumer, Chaldea, Mesopotamia', ['Ur', 'Ur of the Chaldees', 'Ur of the Chaldeans']],
  [874602, 'Mesopotamia', 'Mesopotamia', ['Mesopotamia']],
  [912849, 'Euphrates', 'Mesopotamia', ['Euphrates', 'Euphrates River']],
  [912964, 'Tigris', 'Mesopotamia', ['Tigris', 'Tigris River']],
  [912936, 'Susa', 'Elam, Persia', ['Susa', 'Shushan']],
  [903021, 'Ecbatana', 'Media', ['Ecbatana']],
  [922695, 'Persepolis', 'Persia', ['Persepolis']],
  [903080, 'Media', 'Iran', ['Media']],
  [912842, 'Elam', 'Iran', ['Elam']],
  [590282460, 'Parthian empire', 'Iran', ['Parthia']],
  // Egypt, Africa
  [766, 'Aegyptus', 'Egypt', ['Egypt']],
  [727172, 'Nilus', 'Egypt', ['Nile', 'Nile River']],
  [736963, 'Memphis', 'Egypt', ['Memphis']],
  [727070, 'Alexandria', 'Egypt, Nile Delta', ['Alexandria']],
  [727080, 'Avaris/Ramesses', 'Egypt, Nile Delta', ['Rameses', 'Raamses', 'Avaris']],
  [39290, 'Rubrum Mare', 'Red Sea', ['Red Sea']],
  [373778, 'Cyrene', 'Libya, Cyrenaica', ['Cyrene']],
  // Asia Minor
  [648789, 'Tarsus', 'Cilicia', ['Tarsus']],
  [609307, 'Antiochia', 'Pisidia, Roman Galatia', ['Antioch', 'Pisidian Antioch', 'Antioch of Pisidia', 'Antioch in Pisidia']],
  [648647, 'Iconium', 'Lycaonia, Roman Galatia', ['Iconium']],
  [648699, 'Lystra', 'Lycaonia, Roman Galatia', ['Lystra']],
  [648620, 'Derbe/Claudioderbe', 'Lycaonia, Roman Galatia', ['Derbe']],
  [639048, 'Perge', 'Pamphylia', ['Perga', 'Perge']],
  [638778, 'Attalea', 'Pamphylia', ['Attalia', 'Attaleia', 'Attalea']],
  [599612, 'Ephesus', 'Asia, Ionia', ['Ephesus']],
  [599799, 'Miletus', 'Asia, Ionia, Caria', ['Miletus', 'Miletum']],
  [550893, 'Smyrna/Eurydikeia', 'Asia, Ionia', ['Smyrna']],
  [550812, 'Pergamum', 'Asia, Mysia', ['Pergamum', 'Pergamon', 'Pergamos']],
  [550924, 'Thyateira', 'Asia, Lydia', ['Thyatira', 'Thyateira']],
  [550867, 'Sardis', 'Asia, Lydia', ['Sardis']],
  [550822, 'Philadelpheia', 'Asia, Lydia', ['Philadelphia']],
  [638955, 'Laodicea ad Lycum', 'Asia, Phrygia, Lycus valley', ['Laodicea', 'Laodicea on the Lycus']],
  [638860, 'Hierapolis/Pamukkale', 'Asia, Phrygia, Lycus valley', ['Hierapolis']],
  [638811, 'Colossae', 'Asia, Phrygia, Lycus valley', ['Colossae', 'Colosse']],
  [550434, 'Alexandria Troas', 'Troad, Mysia', ['Troas', 'Alexandria Troas']],
  [550463, 'Assos', 'Troad', ['Assos', 'Assus']],
  [639042, 'Patara/Arsinoe', 'Lycia', ['Patara']],
  [639005, 'Myra', 'Lycia', ['Myra']],
  [599575, 'Cnidus (Tekir)', 'Caria', ['Cnidus', 'Knidos']],
  [981509, 'Asia (Roman province)', 'Asia', ['Asia', 'Roman Asia']],
  [619161, 'Galatia', 'Galatia', ['Galatia']],
  [639060, 'Pisidia (region)', 'Pisidia', ['Pisidia']],
  [648698, 'Lycaonia', 'Lycaonia', ['Lycaonia']],
  [609502, 'Phrygia', 'west-central Anatolia', ['Phrygia']],
  [639034, 'Pamphylia (region)', 'Pamphylia', ['Pamphylia']],
  [658440, 'Cilicia (region)', 'Cilicia', ['Cilicia']],
  [628949, 'Cappadocia (region)', 'Cappadocia', ['Cappadocia']],
  [857287, 'Pontus', 'Pontus', ['Pontus']],
  [511189, 'Bithynia (region)', 'Bithynia', ['Bithynia']],
  [550759, 'Mysia (region)', 'Mysia', ['Mysia']],
  [638965, 'Lycia', 'Lycia', ['Lycia']],
  // Aegean islands, Cyprus, Crete
  [707617, 'Salamis/Konstantia', 'Cyprus', ['Salamis']],
  [707586, '(Nea) Paphos', 'Cyprus', ['Paphos', 'Nea Paphos']],
  [707498, 'Cyprus (island)', 'Cyprus', ['Cyprus']],
  [589748, 'Creta (island)', 'Crete', ['Crete']],
  [589834, 'Kaloi Limenes', 'Crete', ['Fair Havens']],
  [589897, 'Lasaia', 'Crete', ['Lasea', 'Lasaea']],
  [550763, 'Mytilene', 'Lesbos', ['Mitylene', 'Mytilene']],
  [550497, 'Chios (island)', 'Aegean', ['Chios']],
  [599926, 'Samos (island)', 'Aegean', ['Samos']],
  [599581, 'Kos/Cos (island)', 'Aegean', ['Cos', 'Kos']],
  [590031, 'Rhodos (island)', 'Aegean', ['Rhodes']],
  [599872, 'Patmos (island)', 'Aegean', ['Patmos']],
  [501597, 'Samothrace (island)', 'Aegean, Thrace', ['Samothrace', 'Samothracia']],
  // Greece, Macedonia, Balkans
  [501482, 'Philippi', 'Macedonia', ['Philippi']],
  [491741, 'Thessalonica', 'Macedonia', ['Thessalonica', 'Thessalonika']],
  [491546, 'Ber(r)oia', 'Macedonia', ['Berea', 'Beroea', 'Beroia']],
  [501523, 'Neapolis (Kavalla)', 'Macedonia, Thrace coast, port of Philippi', ['Neapolis']],
  [501347, 'Amphipolis', 'Macedonia, on the Strymon', ['Amphipolis']],
  [491526, 'Apollonia', 'Macedonia, Mygdonia, Via Egnatia', ['Apollonia']],
  [481728, 'Apollonia', 'Illyria, Illyricum, Via Egnatia', ['Apollonia']],
  [481818, 'Dyrr', 'Illyria, Illyricum, Via Egnatia', ['Dyrrachium', 'Epidamnus']],
  [491656, 'Macedonia (region)', 'Macedonia', ['Macedonia']],
  [981502, 'Achaia (province)', 'Achaia, Greece', ['Achaia', 'Achaea']],
  [579885, 'Athenae', 'Attica, Achaia, Greece', ['Athens']],
  [570182, 'Corinthus', 'Achaia, Greece', ['Corinth']],
  [570347, 'Kenchreai', 'Corinthia, Achaia, Greece', ['Cenchreae', 'Cenchrea']],
  [531013, 'Nicopolis', 'Epirus', ['Nicopolis']],
  [530871, 'Epirus', 'Epirus', ['Epirus']],
  [481865, 'Illyricum', 'Illyricum', ['Illyricum']],
  [197240, 'Dalmatia (region)', 'Dalmatia', ['Dalmatia']],
  [501638, 'Thracia', 'Thrace', ['Thrace']],
  [520985, 'Byzantium', 'Thrace, Bosporus', ['Byzantium']],
  [1224, 'Pontus Euxinus', 'Black Sea', ['Black Sea', 'Euxine Sea']],
  // Italy, Sicily, Malta, Spain
  [423025, 'Roma', 'Italy', ['Rome']],
  [422995, 'Ostia', 'Italy, Latium', ['Ostia']],
  [432815, 'Puteoli', 'Italy, Campania', ['Puteoli']],
  [422927, 'Forum Appii', 'Italy, Latium, Via Appia', ['Forum of Appius', 'Appii Forum', 'Forum Appii']],
  [423106, 'Tres Tabernae', 'Italy, Latium, Via Appia', ['Three Taverns', 'Tres Tabernae']],
  [452416, 'Rhegion', 'Italy, Bruttium', ['Rhegium']],
  [442509, 'Brundisium', 'Italy, Calabria', ['Brundisium']],
  [462503, 'Syracusae', 'Sicily', ['Syracuse']],
  [462492, 'Sicilia (island)', 'Sicily', ['Sicily']],
  [462311, 'Melita/Malta', 'Malta', ['Malta', 'Melita']],
  [1027, 'Hispania', 'Spain', ['Spain', 'Hispania']],
];
const NO_PRIMARY = new Set(['nicopolis', 'neapolis', 'seleucia', 'kadesh']);

// Itiner-e keeps road names in the `Itinerary` field, mixed in with the ancient
// itineraries and texts the segment is attested in. These are sources, not roads.
const NOT_A_ROAD = /^(tabula peutingeriana|itinerarium\b|ravenna cosmography|rauennatis|stadiasmus patarensis|eusebius|procopius)/i;
// English names for roads (the data uses the Latin/ancient names).
const ROAD_ALIASES = {
  'Via Egnatia':   ['Egnatian Way'],
  'Via Appia':     ['Appian Way'],
  'Via Flaminia':  ['Flaminian Way'],
  'Via Aurelia':   ['Aurelian Way'],
  'Via Domitia':   ['Domitian Way'],
  'Via Aemilia':   ['Aemilian Way'],
  'Via Maris':     ['Way of the Sea'],
  'Via Sebaste':   ['Sebastian Way'],
  'Via Nova Traiana': ['Via Traiana Nova', "Trajan's New Road"],
  'Incense Road':  ['Incense Route'],
};
const SIMPLIFY_TOLERANCE = 0.002;   // degrees (~200 m) — invisible at zoom 5–9
const COORD_DECIMALS = 4;

// ── Download helpers ──────────────────────────────────────────────────────────
function download(url, dest, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'IronAndInk-geo-build/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects > 5) return reject(new Error('Too many redirects: ' + url));
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(dest); }));
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchJson(url) {
  const dest = path.join(DL_DIR, 'tmp-' + Date.now() + '.json');
  await download(url, dest);
  const j = JSON.parse(fs.readFileSync(dest, 'utf8'));
  fs.unlinkSync(dest);
  return j;
}

async function getFile(name, url) {
  const dest = path.join(DL_DIR, name);
  if (cached && fs.existsSync(dest)) { console.log(`  using cached ${name}`); return dest; }
  console.log(`  downloading ${url}`);
  await download(url, dest);
  return dest;
}

// Minimal RFC 4180 CSV parser → array of objects keyed by the header row.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map(r => { const o = {}; head.forEach((k, j) => { o[k] = r[j] || ''; }); return o; });
}

// ── Places ────────────────────────────────────────────────────────────────────
// "Ber(r)oia" → Beroia, Berroia; "Salamis (island)" → Salamis;
// "(Nea) Paphos" → Nea Paphos, Paphos.
function expandParens(s) {
  const m = s.match(/^(.*?)\(([^()]*)\)(.*)$/);
  if (!m) return [s];
  const [, before, inner, after] = m;
  const inWord = /[A-Za-zÀ-ɏ]$/.test(before) || /^[A-Za-zÀ-ɏ]/.test(after);
  let variants;
  if (inWord) variants = [before + inner + after, before + after];
  else if (!before.trim()) variants = [inner + after, after];
  else variants = [before + after];
  return [].concat(...variants.map(v => expandParens(v.replace(/\s+/g, ' ').trim())));
}

// A name worth indexing: no uncertainty mark, no editorial brackets, no stars.
function nameVariants(raw) {
  const out = [];
  for (const part of String(raw || '').split(/[\/,]/)) {
    const p = part.trim();
    if (!p || /[?\[\]*]/.test(p)) continue;
    for (const v of expandParens(p)) if (v && v.length <= 60) out.push(v);
  }
  return out;
}

function regionText(p) {
  let d = (p.description || '').replace(/\s+/g, ' ').trim();
  if (/^An ancient place, cited:/i.test(d)) d = '';
  const dot = d.search(/\.(\s|$)/);
  if (dot > 0) d = d.slice(0, dot + 1);
  if (d.length > 160) d = d.slice(0, 157).replace(/\s+\S*$/, '') + '…';
  const gc = (p.geoContext || '').trim();
  if (gc && !/^\d+$/.test(gc) && gc.length <= 80) d = d ? d + ' · ' + gc : gc;
  return d;
}

function buildPlaces(placesCsv, namesCsv) {
  const placeRows = parseCsv(placesCsv);
  const nameRows  = parseCsv(namesCsv);

  const byId = new Map();
  for (const p of placeRows) {
    const lat = parseFloat(p.reprLat), lon = parseFloat(p.reprLong);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (p.locationPrecision === 'unlocated') continue;
    byId.set(p.id, {
      id: p.id, title: p.title.trim(), lat, lon,
      types: (p.featureTypes || '').split(',').map(s => s.trim()).filter(t => t && t !== 'unknown').join(','),
      region: regionText(p),
      names: new Map(),   // normalized → display
      // Every part of the title marked uncertain ("Cana? (island)"): the place's
      // identification is doubtful, so its other names aren't indexed either —
      // otherwise a plain "Cana" in the names file would pin it.
      uncertain: p.title.split('/').every(part => part.includes('?')),
    });
  }
  const addName = (pl, n) => { const k = normName(n); if (k && !pl.names.has(k)) pl.names.set(k, n); };

  for (const pl of byId.values()) nameVariants(pl.title).forEach(n => addName(pl, n));
  for (const n of nameRows) {
    const pl = byId.get(String(n.pid || '').split('/').pop());
    if (!pl || pl.uncertain) continue;
    for (const src of [n.title, n.nameTransliterated]) nameVariants(src).forEach(v => addName(pl, v));
  }

  // Curated biblical / English names.
  const curatedCount = new Map();   // normalized name → [ids]
  const labels = {};                // id → the curated English name (map labels)
  let curatedOk = 0;
  for (const [id, expect, region, names] of CURATED) {
    const pl = byId.get(String(id));
    if (!pl) { console.warn(`  ! curated ${id} (${expect}) not found/located in Pleiades — skipped`); continue; }
    if (!pl.title.includes(expect)) {
      console.warn(`  ! curated ${id}: title "${pl.title}" no longer contains "${expect}" — skipped`);
      continue;
    }
    curatedOk++;
    if (region) pl.region = region;
    if (!labels[pl.id] && names.length) labels[pl.id] = names[0];
    for (const n of names) {
      addName(pl, n);
      const k = normName(n);
      const list = curatedCount.get(k) || [];
      if (!list.includes(pl.id)) list.push(pl.id);
      curatedCount.set(k, list);
    }
  }
  const primary = {};
  for (const [k, ids] of curatedCount) {
    if (ids.length === 1 && !NO_PRIMARY.has(k)) primary[k] = Number(ids[0]) || ids[0];
  }

  const round = x => Math.round(x * 1e5) / 1e5;
  const out = [];
  for (const pl of byId.values()) {
    const titleKey = normName(pl.title);
    const names = [...pl.names.entries()].filter(([k]) => k !== titleKey).map(([, v]) => v);
    out.push([Number(pl.id) || pl.id, pl.title, names, round(pl.lat), round(pl.lon), pl.types, pl.region]);
  }
  return { places: out, primary, labels, curatedOk };
}

// ── Roads ─────────────────────────────────────────────────────────────────────
// Itiner-e is in EPSG:3395 (World Mercator, WGS84 ellipsoid) → lat/lon.
const A = 6378137, E = 0.0818191908426215;
function mercatorToLatLon(x, y) {
  const lon = x / A * 180 / Math.PI;
  const t = Math.exp(-y / A);
  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 10; i++) {
    const es = E * Math.sin(phi);
    const next = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - es) / (1 + es), E / 2));
    if (Math.abs(next - phi) < 1e-12) { phi = next; break; }
    phi = next;
  }
  return [phi * 180 / Math.PI, lon];
}

// Douglas–Peucker on [lat, lon] points.
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ay, ax] = pts[s], [by, bx] = pts[e];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [py, px] = pts[i];
      let d;
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = (px - ax - u * dx) ** 2 + (py - ay - u * dy) ** 2;
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function roadNamesOf(props) {
  const raw = props.Itinerary;
  if (!raw) return [];
  return raw.split(/[,;?]/).map(s => s.trim()).filter(s => s && !NOT_A_ROAD.test(s));
}

function buildRoads(geojson) {
  const groups = new Map();   // normRoad → { name, aliases, segments, points }
  let features = 0, named = 0;
  for (const f of geojson.features || []) {
    features++;
    const names = roadNamesOf(f.properties || {});
    if (!names.length || !f.geometry) continue;
    named++;
    const g = f.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates]
                : g.type === 'MultiLineString' ? g.coordinates : [];
    const segs = [];
    for (const line of lines) {
      const ll = line.map(c => mercatorToLatLon(c[0], c[1]));
      const simp = simplify(ll, SIMPLIFY_TOLERANCE)
        .map(([la, lo]) => [+la.toFixed(COORD_DECIMALS), +lo.toFixed(COORD_DECIMALS)]);
      if (simp.length >= 2) segs.push(simp);
    }
    if (!segs.length) continue;
    const certainty = f.properties.Segment_s || null;
    for (const name of names) {
      const k = normRoad(name);
      if (!groups.has(k)) groups.set(k, { name, aliases: [], segments: [], points: 0 });
      const grp = groups.get(k);
      if (name !== grp.name && !grp.aliases.includes(name)) grp.aliases.push(name);
      for (const coords of segs) { grp.segments.push({ c: certainty, coords }); grp.points += coords.length; }
    }
  }
  const roads = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(r => {
      const aliases = r.aliases.concat(ROAD_ALIASES[r.name] || []);
      return { name: r.name, aliases, segments: r.segments };
    });
  return { roads, features, named };
}

// ── Main ──────────────────────────────────────────────────────────────────────
function size(file) { return (fs.statSync(file).size / 1024 / 1024).toFixed(2) + ' MB'; }

async function main() {
  fs.mkdirSync(DL_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Pleiades…');
  const placesGz = await getFile('pleiades-places.csv.gz', SOURCES.pleiadesPlaces);
  const namesGz  = await getFile('pleiades-names.csv.gz', SOURCES.pleiadesNames);
  const placesCsv = zlib.gunzipSync(fs.readFileSync(placesGz)).toString('utf8');
  const namesCsv  = zlib.gunzipSync(fs.readFileSync(namesGz)).toString('utf8');
  const lastPleiades = (placesCsv.match(/\d{4}-\d{2}-\d{2}T[\d:]+Z/g) || []).sort().pop() || 'unknown';

  console.log('Itiner-e…');
  const record = await fetchJson(SOURCES.itinereRecord);
  const file = (record.files || []).find(f => f.key === SOURCES.itinereFile);
  if (!file) throw new Error('Itiner-e record has no ' + SOURCES.itinereFile);
  const roadsPath = await getFile('itinere_roads.geojson', file.links.self);

  console.log('Building places…');
  const P = buildPlaces(placesCsv, namesCsv);
  const generated = new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR, 'places.json'), JSON.stringify({
    source: 'Pleiades (https://pleiades.stoa.org), CC BY 3.0',
    generated,
    format: '[id, title, names[], lat, lon, types, region]',
    primary: P.primary,
    labels: P.labels,
    places: P.places,
  }));

  console.log('Building roads…');
  const R = buildRoads(JSON.parse(fs.readFileSync(roadsPath, 'utf8')));
  fs.writeFileSync(path.join(OUT_DIR, 'roads.json'), JSON.stringify({
    source: 'Itiner-e static version 2024 (Zenodo 10.5281/zenodo.17122148), CC BY 4.0',
    generated,
    roads: R.roads,
  }));

  const meta = record.metadata || {};
  fs.writeFileSync(path.join(OUT_DIR, 'SOURCES.md'), sourcesMd({
    generated, lastPleiades,
    itinereTitle: meta.title || 'Itiner-e', itinereVersion: meta.version || '?',
    itinereDate: meta.publication_date || '?',
    itinereAuthors: (meta.creators || []).map(c => c.name).slice(0, 4).join('; ') +
      ((meta.creators || []).length > 4 ? ' et al.' : ''),
  }));

  const segs = R.roads.reduce((n, r) => n + r.segments.length, 0);
  const pts  = R.roads.reduce((n, r) => n + r.segments.reduce((m, s) => m + s.coords.length, 0), 0);
  const names = P.places.reduce((n, p) => n + 1 + p[2].length, 0);
  console.log('\nDone.');
  console.log(`  geo/places.json  ${size(path.join(OUT_DIR, 'places.json'))}  — ${P.places.length} places, ${names} names, ` +
              `${P.curatedOk}/${CURATED.length} curated entries, ${Object.keys(P.primary).length} primary names`);
  console.log(`  geo/roads.json   ${size(path.join(OUT_DIR, 'roads.json'))}  — ${R.roads.length} named roads, ${segs} segment lines, ` +
              `${pts} points (from ${R.named} named of ${R.features} Itiner-e features)`);
  console.log(`  geo/SOURCES.md   ${size(path.join(OUT_DIR, 'SOURCES.md'))}`);
  const total = ['places.json', 'roads.json', 'SOURCES.md']
    .reduce((n, f) => n + fs.statSync(path.join(OUT_DIR, f)).size, 0);
  console.log(`  total            ${(total / 1024 / 1024).toFixed(2)} MB`);
  const eg = R.roads.find(r => r.name === 'Via Egnatia');
  console.log(`  Via Egnatia: ${eg ? eg.segments.length + ' segment lines' : 'NOT FOUND'}`);
}

function sourcesMd(o) {
  return `# geo/ — map data for tooltip answers

Built by \`scripts/build-geo-data.js\` on ${o.generated}. Re-run it to refresh:

    node scripts/build-geo-data.js

Read by \`lib/geo.js\`. Not member data — kept out of \`data/\` on purpose.

## Places — Pleiades

- Source: Pleiades gazetteer of ancient places, https://pleiades.stoa.org
- Files: the official Pleiades CSV exports
  (${SOURCES.pleiadesPlaces},
  ${SOURCES.pleiadesNames}) — the same data published in
  https://github.com/isawnyu/pleiades.datasets
- Snapshot: latest export as of ${o.generated} (newest record modified ${o.lastPleiades})
- License: Creative Commons Attribution 3.0 (CC BY 3.0)
- Required attribution: "Places: Pleiades (CC BY)" — linked to https://pleiades.stoa.org
- Kept: places with a location (precise, rough or related); id, title, names, lat/lon,
  place types, a short description used for region hints. Plus a curated table of
  biblical/English names (in the build script) mapped to Pleiades ids.

## Roads — Itiner-e

- Source: ${o.itinereTitle}
- Version ${o.itinereVersion}, published ${o.itinereDate}; Zenodo DOI 10.5281/zenodo.17122148
  (https://itiner-e.org)
- License: Creative Commons Attribution 4.0 (CC BY 4.0)
- Required attribution: "Roads: Itiner-e (CC BY 4.0)" — linked to https://itiner-e.org
- Kept: only segments that carry a road name (in Itiner-e's \`Itinerary\` field, which
  also lists the ancient itineraries a segment is attested in — those are dropped),
  grouped by road name, reprojected from EPSG:3395 to WGS84 lat/lon, simplified
  (Douglas–Peucker, ${SIMPLIFY_TOLERANCE}°), with each segment's certainty
  (\`Segment_s\`: Certain / Conjectured / Hypothetical).
- Authors: ${o.itinereAuthors}

## Base map tiles — Digital Atlas of the Roman Empire (DARE)

- Tiles: https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png (zoom 4–11), loaded by the browser
- Source: Johan Åhlfeldt, Digital Atlas of the Roman Empire, University of Gothenburg
  (https://dh.gu.se/dare/)
- License: Creative Commons Attribution 4.0 (CC BY 4.0)
- Required attribution: "Map: Digital Atlas of the Roman Empire (CC BY 4.0)"

The map shows all three attributions, with links, on every map.
(Ancient World Mapping Center data/tiles are NOT used — they are NonCommercial.)
`;
}

main().catch(err => { console.error('build-geo-data failed:', err.message); process.exit(1); });
