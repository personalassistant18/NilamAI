// Nilam - features.js
// Turns raw OpenStreetMap elements into plain measurements about one plot:
// how far the town centre is, how far the nearest main road is, how many shops
// are within 1 km, and so on. Pure logic: easy to test without the internet.

const MAJOR = /^(motorway|trunk|primary)(_link)?$/;
const OTHER = /^(secondary|tertiary)(_link)?$/;
const MINOR = /^(residential|unclassified|living_street|service|road)$/;
const UPCOMING = /^(construction|proposed)$/;

// Around one plot the Earth is almost flat, so we convert latitude/longitude
// to metres east (x) and north (y) of the plot. Accurate to well under 1% here.
function toMetres(lat0, lon0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  return (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
}

// Shortest distance from the plot (at 0,0) to the straight segment A-B
function distanceToSegment(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function extractFeatures(lat, lon, elements) {
  const xy = toMetres(lat, lon);
  const distTo = (la, lo) => Math.hypot(...xy(la, lo));
  const wayDistance = (way) => {
    const pts = way.geometry.map((g) => xy(g.lat, g.lon));
    if (pts.length === 1) return Math.hypot(...pts[0]);
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      best = Math.min(best, distanceToSegment(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    }
    return best;
  };
  const position = (e) => (e.type === 'node' ? [e.lat, e.lon] : e.center ? [e.center.lat, e.center.lon] : null);
  const label = (t) => t.name || t.ref || null;

  const f = {
    lat, lon,
    majorRoad: { m: null, name: null }, // motorway / trunk (national highway) / primary
    otherRoad: { m: null, name: null }, // secondary / tertiary
    anyRoadM: null,                     // nearest road of any kind = road access
    shops: 0, schools: 0, health: 0, banks: 0, busStops: 0,
    nearestSchoolM: null, nearestHealthM: null,
    busStation: { km: null, name: null },
    railway: { km: null, name: null },
    upcoming: { roads: 0, sites: 0, nearestKm: null },
    industrialKm: null,
    town: null, // nearest city or town centre
    city: null, // nearest city
    poiCount: 0,
    layers: { major: [], minor: [], upcoming: [], pois: [] },
  };
  const closer = (cur, value) => (cur === null || value < cur ? value : cur);

  for (const e of elements) {
    const t = e.tags || {};
    if (e.type === 'way' && Array.isArray(e.geometry) && t.highway) {
      const d = wayDistance(e);
      const line = e.geometry.map((g) => [g.lat, g.lon]);
      if (MAJOR.test(t.highway)) {
        if (f.majorRoad.m === null || d < f.majorRoad.m) f.majorRoad = { m: d, name: label(t) };
        f.layers.major.push(line);
      } else if (OTHER.test(t.highway)) {
        if (f.otherRoad.m === null || d < f.otherRoad.m) f.otherRoad = { m: d, name: label(t) };
        f.layers.major.push(line);
      } else if (MINOR.test(t.highway)) {
        f.layers.minor.push(line);
      } else if (UPCOMING.test(t.highway)) {
        f.upcoming.roads += 1;
        f.upcoming.nearestKm = closer(f.upcoming.nearestKm, d / 1000);
        f.layers.upcoming.push(line);
        continue; // not an existing road
      }
      f.anyRoadM = closer(f.anyRoadM, d);
      continue;
    }

    const p = position(e);
    if (!p) continue;
    const d = distTo(p[0], p[1]);
    let kind = null;
    if (t.place === 'city' || t.place === 'town') {
      const c = { name: t.name || 'Unnamed', kind: t.place, km: d / 1000, lat: p[0], lon: p[1] };
      if (!f.town || c.km < f.town.km) f.town = c;
      if (t.place === 'city' && (!f.city || c.km < f.city.km)) f.city = c;
      continue;
    }
    if (t.shop && d <= 1000) { f.shops += 1; kind = 'shop'; }
    else if (/^(school|college|university|kindergarten)$/.test(t.amenity || '')) {
      if (d <= 2000) f.schools += 1;
      f.nearestSchoolM = closer(f.nearestSchoolM, d);
      kind = 'school';
    } else if (/^(hospital|clinic|doctors|pharmacy)$/.test(t.amenity || '')) {
      if (d <= 2000) f.health += 1;
      f.nearestHealthM = closer(f.nearestHealthM, d);
      kind = 'health';
    } else if (/^(bank|atm)$/.test(t.amenity || '')) {
      if (d <= 2000) f.banks += 1;
      kind = 'bank';
    } else if (t.amenity === 'bus_station') {
      if (f.busStation.km === null || d / 1000 < f.busStation.km) f.busStation = { km: d / 1000, name: label(t) };
      kind = 'transport';
    } else if (t.highway === 'bus_stop') {
      if (d <= 1500) f.busStops += 1;
      kind = 'transport';
    } else if (t.railway === 'station') {
      if (f.railway.km === null || d / 1000 < f.railway.km) f.railway = { km: d / 1000, name: label(t) };
      kind = 'transport';
    } else if (t.landuse === 'construction') {
      if (d <= 3000) f.upcoming.sites += 1;
      f.upcoming.nearestKm = closer(f.upcoming.nearestKm, d / 1000);
      kind = 'upcoming';
    } else if (t.landuse === 'industrial') {
      f.industrialKm = closer(f.industrialKm, d / 1000);
      kind = 'industrial';
    }
    if (kind) {
      f.poiCount += 1;
      if (d <= 2500) f.layers.pois.push({ lat: p[0], lon: p[1], kind, name: t.name || null });
    }
  }
  return f;
}
