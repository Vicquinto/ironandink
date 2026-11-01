(function (global) {
  'use strict';

  // Small map under a highlight-panel answer (Define / Explore) that names
  // ancient places or Roman roads. The server resolves the AI's {{place:...}} /
  // {{road:...}} markers against trusted gazetteers (lib/geo.js) and sends
  //   map = { places: [{ name, title, lat, lon, pleiadesId }],
  //           roads:  [{ name, title, geometry: [{ c, coords: [[lat, lon], …] }] }] }
  // alongside the answer text, where each marker is already a plain name. This
  // pins the places, draws the roads, and turns those names in the rendered
  // answer into links that fly the map to their pin.
  //
  // Leaflet (vendored, BSD-2-Clause) is loaded on first use only. Every label is
  // set as text (textContent / DOM nodes), never as HTML.
  //
  //   window.IronInkGeoMap.attach(answerBodyEl, map)

  var LEAFLET_JS  = '/vendor/leaflet-1.9.4/leaflet.js';
  var LEAFLET_CSS = '/vendor/leaflet-1.9.4/leaflet.css';
  var TILE_URL    = 'https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png';
  var MIN_ZOOM = 4, MAX_ZOOM = 11, FIT_MAX_ZOOM = 8;
  var HIDDEN_KEY = 'ironink_tooltip_map_hidden';

  var leafletPromise = null;

  function loadLeaflet() {
    if (global.L && global.L.map) return Promise.resolve(global.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[data-leaflet-css]')) {
        var link = document.createElement('link');
        link.rel  = 'stylesheet';
        link.href = LEAFLET_CSS;
        link.setAttribute('data-leaflet-css', '');
        document.head.appendChild(link);
      }
      var s = document.createElement('script');
      s.src = LEAFLET_JS;
      s.onload  = function () { global.L ? resolve(global.L) : reject(new Error('Leaflet missing')); };
      s.onerror = function () { leafletPromise = null; reject(new Error('Leaflet failed to load')); };
      document.head.appendChild(s);
    });
    return leafletPromise;
  }

  function prefHidden() {
    try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch (e) { return false; }
  }
  function setPrefHidden(hidden) {
    try {
      if (hidden) localStorage.setItem(HIDDEN_KEY, '1');
      else localStorage.removeItem(HIDDEN_KEY);
    } catch (e) {}
  }

  // ── Payload validation (defence in depth — the server already validated) ──
  function str(s, max) {
    return (typeof s === 'string') ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }
  function okLat(v) { return typeof v === 'number' && isFinite(v) && v >= -90 && v <= 90; }
  function okLon(v) { return typeof v === 'number' && isFinite(v) && v >= -180 && v <= 180; }

  function cleanMap(map) {
    if (!map || typeof map !== 'object') return null;
    var places = (Array.isArray(map.places) ? map.places : []).slice(0, 12).map(function (p) {
      if (!p || !okLat(p.lat) || !okLon(p.lon)) return null;
      var name = str(p.name, 80);
      if (!name) return null;
      return { name: name, title: str(p.title, 160), lat: p.lat, lon: p.lon };
    }).filter(Boolean);
    var roads = (Array.isArray(map.roads) ? map.roads : []).slice(0, 3).map(function (r) {
      if (!r || !Array.isArray(r.geometry)) return null;
      var name = str(r.name, 80);
      if (!name) return null;
      var lines = r.geometry.map(function (seg) {
        var coords = (seg && Array.isArray(seg.coords)) ? seg.coords.filter(function (c) {
          return Array.isArray(c) && okLat(c[0]) && okLon(c[1]);
        }) : [];
        return coords.length >= 2 ? { c: str(seg.c, 20), coords: coords } : null;
      }).filter(Boolean);
      return lines.length ? { name: name, title: str(r.title, 80), lines: lines } : null;
    }).filter(Boolean);
    return (places.length || roads.length) ? { places: places, roads: roads } : null;
  }

  // ── Link the plain names in the rendered answer ───────────────────────────
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Wraps each whole-word occurrence of every name in a text node with a link
  // span. targets: [{ name, kind, idx }]. Skips text already inside a link or
  // control, and the map itself.
  function linkNames(root, targets, skipEl) {
    if (!targets.length) return;
    var sorted = targets.slice().sort(function (a, b) { return b.name.length - a.name.length; });
    var re;
    try {
      re = new RegExp('(^|[^\\p{L}\\p{M}])(' + sorted.map(function (t) { return escapeRe(t.name); }).join('|') +
        ')(?=[^\\p{L}\\p{M}]|$)', 'gu');
    } catch (e) { return; }   // no Unicode property escapes — leave the text plain
    var byName = {};
    sorted.forEach(function (t) { if (!byName[t.name]) byName[t.name] = t; });

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var el = n.parentElement;
        if (!el || (skipEl && skipEl.contains(el))) return NodeFilter.FILTER_REJECT;
        if (el.closest('a, button, .geo-place-link, sup')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (node) {
      var text = node.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0, m;
      while ((m = re.exec(text))) {
        var start = m.index + m[1].length;
        var t = byName[m[2]];
        if (!t) continue;
        if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
        var span = document.createElement('span');
        span.className = 'geo-place-link geo-' + t.kind + '-link';
        span.setAttribute('role', 'button');
        span.setAttribute('tabindex', '0');
        span.setAttribute('data-geo-kind', t.kind);
        span.setAttribute('data-geo-idx', String(t.idx));
        span.textContent = m[2];
        frag.appendChild(span);
        last = start + m[2].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function tooltipNode(name, title) {
    var el = document.createElement('div');
    var b = document.createElement('strong');
    b.textContent = name;
    el.appendChild(b);
    if (title && title !== name) {
      var sub = document.createElement('div');
      sub.className = 'geo-tip-sub';
      sub.textContent = title;
      el.appendChild(sub);
    }
    return el;
  }

  function attributionNode() {
    var el = document.createElement('div');
    el.className = 'geo-map-attrib';
    var parts = [
      ['Map: ', 'Digital Atlas of the Roman Empire', 'https://dh.gu.se/dare/', ' (CC BY 4.0)'],
      ['Places: ', 'Pleiades', 'https://pleiades.stoa.org', ' (CC BY)'],
      ['Roads: ', 'Itiner-e', 'https://itiner-e.org', ' (CC BY 4.0)'],
    ];
    parts.forEach(function (p, i) {
      if (i) el.appendChild(document.createTextNode(' · '));
      el.appendChild(document.createTextNode(p[0]));
      var a = document.createElement('a');
      a.href = p[2];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = p[1];
      el.appendChild(a);
      el.appendChild(document.createTextNode(p[3]));
    });
    return el;
  }

  function accentColor() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      return v || '#5C1A28';
    } catch (e) { return '#5C1A28'; }
  }

  function summary(m) {
    var bits = [];
    if (m.places.length) bits.push(m.places.length + (m.places.length === 1 ? ' place' : ' places'));
    if (m.roads.length)  bits.push(m.roads.length + (m.roads.length === 1 ? ' road' : ' roads'));
    return bits.join(', ');
  }

  // ── Attach a map under an answer ──────────────────────────────────────────
  function attach(body, rawMap) {
    var m = cleanMap(rawMap);
    if (!body || !m) return;

    var wrap = document.createElement('div');
    wrap.className = 'geo-map-wrap';

    var head = document.createElement('div');
    head.className = 'geo-map-head';
    var label = document.createElement('span');
    label.className = 'geo-map-label';
    label.textContent = 'Map · ' + summary(m);
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'geo-map-toggle';
    head.appendChild(label);
    head.appendChild(toggle);

    var frame = document.createElement('div');
    frame.className = 'geo-map-frame';
    var canvas = document.createElement('div');
    canvas.className = 'geo-map';
    frame.appendChild(canvas);
    frame.appendChild(attributionNode());

    wrap.appendChild(head);
    wrap.appendChild(frame);

    // Under the answer text, above the provenance caption when there is one.
    var src = body.querySelector('.ucp-src');
    if (src) body.insertBefore(wrap, src); else body.appendChild(wrap);

    var targets = [];
    m.places.forEach(function (p, i) { targets.push({ name: p.name, kind: 'place', idx: i }); });
    m.roads.forEach(function (r, i)  { targets.push({ name: r.name, kind: 'road',  idx: i }); });
    linkNames(body, targets, wrap);

    var lmap = null, markers = [], roadBounds = [], building = null;

    function build() {
      if (lmap) return Promise.resolve(lmap);
      if (building) return building;
      building = loadLeaflet().then(function (L) {
        lmap = L.map(canvas, {
          minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
          attributionControl: false,   // attribution is the line under the map
          scrollWheelZoom: false,      // don't hijack the panel's scrolling
          worldCopyJump: false,
        });
        var tiles = L.tileLayer(TILE_URL, { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, maxNativeZoom: 11 });
        // A tile that fails (offline, outside the atlas) just stays blank —
        // pins and roads still show on the parchment background.
        tiles.on('tileerror', function (e) { if (e && e.tile) e.tile.style.visibility = 'hidden'; });
        tiles.addTo(lmap);

        var accent = accentColor();
        var all = [];

        m.roads.forEach(function (r, i) {
          var b = null;
          r.lines.forEach(function (ln) {
            var pl = L.polyline(ln.coords, {
              color: accent, weight: 3, opacity: 0.8,
              dashArray: ln.c === 'Hypothetical' ? '5 6' : null,
            }).addTo(lmap);
            pl.bindTooltip(tooltipNode(r.name, r.title), { sticky: true, className: 'geo-tip' });
            b = b ? b.extend(pl.getBounds()) : L.latLngBounds(pl.getBounds().getSouthWest(), pl.getBounds().getNorthEast());
          });
          roadBounds[i] = b;
          if (b) { all.push(b.getSouthWest()); all.push(b.getNorthEast()); }
        });

        m.places.forEach(function (p, i) {
          var mk = L.circleMarker([p.lat, p.lon], {
            radius: 6, weight: 2, color: accent, fillColor: '#F1E6CC', fillOpacity: 1,
          }).addTo(lmap);
          mk.bindTooltip(tooltipNode(p.name, p.title), { direction: 'top', offset: [0, -6], className: 'geo-tip' });
          markers[i] = mk;
          all.push(L.latLng(p.lat, p.lon));
        });

        var bounds = L.latLngBounds(all);
        if (all.length === 1) lmap.setView(all[0], 7);
        else lmap.fitBounds(bounds, { padding: [24, 24], maxZoom: FIT_MAX_ZOOM });

        // The panel is resizable — keep Leaflet's idea of its size current.
        if (global.ResizeObserver) {
          new ResizeObserver(function () { if (lmap) lmap.invalidateSize(); }).observe(canvas);
        }
        return lmap;
      }).catch(function () {
        building = null;
        frame.classList.add('geo-map-failed');
        return null;
      });
      return building;
    }

    function setHidden(hidden) {
      frame.style.display = hidden ? 'none' : '';
      toggle.textContent  = hidden ? 'Show map' : 'Hide map';
      toggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      if (!hidden) build().then(function (map) { if (map) map.invalidateSize(); });
    }

    toggle.addEventListener('click', function () {
      var hide = frame.style.display !== 'none';
      setPrefHidden(hide);
      setHidden(hide);
    });

    function focusTarget(kind, idx) {
      if (frame.style.display === 'none') { setPrefHidden(false); setHidden(false); }
      build().then(function (map) {
        if (!map) return;
        if (kind === 'place' && markers[idx]) {
          var ll = markers[idx].getLatLng();
          markers[idx].openTooltip();
          map.flyTo(ll, Math.max(map.getZoom(), 7), { duration: 0.6 });
          map.once('moveend', function () { markers[idx].openTooltip(); });
        } else if (kind === 'road' && roadBounds[idx]) {
          map.flyToBounds(roadBounds[idx], { padding: [20, 20], maxZoom: FIT_MAX_ZOOM, duration: 0.6 });
        }
      });
    }

    function onLink(e) {
      var t = e.target.closest && e.target.closest('.geo-place-link');
      if (!t || !body.contains(t)) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      focusTarget(t.getAttribute('data-geo-kind'), parseInt(t.getAttribute('data-geo-idx'), 10));
    }
    body.addEventListener('click', onLink);
    body.addEventListener('keydown', onLink);

    setHidden(prefHidden());
  }

  global.IronInkGeoMap = { attach: attach };
})(window);
