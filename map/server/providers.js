import { createHash } from 'node:crypto';
import { fromCustomClient } from 'geotiff';
import { ByteLRU } from './cache.js';

export const LANDCOVER_SOURCE = {
  provider: 'ESA WorldCover', version: '2021 v200', year: 2021, resolutionM: 10,
  sourceUrl: 'https://esa-worldcover.org/en/data-access', license: 'CC BY 4.0',
  attribution: '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
};
export const LANDCOVER_CLASSES = {
  0: 'No data', 10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland', 40: 'Cropland', 50: 'Built-up',
  60: 'Bare / sparse vegetation', 70: 'Snow and ice', 80: 'Permanent water bodies', 90: 'Herbaceous wetland', 95: 'Mangroves', 100: 'Moss and lichen',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const combinedSignal = (signal, ms = 20000) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
async function boundedBody(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Upstream response exceeds size limit'); }
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > maxBytes) throw new Error('Upstream response exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}
export function landcoverTileUrl({ z, x, y }) {
  const params = new URLSearchParams({ SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0', LAYER: 'esa-worldcover-map-10m-2021-v2_map', STYLE: 'default', FORMAT: 'image/png', TILEMATRIXSET: 'EPSG:3857', TILEMATRIX: String(z), TILECOL: String(x), TILEROW: String(y), TIME: '2021-01-01' });
  return `https://wmts.terrascope.be/wmts?${params}`;
}
export async function fetchLandcoverTile(tile, { signal } = {}) {
  let response;
  try{response = await fetch(landcoverTileUrl(tile), { signal: combinedSignal(signal,12000), headers: { 'User-Agent': 'DryspellMap/1.0 (local environmental map)' } });}
  catch(error){if(signal?.aborted)throw error;throw Object.assign(new Error('WorldCover is temporarily unavailable; retry this tile'),{statusCode:502});}
  if (!response.ok) throw Object.assign(new Error(`WorldCover tile unavailable (HTTP ${response.status})`), { statusCode: response.status === 429 ? 503 : 502 });
  const png = await boundedBody(response, 1024 * 1024);
  if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) throw new Error('WorldCover returned an invalid 256px PNG');
  return png;
}
export function cogUrl(lat, lng) {
  const south = Math.floor(lat / 3) * 3, west = Math.floor(lng / 3) * 3;
  const name = `${south >= 0 ? 'N' : 'S'}${String(Math.abs(south)).padStart(2, '0')}${west >= 0 ? 'E' : 'W'}${String(Math.abs(west)).padStart(3, '0')}`;
  return `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`;
}
export function createProviders(storage) {
  const ranges = new ByteLRU(16 * 1024 * 1024);
  const records = new Map();
  const remember = (key, value) => { if (records.size >= 512) records.delete(records.keys().next().value); records.set(key, value); };
  async function readRecord(key) {
    const local = records.get(key);
    if (local && (!local.expiresAt || Date.parse(local.expiresAt) > Date.now())) return local.value;
    const saved = await storage.getRecord(key);
    if (saved) remember(key, saved);
    return saved?.value || null;
  }
  async function saveRecord(key, value, expiresAt = null) { await storage.putRecord(key, value, expiresAt); remember(key, { value, expiresAt }); }
  async function landcover(lat, lng, signal) {
    if (lat < -60 || lat >= 83 || lng >= 180) throw new Error('Outside WorldCover terrestrial coverage');
    const url = cogUrl(lat, lng), key = `worldcover2021:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    const saved = await readRecord(key); if (saved) return saved;
    const requestSignal = combinedSignal(signal, 45000);
    let downloadedBytes = 0;
    const tiff = await fromCustomClient({ url, async request(options = {}) {
      const range = options.headers?.Range || options.headers?.range;
      if (!/^bytes=\d+-\d+$/.test(range || '')) throw new Error('Only bounded single-range COG requests are allowed');
      const [, begin, end] = /bytes=(\d+)-(\d+)/.exec(range);
      if (Number(end) - Number(begin) + 1 > 2 * 1024 * 1024) throw new Error('COG range exceeds 2 MiB limit');
      const rangeKey = `${url}|${range}`;
      let bytes = ranges.get(rangeKey) || await storage.getRange(rangeKey);
      if (!bytes) {
        const response = await fetch(url, { headers: { Range: range }, signal: requestSignal });
        if (response.status !== 206) { await response.body?.cancel(); throw new Error(`WorldCover COG range unavailable (HTTP ${response.status})`); }
        bytes = await boundedBody(response, 2 * 1024 * 1024);
        downloadedBytes += bytes.length;
        if (downloadedBytes > 8 * 1024 * 1024) throw new Error('Point sample exceeded 8 MiB acquisition limit');
        requestSignal.throwIfAborted();
        await storage.putRange(rangeKey, bytes, { ...LANDCOVER_SOURCE, sourceUrl: url, requestRange: range, retrievedAt: new Date().toISOString(), checksum: sha256(bytes) });
      }
      ranges.set(rangeKey, bytes);
      return { status: 206, ok: true, getHeader: name => name.toLowerCase() === 'content-range' ? `bytes ${begin}-${Number(begin) + bytes.length - 1}/*` : undefined,
        getData: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    } }, { allowFullFile: false, maxRanges: 1, blockSize: 65536, cacheSize: 16 }, requestSignal);
    const image = await tiff.getImage(0);
    const origin = image.getOrigin(), resolution = image.getResolution();
    const px = Math.floor((lng - origin[0]) / resolution[0]), py = Math.floor((lat - origin[1]) / resolution[1]);
    if (px < 0 || py < 0 || px >= image.getWidth() || py >= image.getHeight()) throw new Error('Point outside source raster');
    const raster = await image.readRasters({ window: [px, py, px + 1, py + 1], samples: [0], interleave: true, signal: requestSignal });
    const classValue = Number(raster[0]);
    const value = { ...LANDCOVER_SOURCE, source: 'ESA WorldCover', sourceUrl: url, classValue, className: LANDCOVER_CLASSES[classValue] || 'Unknown', retrievedAt: new Date().toISOString(), pixel: [px, py], checksum: sha256(Buffer.from([classValue])), analytical: true };
    requestSignal.throwIfAborted(); await saveRecord(key, value);
    return value;
  }
  async function weather(lat, lng, signal) {
    const latitude = Math.round(lat * 50) / 50, longitude = Math.round(lng * 50) / 50;
    const key = `openmeteo:current:${latitude}:${longitude}`;
    const saved = await readRecord(key); if (saved) return saved;
    const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m', wind_speed_unit: 'ms', timezone: 'UTC' });
    const sourceUrl = `https://api.open-meteo.com/v1/forecast?${params}`;
    const response = await fetch(sourceUrl, { signal: combinedSignal(signal, 12000) });
    if (!response.ok) throw new Error(`Weather unavailable (HTTP ${response.status})`);
    const bytes = await boundedBody(response, 256 * 1024), data = JSON.parse(bytes.toString());
    const current = data.current;
    if (!current || typeof current.time !== 'string') throw new Error('Weather response lacks forecast valid time');
    const number = value => Number.isFinite(value) ? value : null;
    const retrievedAt = new Date().toISOString();
    const value = { provider: 'Open-Meteo', kind: 'forecast', sourceUrl, license: 'CC BY 4.0; free hosted API non-commercial use', validAt: `${current.time}Z`, retrievedAt, modelLocation: { lat: data.latitude, lng: data.longitude },
      temperatureC: number(current.temperature_2m), humidityPct: number(current.relative_humidity_2m), windSpeedMs: number(current.wind_speed_10m), windDirectionDeg: number(current.wind_direction_10m), checksum: sha256(bytes), stale: false };
    signal?.throwIfAborted(); await saveRecord(key, value, new Date(Date.now() + 15 * 60 * 1000).toISOString());
    return value;
  }
  return { landcover, weather, stats: () => ({ rangeCache: ranges.stats(), records: records.size }) };
}
