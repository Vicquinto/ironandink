# geo/ — map data for tooltip answers

Built by `scripts/build-geo-data.js` on 2026-11-01T16:24:59.339Z. Re-run it to refresh:

    node scripts/build-geo-data.js

Read by `lib/geo.js`. Not member data — kept out of `data/` on purpose.

## Places — Pleiades

- Source: Pleiades gazetteer of ancient places, https://pleiades.stoa.org
- Files: the official Pleiades CSV exports
  (https://atlantides.org/downloads/pleiades/dumps/pleiades-places-latest.csv.gz,
  https://atlantides.org/downloads/pleiades/dumps/pleiades-names-latest.csv.gz) — the same data published in
  https://github.com/isawnyu/pleiades.datasets
- Snapshot: latest export as of 2026-11-01T16:24:59.339Z (newest record modified 2026-11-01T10:25:13Z)
- License: Creative Commons Attribution 3.0 (CC BY 3.0)
- Required attribution: "Places: Pleiades (CC BY)" — linked to https://pleiades.stoa.org
- Kept: places with a location (precise, rough or related); id, title, names, lat/lon,
  place types, a short description used for region hints. Plus a curated table of
  biblical/English names (in the build script) mapped to Pleiades ids.

## Roads — Itiner-e

- Source: A High-Resolution Dataset of Roads of the Roman Empire: Itiner-e static version 2024
- Version 1.3, published 2025-09-15; Zenodo DOI 10.5281/zenodo.17122148
  (https://itiner-e.org)
- License: Creative Commons Attribution 4.0 (CC BY 4.0)
- Required attribution: "Roads: Itiner-e (CC BY 4.0)" — linked to https://itiner-e.org
- Kept: only segments that carry a road name (in Itiner-e's `Itinerary` field, which
  also lists the ancient itineraries a segment is attested in — those are dropped),
  grouped by road name, reprojected from EPSG:3395 to WGS84 lat/lon, simplified
  (Douglas–Peucker, 0.002°), with each segment's certainty
  (`Segment_s`: Certain / Conjectured / Hypothetical).
- Authors: de Soto, Pau; Pažout, Adam; Brughmans, Tom; Vahlstrup, Peter et al.

## Base map tiles — Digital Atlas of the Roman Empire (DARE)

- Tiles: https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png (zoom 4–11), loaded by the browser
- Source: Johan Åhlfeldt, Digital Atlas of the Roman Empire, University of Gothenburg
  (https://dh.gu.se/dare/)
- License: Creative Commons Attribution 4.0 (CC BY 4.0)
- Required attribution: "Map: Digital Atlas of the Roman Empire (CC BY 4.0)"

The map shows all three attributions, with links, on every map.
(Ancient World Mapping Center data/tiles are NOT used — they are NonCommercial.)
