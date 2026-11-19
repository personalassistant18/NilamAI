// Nilam - osm.js
// Reads a plot's surroundings from OpenStreetMap (the free, volunteer-made world
// map) through the Overpass API, and finds places by name through Nominatim.

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// One request asks for everything near the plot that can affect land value.
export function buildQuery(lat, lon) {
  const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return `[out:json][timeout:40];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link)$"](around:3000,${at});
  way["highway"~"^(residential|unclassified|living_street|service|road)$"](around:300,${at});
  way["highway"~"^(construction|proposed)$"](around:5000,${at});
)->.roads;
.roads out tags geom;
(
  nwr["shop"](around:1000,${at});
  nwr["amenity"~"^(school|college|university|kindergarten)$"](around:2000,${at});
  nwr["amenity"~"^(hospital|clinic|doctors|pharmacy)$"](around:2000,${at});
  nwr["amenity"~"^(bank|atm)$"](around:2000,${at});
  nwr["amenity"="bus_station"](around:10000,${at});
  node["highway"="bus_stop"](around:1500,${at});
  nwr["railway"="station"](around:15000,${at});
  nwr["landuse"~"^(construction|industrial)$"](around:3000,${at});
  node["place"~"^(city|town)$"](around:60000,${at});
);
out tags center;`;
}

// Ask the public Overpass servers in turn until one answers.
export async function fetchSurroundings(lat, lon) {
  const body = `data=${encodeURIComponent(buildQuery(lat, lon))}`;
  let lastError = null;
  for (const url of OVERPASS_SERVERS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
      });
      if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
      const json = await res.json();
      if (!Array.isArray(json.elements)) throw new Error('unexpected reply');
      return json.elements;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not reach the OpenStreetMap servers (${lastError ? lastError.message : 'no reply'}). Check your internet and try again in a minute.`);
}

// Search a place by name, limited to India
export async function searchPlace(text) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('Place search is not available right now.');
  const rows = await res.json();
  return rows.map((r) => ({ name: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}
