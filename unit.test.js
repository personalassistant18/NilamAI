// Automated checks. Run:  node --test unit.test.js
// Uses the made-up town in synthetic-osm.js, so no internet is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFeatures } from './features.js';
import { locationScore } from './score.js';
import { estimate, fitRidge, leaveOneOut, similarPlots, UNITS, vectorOf, rupees } from './valuation.js';
import { syntheticElements, syntheticPrice, TEST_CENTRE } from './synthetic-osm.js';
import { buildQuery } from './osm.js';

const analyse = (lat, lon) => extractFeatures(lat, lon, syntheticElements(lat, lon));

test('features: distance to the highway is measured correctly', () => {
  const f = analyse(10.8, 78.65); // 0.005° north of the highway = about 553 m
  assert.ok(Math.abs(f.majorRoad.m - 553) < 15, `got ${f.majorRoad.m}`);
  assert.equal(f.majorRoad.name, 'Test Highway');
});

test('features: centre plots have more amenities than outskirts', () => {
  const centre = analyse(TEST_CENTRE.lat + 0.002, TEST_CENTRE.lon + 0.002);
  const far = analyse(10.9, 78.62);
  assert.ok(centre.shops > far.shops);
  assert.ok(centre.town.km < far.town.km || centre.town.name !== far.town.name);
  assert.ok(centre.anyRoadM < 50, 'centre plot has road access');
});

test('features: upcoming bypass is detected nearby', () => {
  const f = analyse(10.83, 78.7);
  assert.ok(f.upcoming.roads >= 1);
  assert.ok(f.upcoming.nearestKm < 2);
});

test('score: a central plot scores higher than a remote one, and parts add up', () => {
  const a = locationScore(analyse(TEST_CENTRE.lat + 0.002, TEST_CENTRE.lon + 0.002));
  const b = locationScore(analyse(10.92, 78.6));
  assert.ok(a.score > b.score + 20, `${a.score} vs ${b.score}`);
  const sum = a.parts.reduce((s, p) => s + p.points, 0);
  assert.ok(Math.abs(sum - a.score) < 1e-9);
  assert.ok(a.score <= 100 && b.score >= 0);
});

function comparables(points) {
  return points.map(([lat, lng], i) => {
    const f = extractFeatures(lat, lng, syntheticElements(lat, lng));
    return { id: `c${i}`, lat, lng, vector: vectorOf(f), pricePerSqft: syntheticPrice(lat, lng) };
  });
}
const GRID = [];
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) GRID.push([10.77 + i * 0.025, 78.64 + j * 0.03]);

test('valuation: identical neighbour gives its own price', () => {
  const [c] = comparables([[10.81, 78.7]]);
  const r = similarPlots({ ...c }, [c]);
  assert.ok(Math.abs(r.perSqft - c.pricePerSqft) < 1e-6);
});

test('valuation: learned factors predict unseen plots in the made-up town', () => {
  const comps = comparables(GRID);
  const ridge = leaveOneOut(comps, 'ridge');
  const knn = leaveOneOut(comps, 'knn');
  assert.ok(ridge.typical < 0.3, `ridge typical error ${ridge.typical}`);
  assert.ok(knn.typical < 0.5, `knn typical error ${knn.typical}`);
  const target = comparables([[10.8, 78.69]])[0];
  const est = estimate(target, comps);
  assert.ok(est.learned, 'learned factors used with 16 comparables');
  assert.ok(est.low < target.pricePerSqft * 1.5 && est.high > target.pricePerSqft * 0.6);
});

test('valuation: few comparables give a rough range; none gives no estimate', () => {
  const comps = comparables(GRID.slice(0, 2));
  assert.equal(estimate(comps[0], []), null);
  const e = estimate(comparables([[10.8, 78.69]])[0], comps);
  assert.equal(e.rough, true);
  assert.ok(e.high / e.low > 1.9);
});

test('ridge: recovers a clean straight-line relationship', () => {
  const comps = Array.from({ length: 12 }, (_, i) => ({ vector: [i, 0, 0, 0, 0, 0, 0, 0], pricePerSqft: Math.exp(5 + 0.2 * i) }));
  const m = fitRidge(comps, 1e-6);
  assert.ok(Math.abs(Math.log(m.predict([6, 0, 0, 0, 0, 0, 0, 0])) - (5 + 1.2)) < 1e-3);
});

test('units and rupee formatting', () => {
  assert.equal(UNITS.cent.sqft, 435.6);
  assert.equal(UNITS.ground.sqft, 2400);
  assert.equal(rupees(1234567), '₹12.3 lakh');
  assert.equal(rupees(25000000), '₹2.50 crore');
  assert.equal(rupees(2450), '₹2,450');
});

test('query asks OpenStreetMap for roads, amenities and towns around the plot', () => {
  const q = buildQuery(10.8, 78.69);
  for (const part of ['around:3000,10.800000,78.690000', '"shop"', 'bus_stop', 'railway', 'place', 'out tags geom', 'out tags center']) {
    assert.ok(q.includes(part), part);
  }
});

import { parseCoordinates, linkFragment } from './coords.js';

test('coordinates: decimal, degrees-minutes-seconds and Google Maps links', () => {
  const near = (p, lat, lng) => p && Math.abs(p.lat - lat) < 1e-4 && Math.abs(p.lng - lng) < 1e-4;
  assert.ok(near(parseCoordinates('10.8050, 78.6856'), 10.805, 78.6856));
  assert.ok(near(parseCoordinates('10.8050 78.6856'), 10.805, 78.6856));
  assert.ok(near(parseCoordinates('10°48\'18.0"N 78°41\'08.2"E'), 10.805, 78.68561));
  assert.ok(near(parseCoordinates('https://www.google.com/maps/place/Rockfort/@10.8279,78.6970,17z/data=!3m1'), 10.8279, 78.697));
  assert.ok(near(parseCoordinates('https://maps.google.com/?q=10.8279,78.6970'), 10.8279, 78.697));
  assert.ok(near(parseCoordinates('https://www.google.com/maps/place/X/data=!4m6!3m5!1s0x0!8m2!3d10.8279!4d78.697'), 10.8279, 78.697));
  assert.equal(parseCoordinates('Thillai Nagar, Trichy'), null);
  assert.equal(parseCoordinates('620017'), null);
  assert.equal(parseCoordinates('95.0, 78.0'), null); // latitude out of range
  assert.equal(linkFragment({ lat: 10.805, lng: 78.6856 }), '10.805000,78.685600');
});
