// Nilam - app.js
// Connects the pieces: pick a plot -> read its surroundings -> score -> estimate the price.

import { fetchSurroundings, searchPlace } from './osm.js';
import { extractFeatures } from './features.js';
import { FACTORS, locationScore } from './score.js';
import { estimate, fitRidge, leaveOneOut, MODEL_FEATURES, rupees, UNITS, vectorOf } from './valuation.js';
import { download, loadState, saveState } from './store.js';
import { inIndia, linkFragment, parseCoordinates } from './coords.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const PLURAL = { sqft: 'sq ft', cent: 'cents', ground: 'grounds', acre: 'acres', sqm: 'sq m' };

let state = loadState();
let mapView = null;
let pick = null;    // the plot chosen on the map { lat, lng }
let current = null; // the analysed plot { lat, lng, features, score, vector }

// ------------------------------------------------------------------ tabs
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === b.dataset.tab));
  if (b.dataset.tab === 'analyse' && mapView) mapView.refresh();
  if (b.dataset.tab === 'how') renderLearned();
}));

// ------------------------------------------------------------------ map (loaded separately so search still works without it)
const mapReady = import('./map.js')
  .then((m) => {
    mapView = m.createMap($('mapbox'), { onPick });
    mapView.showKnownPrices(state.comps, (c) => rupees(c.pricePerSqft));
  })
  .catch(() => {
    $('mapbox').innerHTML = '<p class="map-error">The map could not load (no internet?). You can still search a place or use your location.</p>';
  });

function onPick(lat, lng) {
  pick = { lat, lng };
  $('btn-analyse').disabled = false;
  setStatus(`Plot chosen at ${lat.toFixed(5)}, ${lng.toFixed(5)}. Tap "Analyse this plot".`);
}

function goToPlot(lat, lng, zoom) {
  if (mapView) { mapView.goTo(lat, lng, zoom); mapView.place(lat, lng); } else onPick(lat, lng);
}

// ------------------------------------------------------------------ search and location
$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('search-text').value.trim();
  if (!q) return;
  const box = $('search-results');
  const point = parseCoordinates(q); // coordinates or a Google Maps link: go straight there
  if (point) {
    box.innerHTML = inIndia(point) ? '' : '<p class="hint">Note: these coordinates are outside India.</p>';
    goToPlot(point.lat, point.lng, 17);
    return;
  }
  box.innerHTML = '<p class="hint">Searching…</p>';
  try {
    const rows = await searchPlace(q);
    box.innerHTML = rows.length
      ? rows.map((r, i) => `<button class="result" data-i="${i}">${escapeHtml(r.name)}</button>`).join('')
      : '<p class="hint">No places found. Try another spelling or a nearby landmark.</p>';
    box.querySelectorAll('.result').forEach((b) => b.addEventListener('click', () => {
      const r = rows[Number(b.dataset.i)];
      box.innerHTML = '';
      goToPlot(r.lat, r.lng, 16);
    }));
  } catch (err) {
    box.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
  }
});

$('btn-gps').addEventListener('click', () => {
  if (!navigator.geolocation) { setStatus('Location is not available on this device.', 'error'); return; }
  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    (p) => goToPlot(p.coords.latitude, p.coords.longitude, 17),
    (err) => setStatus(`Could not get your location: ${err.message}`, 'error'),
    { enableHighAccuracy: true, timeout: 20000 },
  );
});

// ------------------------------------------------------------------ analyse
$('btn-analyse').addEventListener('click', analysePlot);

async function analysePlot() {
  if (!pick) return;
  const { lat, lng } = pick;
  $('btn-analyse').disabled = true;
  const t0 = Date.now();
  const say = () => setStatus(`Reading roads, shops and services around this plot from OpenStreetMap… ${Math.round((Date.now() - t0) / 1000)} s`);
  say();
  const timer = setInterval(say, 1000);
  try {
    const elements = await fetchSurroundings(lat, lng);
    const features = extractFeatures(lat, lng, elements);
    current = { lat, lng, features, score: locationScore(features), vector: vectorOf(features) };
    if (mapView) mapView.showSurroundings(features);
    clearInterval(timer);
    setStatus(`Done in ${Math.round((Date.now() - t0) / 1000)} s: ${features.poiCount} mapped places and ${features.layers.major.length + features.layers.minor.length} roads found nearby.`, 'ok');
    renderResults();
    $('results').hidden = false;
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${linkFragment({ lat, lng })}`); // the address bar now links to this plot
  } catch (err) {
    clearInterval(timer);
    setStatus(err.message, 'error');
  } finally {
    $('btn-analyse').disabled = false;
  }
}

// Share: a link that opens Nilam on this exact plot and analyses it
$('btn-share').addEventListener('click', async () => {
  if (!current) return;
  const url = `${location.origin}${location.pathname}#${linkFragment(current)}`;
  try {
    await navigator.clipboard.writeText(url);
    $('share-note').textContent = 'Link copied. Anyone who opens it sees this plot analysed.';
  } catch (_) {
    $('share-note').textContent = url; // copying not allowed here: show the link to copy by hand
  }
});

function renderResults() {
  const { score, features } = current;
  $('score').textContent = Math.round(score.score);
  $('grade').textContent = score.grade;
  $('score-fill').style.width = `${score.score}%`;
  $('factors').innerHTML = score.parts.map((p) =>
    `<div class="factor"><div class="f-head"><span>${p.label}</span><b>${p.points.toFixed(1)} / ${p.max}</b></div>` +
    `<div class="f-bar"><i style="width:${(p.points / p.max) * 100}%"></i></div>` +
    `<div class="f-detail">${escapeHtml(p.detail)}</div></div>`).join('');
  $('data-note').textContent = `Surroundings from OpenStreetMap: ${features.poiCount} mapped places nearby. ` +
    'Volunteer maps can miss shops and services, especially in smaller towns.';
  renderEstimate();
}

// ------------------------------------------------------------------ price estimate
Object.entries(UNITS).forEach(([key, u]) => $('plot-unit').insertAdjacentHTML('beforeend', `<option value="${key}">${PLURAL[key] || u.label}</option>`));
$('plot-size').addEventListener('input', renderEstimate);
$('plot-unit').addEventListener('change', renderEstimate);

function renderEstimate() {
  if (!current) return;
  const comps = state.comps;
  const box = $('estimate');
  if (!comps.length) {
    box.innerHTML = '<p class="hint">No known prices yet, so there is no price estimate. If you know this plot\'s price, add it below. Add prices for a few other plots too: with 6 or more, the AI learns your area.</p>';
    return;
  }
  const est = estimate(current, comps);
  const size = Number($('plot-size').value || 0);
  const unit = $('plot-unit').value;
  const sqft = size * UNITS[unit].sqft;
  const quality = est.rough
    ? 'Rough range (±35%). Add at least 3 known prices for an honest error check.'
    : `Typical error on your known prices: ±${pct(est.error.typical)} (each known price was hidden in turn and predicted from the others).`;
  box.innerHTML =
    `<div class="price">${rupees(est.low)} – ${rupees(est.high)} <span>per sq ft</span></div>` +
    `<p class="hint">Most likely about <b>${rupees(est.perSqft)}</b> per sq ft · method: ${est.method} · from ${comps.length} known price${comps.length === 1 ? '' : 's'}</p>` +
    (sqft > 0 ? `<div class="total">For ${size.toLocaleString('en-IN')} ${PLURAL[unit]}: <b>${rupees(est.low * sqft)} – ${rupees(est.high * sqft)}</b></div>` : '') +
    `<p class="hint">${quality}</p>` +
    '<h3>Most similar known prices</h3>' +
    `<ul class="used">${est.used.map((u) => `<li><b>${pct(u.share)}</b> ${escapeHtml(u.comp.note || 'Known price')} · ${rupees(u.comp.pricePerSqft)}/sq ft · ${escapeHtml(u.comp.source)}</li>`).join('')}</ul>`;
}

// ------------------------------------------------------------------ known prices
$('comp-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!current) return;
  const value = Number($('comp-price').value);
  if (!(value > 0)) return;
  state.comps.push({
    id: `k${state.nextId++}`, lat: current.lat, lng: current.lng,
    pricePerSqft: Math.round((value / UNITS[$('comp-unit').value].sqft) * 100) / 100,
    source: $('comp-source').value, note: $('comp-note').value.trim(),
    date: new Date().toISOString().slice(0, 10), vector: current.vector, score: Math.round(current.score.score),
  });
  saveState(state);
  $('comp-price').value = '';
  $('comp-note').value = '';
  refreshComps();
  setStatus('Known price saved. Pick another plot, or see how the estimate changes.', 'ok');
});

function refreshComps() {
  $('comp-count').textContent = String(state.comps.length);
  $('comp-list').innerHTML = state.comps.length
    ? state.comps.map((c) => `<div class="comp"><div><b>${escapeHtml(c.note || 'Known price')}</b> · ${rupees(c.pricePerSqft)}/sq ft` +
      `<div class="hint">${escapeHtml(c.source)} · score ${c.score} · ${c.date} · ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}</div></div>` +
      `<button class="ghost small" data-del="${c.id}">Delete</button></div>`).join('')
    : '<p class="hint">No known prices yet. Analyse a plot, then use "Know the price of this plot?".</p>';
  if (mapView) mapView.showKnownPrices(state.comps, (c) => rupees(c.pricePerSqft));
  renderEstimate();
  renderLearned();
}

$('comp-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  state.comps = state.comps.filter((c) => c.id !== b.dataset.del);
  saveState(state);
  refreshComps();
});

$('btn-export').addEventListener('click', () => {
  download('nilam-known-prices.json', JSON.stringify({ app: 'Nilam', version: 1, comps: state.comps }, null, 1));
});

$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'Nilam' || !Array.isArray(data.comps)) throw new Error('not a Nilam file');
    for (const c of data.comps) {
      if (typeof c.pricePerSqft === 'number' && Array.isArray(c.vector) && c.vector.length === MODEL_FEATURES.length) {
        state.comps.push({ ...c, id: `k${state.nextId++}` });
      }
    }
    saveState(state);
    refreshComps();
    $('prices-note').textContent = `Loaded. You now have ${state.comps.length} known prices.`;
  } catch (err) {
    $('prices-note').textContent = `Could not load that file (${err.message}).`;
  }
});

// ------------------------------------------------------------------ how it works
$('weights').innerHTML = FACTORS.map((f) =>
  `<div class="factor"><div class="f-head"><span>${f.label}</span><b>${f.weight} points</b></div>` +
  `<div class="f-bar"><i style="width:${f.weight * 4}%"></i></div></div>`).join('');

function renderLearned() {
  const comps = state.comps;
  if (comps.length < 6) {
    $('learned').innerHTML = `<p class="hint">Add at least 6 known prices from different areas (you have ${comps.length}). Then the AI learns which factors move prices in your area.</p>`;
    return;
  }
  const model = fitRidge(comps);
  const ridgeErr = leaveOneOut(comps, 'ridge');
  const knnErr = leaveOneOut(comps, 'knn');
  const maxB = Math.max(...model.beta.map(Math.abs), 1e-9);
  $('learned').innerHTML = `<p class="hint">Trained on ${comps.length} known prices. Longer bar = stronger effect on price in your area.</p>` +
    MODEL_FEATURES.map((f, i) => ({ f, b: model.beta[i] }))
      .sort((a, b) => Math.abs(b.b) - Math.abs(a.b))
      .map(({ f, b }) => `<div class="learned-row"><span>${f.label}: more → <b class="${b >= 0 ? 'up' : 'down'}">${b >= 0 ? 'higher' : 'lower'} price</b></span>` +
        `<i class="${b >= 0 ? 'up' : 'down'}" style="width:${Math.round((Math.abs(b) / maxB) * 100)}%"></i></div>`).join('') +
    `<p class="hint">Honest check (each known price hidden in turn): learned factors ±${pct(ridgeErr.typical)} typical error, similar plots ±${pct(knnErr.typical)}. Estimates use whichever is more accurate.</p>`;
}

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

// ------------------------------------------------------------------ start
if (location.hostname.endsWith('.github.io')) {
  $('repo-link').href = `https://github.com/${location.hostname.split('.')[0]}/${location.pathname.split('/')[1] || ''}`;
}
refreshComps();
const shared = parseCoordinates(decodeURIComponent(location.hash.slice(1)));
if (shared) {
  mapReady.finally(() => { goToPlot(shared.lat, shared.lng, 16); analysePlot(); });
}
// For tests and curious developers: Nilam.pick(lat, lng) chooses a plot like a tap on the map
window.Nilam = { getState: () => state, getCurrent: () => current, pick: (lat, lng) => goToPlot(lat, lng, 15) };
