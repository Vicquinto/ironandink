// ─── Ancient places + Roman roads for highlight-panel answers ────────────────
// The tooltip AI answers (Define / Explore in the highlight panel) may mark
// geography with {{place:Name}}, {{place:Name, Region}} and {{road:Name}}. Like
// {{verse:...}}, the AI never supplies the data: each marker is resolved here
// against downloaded, trusted gazetteers in geo/ (built by
// scripts/build-geo-data.js — Pleiades places, Itiner-e roads). A marker that
// does not resolve to exactly one place/road becomes plain text with no pin;
// a location is never guessed.
//
//   processGeoMarkers(text) → { text, map }
//     text — every marker replaced by its plain name (no HTML: the answer is
//            markdown, rendered and sanitized client-side, and is also what gets
//            pinned to notes and sent back as conversation history)
//     map  — { places: [{ name, title, lat, lon, pleiadesId }],
//              roads:  [{ name, title, geometry: [{ c, coords }] }] }
//            or null when nothing resolved. The client links the plain names in
//            the rendered answer to their pins (public/js/geo-map.js).
//
// geo/places.json loads at startup (call init()); geo/roads.json loads on first
// road marker. If geo/ is missing the feature does nothing: markers still turn
// into plain names, no map is returned, and one warning is logged at startup.

const fs   = require('fs');
const path = require('path');

const GEO_DIR     = path.join(__dirname, '..', 'geo');
const PLACES_FILE = path.join(GEO_DIR, 'places.json');
const ROADS_FILE  = path.join(GEO_DIR, 'roads.json');

const MAX_PLACES = 12;
const MAX_ROADS  = 3;
const MAX_MARKER = 80;   // marker content length cap (name + optional region)
const MAX_PART   = 60;   // name or region part length cap

// The prompt paragraph added (verbatim) to the tooltip Define / Explore prompts.
const GEO_RULE =
  "PLACES AND ROADS: When geography helps the reader understand the passage or topic (where a city was, a journey, a route, a region), mark ancient places with {{place:Name}} and Roman roads with {{road:Name}}, using the place's standard ancient name (e.g. {{place:Philippi}}, {{road:Via Egnatia}}). If a name could mean more than one place, add the region: {{place:Antioch, Pisidia}}. The system turns these into a map under your answer. Mark only places that matter to the point, at most about eight per answer. Write each marker inline exactly where the name belongs in your sentence. Never write coordinates or describe locations by latitude and longitude. Don't mark modern places.";

// ── Name normalization (shared with scripts/build-geo-data.js) ────────────────
// Case- and diacritic-insensitive; punctuation folds to single spaces.
function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’ʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
// Roads also fold j→i (Via Iulia / Via Julia) and drop a leading "the".
function normRoad(s) {
  return normName(s).replace(/j/g, 'i').replace(/^the /, '');
}

// ── Places (loaded at startup) ────────────────────────────────────────────────
let places = null;   // { byId: Map<id, place>, index: Map<key, id[]>, primary: Map<key, id> }

function init() {
  if (places) return;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'));
  } catch (err) {
    console.warn('[Geo] geo/places.json not available (' + (err.code || err.message) +
      ') — tooltip maps disabled. Build it with: node scripts/build-geo-data.js');
    return;
  }
  const byId = new Map();
  const index = new Map();
  for (const row of raw.places || []) {
    // [id, title, names[], lat, lon, types, region]
    const p = { id: String(row[0]), title: row[1], lat: row[3], lon: row[4], types: row[5] || '', region: row[6] || '' };
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    byId.set(p.id, p);
    const keys = new Set([normName(p.title)]);
    for (const n of row[2] || []) keys.add(normName(n));
    for (const k of keys) {
      if (!k) continue;
      const list = index.get(k);
      if (!list) index.set(k, [p.id]);
      else if (!list.includes(p.id)) list.push(p.id);
    }
  }
  const primary = new Map();
  for (const [k, id] of Object.entries(raw.primary || {})) {
    if (byId.has(String(id))) primary.set(normName(k), String(id));
  }
  places = { byId, index, primary };
  console.log(`[Geo] places loaded: ${byId.size} (${index.size} names)`);
}

// ── Roads (loaded on first use) ───────────────────────────────────────────────
let roads;   // undefined = not tried yet; null = unavailable; else { index: Map<key, road> }

function loadRoads() {
  if (roads !== undefined) return roads;
  try {
    const raw = JSON.parse(fs.readFileSync(ROADS_FILE, 'utf8'));
    const index = new Map();
    for (const r of raw.roads || []) {
      for (const n of [r.name].concat(r.aliases || [])) {
        const k = normRoad(n);
        if (k && !index.has(k)) index.set(k, r);
      }
    }
    roads = { index };
    console.log(`[Geo] roads loaded: ${(raw.roads || []).length}`);
  } catch (err) {
    console.warn('[Geo] geo/roads.json not available (' + (err.code || err.message) + ') — roads disabled.');
    roads = null;
  }
  return roads;
}

// ── Resolvers ─────────────────────────────────────────────────────────────────
const HINT_STOP = new Set(['the', 'of', 'in', 'on', 'and', 'ad', 'near', 'by']);

// Does the ", Region" hint fit this place? Every hint word must match the start
// of some word in the place's region/description or title ("Pisidia" fits
// "Pisidian", "Syria" fits "Syrian").
function regionMatches(hint, p) {
  const words = normName(p.region + ' ' + p.title).split(' ');
  const tokens = normName(hint).split(' ').filter(t => t && !HINT_STOP.has(t));
  if (!tokens.length) return false;
  return tokens.every(t => {
    const stem = t.length > 5 ? t.slice(0, t.length - 2) : t;
    return words.some(w => w.startsWith(stem));
  });
}

// Never pinned: the Pleiades match is a different place, or the identification is a scholarly guess — Iron & Ink leaves a place off the map rather than assert a contested location.
const NEVER_RESOLVE = new Set([
  'Abraham', 'Amos', 'Valley', 'Sion', 'East gate', 'Gur', 'Koa', 'Kitron', 'Tarshish',
  'Lebanon', 'Adria', 'Ophir', 'Seba', 'Parah', 'Migdal-gad', 'Kedron', 'Elim',
  'Manna', 'Massa', 'Sanctuary',
].map(normName));
// Never pinned bare — the name alone means different places (Kadesh-barnea in the Negev, Kadesh on the Orontes) — but a region hint ("Kadesh, Barnea") may still resolve it.
const NEVER_RESOLVE_BARE = new Set(['Kadesh'].map(normName));

// "Name" or "Name, Region" → place, or null when unknown or still ambiguous.
function resolvePlace(name, hint) {
  if (!places) return null;
  const key = normName(name);
  if (!key || NEVER_RESOLVE.has(key)) return null;
  if (!hint && NEVER_RESOLVE_BARE.has(key)) return null;
  const cands = places.index.get(key) || [];
  if (hint) {
    const fit = cands.filter(id => regionMatches(hint, places.byId.get(id)));
    return fit.length === 1 ? places.byId.get(fit[0]) : null;
  }
  // A curated English/biblical primary (built into places.json) settles a name
  // the reader would read one way — "Berea" is the Macedonian city — and is the
  // only tie-break; otherwise the name must identify exactly one place.
  const prim = places.primary.get(key);
  if (prim) return places.byId.get(prim);
  return cands.length === 1 ? places.byId.get(cands[0]) : null;
}

function resolveRoad(name) {
  if (NEVER_RESOLVE.has(normName(name))) return null;
  const r = loadRoads();
  if (!r) return null;
  return r.index.get(normRoad(name)) || null;
}

// ── Marker processing ─────────────────────────────────────────────────────────
// Strict: kind is place|road, content is letters/marks/digits/space and a little
// punctuation, ≤ 80 chars, no braces or newlines. Anything else is not a marker.
const GEO_MARKER_RE = /\{\{\s*(place|road)\s*:\s*([^{}\n]{1,120}?)\s*\}\}/gi;
const CONTENT_OK_RE = /^[\p{L}\p{M}0-9 .,'’()\-]+$/u;
// Stray/unterminated marker openers left after replacement are reduced to text.
const STRAY_RE = /\{\{\s*(?:place|road)\s*:\s*/gi;

function cleanPart(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function processGeoMarkers(text) {
  if (typeof text !== 'string' || text.indexOf('{{') === -1) return { text, map: null };

  const outPlaces = [];
  const outRoads  = [];
  const seenPlace = new Set();
  const seenRoad  = new Set();

  let out = text.replace(GEO_MARKER_RE, (_m, kindRaw, contentRaw) => {
    const kind = kindRaw.toLowerCase();
    const content = cleanPart(contentRaw);
    const valid = content.length <= MAX_MARKER && CONTENT_OK_RE.test(content);

    if (kind === 'place') {
      const comma = content.indexOf(',');
      const name  = cleanPart(comma === -1 ? content : content.slice(0, comma));
      const hint  = comma === -1 ? '' : cleanPart(content.slice(comma + 1));
      if (!valid || !name || name.length > MAX_PART || hint.length > MAX_PART) {
        return name.replace(/[^\p{L}\p{M}0-9 .'’\-]/gu, '');
      }
      const p = resolvePlace(name, hint);
      if (p && !seenPlace.has(p.id) && outPlaces.length < MAX_PLACES) {
        seenPlace.add(p.id);
        outPlaces.push({ name, title: p.title, lat: p.lat, lon: p.lon, pleiadesId: p.id });
      }
      return name;
    }

    // road
    if (!valid) return content.replace(/[^\p{L}\p{M}0-9 .'’\-]/gu, '');
    const r = resolveRoad(content);
    if (r && !seenRoad.has(r.name) && outRoads.length < MAX_ROADS) {
      seenRoad.add(r.name);
      outRoads.push({ name: content, title: r.name, geometry: r.segments });
    }
    return content;
  });

  out = out.replace(STRAY_RE, '');
  const map = (outPlaces.length || outRoads.length) ? { places: outPlaces, roads: outRoads } : null;
  return { text: out, map };
}

// ── Map for a dictionary headword (Define answered by Easton's) ───────────────
// No AI and no markers on that path, so the headword itself is checked: a road
// name gets its road; otherwise the bare headword (no region hint) must resolve
// to exactly one place by the usual rules AND the first sentence of the entry's
// first sense must describe a place — so a person who shares a place's name
// gets no pin.
const PLACE_WORD_RE = new RegExp('\\b(' + [
  'city', 'cities', 'town', 'towns', 'village', 'villages', 'region', 'regions',
  'district', 'districts', 'country', 'countries', 'province', 'provinces',
  'island', 'islands', 'mountain', 'mountains', 'mount', 'hill', 'hills',
  'river', 'rivers', 'harbour', 'harbours', 'harbor', 'harbors', 'port', 'ports',
  'sea', 'seas', 'lake', 'lakes', 'valley', 'valleys', 'plain', 'plains',
  'capital', 'seaport', 'fortress', 'stronghold', 'territory', 'land', 'wilderness',
  'desert', 'coast', 'brook', 'spring', 'well',
].join('|') + ')\\b', 'i');

// Easton's entries whose first sense is a person but which go on to describe
// the place the headword resolves to — pinned without the place-word check.
// Easton's path only; the never-resolve list still applies.
const EASTONS_ALLOW = new Set(['Moab', 'Ephron', 'Rekem', 'Shechem', 'Ziph'].map(normName));

// Easton's entries open with the name's meaning, then numbered senses:
// "House of bread. (1.) A city in the ..." The first sense is the text before
// "(2.)", starting after "(1.)" when there is one. A sentence ends at a period
// followed by a capital, an opening quote/bracket, or the end — but not after
// an abbreviation ("Heb. Yarden", "R.V.") or a book name ("Gen. 11:27" is
// followed by a digit anyway). A bare meaning gloss of three words or fewer
// opening an unnumbered entry ("Circuit." — Galilee) is the name's meaning, not
// the sense, so the sentence after it is used.
const ABBREV_RE = /(?:^|[\s(])(?:heb|gr|lat|arab|assyr|chald|syr|aram|comp|cf|viz|ver|vers|ch|i\.e|e\.g|r\.v|a\.v|st|mt|b\.c|a\.d|[a-z])$/i;

function sentences(t) {
  const out = [];
  let start = 0;
  const re = /\.(?=\s+[A-Z"“(\[]|\s*$)/g;
  let m;
  while ((m = re.exec(t))) {
    if (ABBREV_RE.test(t.slice(start, m.index))) continue;
    out.push(t.slice(start, m.index + 1).trim());
    start = m.index + 1;
  }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

function firstSentenceOfFirstSense(firstSense) {
  let t = String(firstSense || '');
  const two = t.indexOf('(2.)');
  if (two !== -1) t = t.slice(0, two);
  const one = t.indexOf('(1.)');
  if (one !== -1) t = t.slice(one + 4);
  const list = sentences(t.trim());
  if (!list.length) return '';
  if (list.length > 1 && list[0].split(/\s+/).length <= 3) return list[1];
  return list[0];
}

// entrySenses: the Easton's entry's senses array (senses[0] is the first sense).
function mapForHeadword(headword, entrySenses) {
  const name = cleanPart(headword);
  if (!name || name.length > MAX_PART) return null;
  const r = resolveRoad(name);
  if (r) return { places: [], roads: [{ name, title: r.name, geometry: r.segments }] };
  const first = Array.isArray(entrySenses) ? entrySenses[0] : entrySenses;
  if (!EASTONS_ALLOW.has(normName(name)) &&
      !PLACE_WORD_RE.test(firstSentenceOfFirstSense(first))) return null;
  const p = resolvePlace(name, '');
  if (!p) return null;
  return { places: [{ name, title: p.title, lat: p.lat, lon: p.lon, pleiadesId: p.id }], roads: [] };
}

module.exports = { init, processGeoMarkers, mapForHeadword, firstSentenceOfFirstSense, resolvePlace, resolveRoad, normName, normRoad, GEO_RULE };
