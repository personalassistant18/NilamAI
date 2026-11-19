// Nilam - synthetic-osm.js  (TEST HELPER ONLY)
// A made-up town ("Testpuram") that answers like the Overpass API does, so the
// app can be tested without internet. None of this is real map or price data.

export const TEST_CENTRE = { lat: 10.805, lon: 78.69 };

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const kmBetween = (a, b) => Math.hypot((a.lat - b.lat) * 110.574, (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180));

export function syntheticElements(lat, lon) {
  const rand = rng(Math.round(lat * 1e4) * 31 + Math.round(lon * 1e4));
  const d = kmBetween({ lat, lon }, TEST_CENTRE); // km from the made-up town centre
  const out = [];
  let id = 1;
  const line = (tags, pts) => out.push({ type: 'way', id: id++, tags, geometry: pts.map(([la, lo]) => ({ lat: la, lon: lo })) });
  const scatter = (n, radiusM, tags) => {
    for (let i = 0; i < n; i++) {
      const r = radiusM * Math.sqrt(rand());
      const a = 2 * Math.PI * rand();
      out.push({ type: 'node', id: id++, lat: lat + (r * Math.sin(a)) / 110574, lon: lon + (r * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), tags });
    }
  };
  // A national highway running east-west and a secondary road running north-south
  line({ highway: 'trunk', ref: 'NH 38', name: 'Test Highway' }, Array.from({ length: 21 }, (_, i) => [10.795, 78.6 + i * 0.01]));
  line({ highway: 'secondary', name: 'Test Main Road' }, Array.from({ length: 21 }, (_, i) => [10.7 + i * 0.01, 78.7]));
  // Planned bypass north of town
  line({ highway: 'construction', construction: 'trunk', name: 'Test Bypass (under construction)' }, [[10.84, 78.66], [10.84, 78.74]]);
  // Streets: dense near the centre, sparse far away
  if (d < 4) line({ highway: 'residential' }, [[lat + 0.0003, lon - 0.002], [lat + 0.0003, lon + 0.002]]);
  else if (d < 8) line({ highway: 'unclassified' }, [[lat + 0.0015, lon - 0.002], [lat + 0.0015, lon + 0.002]]);
  // Amenities thin out with distance from the centre
  scatter(Math.round(80 * Math.exp(-d / 2.5)), 1000, { shop: 'convenience' });
  scatter(Math.round(10 * Math.exp(-d / 5)), 2000, { amenity: 'school' });
  scatter(Math.round(8 * Math.exp(-d / 4)), 2000, { amenity: 'clinic' });
  scatter(Math.round(10 * Math.exp(-d / 3)), 2000, { amenity: 'bank' });
  scatter(Math.round(12 * Math.exp(-d / 3)), 1500, { highway: 'bus_stop' });
  out.push({ type: 'node', id: id++, lat: TEST_CENTRE.lat, lon: TEST_CENTRE.lon, tags: { place: 'city', name: 'Testpuram' } });
  out.push({ type: 'node', id: id++, lat: 10.9, lon: 78.8, tags: { place: 'town', name: 'Smallur' } });
  out.push({ type: 'node', id: id++, lat: 10.8, lon: 78.68, tags: { railway: 'station', name: 'Testpuram Junction' } });
  out.push({ type: 'node', id: id++, lat: TEST_CENTRE.lat + 0.001, lon: TEST_CENTRE.lon, tags: { amenity: 'bus_station', name: 'Testpuram Bus Stand' } });
  return out;
}

// A made-up "true" price: falls with distance from the centre, rises near the highway (test only)
export function syntheticPrice(lat, lon) {
  const d = kmBetween({ lat, lon }, TEST_CENTRE);
  const highwayM = Math.abs(lat - 10.795) * 110574;
  return Math.round(400 + 3200 * Math.exp(-d / 4) + 600 * Math.exp(-highwayM / 600));
}
