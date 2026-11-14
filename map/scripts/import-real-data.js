// Bounded verification/import: six actual point samples and two display tiles.
import { writeFile } from 'node:fs/promises';
import { createMapServer } from '../server/index.js';
import { closeEcoregions } from '../server/ecoregions.js';
const app = await createMapServer();
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const locations = [
  { name: 'Cherkasy city', lat: 49.44, lng: 32.06 },
  { name: 'Dnipro reservoir', lat: 49.5, lng: 32.15 },
  { name: 'Cherkasy forest', lat: 49.47, lng: 31.9 },
  { name: 'Askania Nova', lat: 46.45, lng: 33.87 },
  { name: 'Askania grassland', lat: 46.456, lng: 33.9 },
  { name: 'Cherkasy cropland', lat: 49.3, lng: 31.9 },
];
const evidence = { retrievedAt: new Date().toISOString(), synthetic: false, samples: [], tiles: [] };
try {
  for (const location of locations) {
    const response = await fetch(`${base}/api/sample?lat=${location.lat}&lng=${location.lng}`);
    if (!response.ok) throw new Error(`Sample HTTP ${response.status}`);
    const sample = await response.json(); evidence.samples.push({ name: location.name, ...sample });
    console.log(location.name, sample.landCover?.className, sample.ecoregion?.name, sample.errors);
    if (!sample.landCover) throw new Error(`Missing actual WorldCover sample: ${location.name}`);
  }
  for (const tile of [{ z: 10, x: 603, y: 349 }, { z: 10, x: 608, y: 362 }]) {
    const path = `/api/tiles/landcover/${tile.z}/${tile.x}/${tile.y}.png`;
    const response = await fetch(base + path);
    if (!response.ok) throw new Error(`Tile HTTP ${response.status}`);
    evidence.tiles.push({ ...tile, path, bytes: (await response.arrayBuffer()).byteLength, source: response.headers.get('x-map-source') });
  }
  await writeFile(new URL('../db/verified-real-sources.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  console.log('Retained source evidence in db/verified-real-sources.json');
} finally { await app.close(); await closeEcoregions(); }
