import {apiUrl} from './api.js';
export const MAX_SENSORS = 500;
export const MAX_IMPORT_BYTES = 512 * 1024;
export const STORAGE_KEY = 'dryspell.map.sensors.v1';
export const SENSOR_TYPES = Object.freeze({
  combined: { label: 'Combined', color: '#d7e89a', unit: '' },
  temperature: { label: 'Temperature', color: '#faaf76', unit: '°C' },
  humidity: { label: 'Humidity', color: '#84cbea', unit: '% RH' },
  smoke: { label: 'Smoke', color: '#e5b7c6', unit: '% index' },
  moisture: { label: 'Soil moisture', color: '#89c1ef', unit: '%' },
  wind: { label: 'Wind', color: '#c3b4fa', unit: 'm/s' },
  water: { label: 'Water', color: '#67d8ca', unit: 'm' },
});

export function sensorReadings(sample, type) {
  const definitions = {
    temperature: ['Temperature', 'temperatureC', '°C'],
    humidity: ['Relative humidity', 'humidityPct', '% RH'],
    smoke: ['Smoke response', 'smokePct', '% index'],
    moisture: ['Soil moisture', 'moisture', '%'],
    wind: ['Wind speed', 'windSpeedMs', 'm/s'],
    windDirection: ['Wind from', 'windDirectionDeg', '°'],
    water: ['Water depth', 'waterDepthM', 'm'],
  };
  const channels = type === 'combined' ? ['temperature', 'humidity', 'smoke'] : type === 'wind' ? ['wind', 'windDirection'] : [type];
  return channels.map((channel) => {
    const [label, field, unit] = definitions[channel];
    // A forecast is an environmental baseline, never telemetry from this local object.
    const explicitSimulation = sample.synthetic === true;
    const forecastChannel = ['temperature', 'humidity', 'wind', 'windDirection'].includes(channel);
    const observed = channel === 'smoke' ? explicitSimulation : explicitSimulation || (forecastChannel && sample.weather?.kind === 'forecast');
    const value = observed && Number.isFinite(sample[field]) ? sample[field] : null;
    return { channel, label, value, unit, basis: value === null ? 'No observation' : explicitSimulation ? 'Simulated reading' : 'Forecast baseline' };
  });
}

export function parseSensorPosition(latitude, longitude) {
  if (![latitude, longitude].every((value) => typeof value === 'string' || typeof value === 'number')) throw new Error('Enter valid numeric coordinates.');
  if (String(latitude).trim() === '' || String(longitude).trim() === '') throw new Error('Enter both latitude and longitude.');
  const lat = Number(latitude), lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85.05112878 || Math.abs(lng) > 180) throw new Error('Coordinates are outside the map bounds.');
  return { lat, lng };
}

// Imported values are validated before any existing scene is changed.
export function validateSensors(input) {
  const list = Array.isArray(input) ? input : input?.version === 1 ? input.sensors : null;
  if (!Array.isArray(list)) throw new Error('Expected a Dryspell scene file, version 1.');
  if (list.length > MAX_SENSORS) throw new Error(`A scene can contain up to ${MAX_SENSORS} sensors.`);
  const ids = new Set();
  return list.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid sensor #${index + 1}.`);
    const { id, type, name, lat, lng } = item;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw new Error('Sensor identifiers must be valid and unique.');
    if (!Object.hasOwn(SENSOR_TYPES, type)) throw new Error('Unknown sensor profile.');
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Sensor names must contain 1–80 characters.');
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85.05112878 || Math.abs(lng) > 180) throw new Error('Sensor coordinates are outside the map bounds.');
    ids.add(id);
    return { id, type, name: name.trim(), lat, lng };
  });
}

export function parseSensorFile(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error('File is too large. Maximum size is 512 KB.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Unable to read JSON.'); }
  return validateSensors(parsed);
}

export function serializeSensors(sensors) {
  return JSON.stringify({ version: 1, synthetic: true, sensors: validateSensors(sensors) }, null, 2);
}

export function readSensorStorage(storage) {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    return { sensors: saved ? parseSensorFile(saved) : [], error: null };
  } catch { return { sensors: [], error: 'Unable to restore the local scene. Create a new scene or import JSON.' }; }
}

export function writeSensorStorage(storage, sensors) {
  try { storage.setItem(STORAGE_KEY, serializeSensors(sensors)); return null; }
  catch { return 'This browser could not save the scene. Export JSON to keep your sensors.'; }
}

function drawIcon(ctx, type, x, y, selected) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = selected ? '#f1f7f2' : '#162a2a';
  ctx.strokeStyle = selected ? '#fff' : SENSOR_TYPES[type].color;
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.beginPath(); ctx.arc(0, -4, selected ? 16 : 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = SENSOR_TYPES[type].color;
  ctx.beginPath(); ctx.moveTo(-4, 9); ctx.lineTo(0, 16); ctx.lineTo(4, 9); ctx.fill();
  ctx.strokeStyle = selected ? '#213b37' : SENSOR_TYPES[type].color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (type === 'combined') {
    ctx.beginPath(); ctx.moveTo(-7, -4); ctx.lineTo(7, -4); ctx.moveTo(0, -11); ctx.lineTo(0, 3); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -4, 7, 0, Math.PI * 2); ctx.stroke();
  } else if (type === 'smoke') {
    for (const dx of [-6, 0, 6]) { ctx.beginPath(); ctx.moveTo(dx, 3); ctx.bezierCurveTo(dx - 5, -2, dx + 5, -5, dx, -11); ctx.stroke(); }
  } else if (type === 'temperature') {
    ctx.beginPath(); ctx.arc(0, 1, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-2, -1); ctx.lineTo(-2, -11); ctx.arc(0, -11, 2, Math.PI, 0); ctx.lineTo(2, -1); ctx.stroke();
  } else if (type === 'moisture' || type === 'water' || type === 'humidity') {
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.bezierCurveTo(-12, -1, -3, 6, 0, 3); ctx.bezierCurveTo(8, 3, 7, -4, 0, -12); ctx.stroke();
    if (type === 'water') { ctx.beginPath(); ctx.moveTo(-8, 6); ctx.lineTo(8, 6); ctx.stroke(); }
  } else {
    ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(4, -8); ctx.arc(4, -11, 3, Math.PI / 2, -Math.PI / 2, true); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(8, -3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5, 2); ctx.lineTo(3, 2); ctx.arc(3, 5, 3, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  }
  ctx.restore();
}

export function mountSensors({ map, L, container, onChange = () => {} }) {
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  const restored = readSensorStorage(storage);
  let sensors = restored.sensors;
  let placing = false, selectedId = null, destroyed = false, frame = 0, sampleController = null, moveDraft = null;
  let hitTargets = [];
  container.classList.add('sensor-panel');
  container.innerHTML = `
    <div class="sensor-heading"><h2>Sensors</h2><span class="sensor-count">0 / 500</span></div>
    <p class="sensor-intro">Your local scene. No sign-in required.</p>
    <label class="sensor-label" for="sensor-type">Sensor profile</label>
    <select id="sensor-type">${Object.entries(SENSOR_TYPES).map(([key, value]) => `<option value="${key}">${value.label}</option>`).join('')}</select>
    <button class="sensor-add" type="button" aria-pressed="false">＋ Place on map</button>
    <button class="sensor-at-center" type="button">Add at map center</button>
    <p class="sensor-status" role="status" aria-live="polite"></p>
    <label class="sensor-label" for="sensor-select">My sensors</label>
    <select id="sensor-select" aria-label="Select a sensor"><option value="">No sensors yet</option></select>
    <section class="sensor-detail" aria-label="Sensor inspector" hidden>
      <div class="sensor-detail-heading"><span class="sensor-type-name"></span><span class="sensor-demo">SIMULATED OBJECT</span></div>
      <label class="sensor-label" for="sensor-name">Name</label><input id="sensor-name" maxlength="80" autocomplete="off">
      <p class="sensor-coordinates"></p>
      <dl class="sensor-geography"></dl>
      <div class="sensor-reading" aria-live="polite"></div>
      <p class="sensor-provenance"></p>
      <div class="sensor-detail-actions"><button class="sensor-locate" type="button">Locate ↗</button><button class="sensor-move" type="button">Move</button><button class="sensor-delete" type="button">Delete</button></div>
      <div class="sensor-move-editor" hidden>
        <p>Click the map or edit coordinates, then Save.</p>
        <label class="sensor-label" for="sensor-lat">Latitude</label><input id="sensor-lat" type="number" min="-85.05112878" max="85.05112878" step="any">
        <label class="sensor-label" for="sensor-lng">Longitude</label><input id="sensor-lng" type="number" min="-180" max="180" step="any">
        <div class="sensor-detail-actions"><button class="sensor-move-save" type="button">Save</button><button class="sensor-move-cancel" type="button">Cancel</button></div>
      </div>
    </section>
    <div class="sensor-file-actions"><button class="sensor-export" type="button">Export JSON</button><button class="sensor-import" type="button">Import JSON</button></div>
    <input class="sensor-file" type="file" accept=".json,application/json" hidden>
    <p class="sensor-footnote">Saved in this browser. Import replaces the current scene.</p>`;
  const $ = (selector) => container.querySelector(selector);
  const status = $('.sensor-status');
  const canvas = document.createElement('canvas');
  canvas.className = 'sensor-canvas leaflet-zoom-hide';
  canvas.setAttribute('aria-hidden', 'true');
  map.getContainer().append(canvas);
  const context = canvas.getContext('2d');
  const listeners = [];
  function listen(element, event, handler) { element.addEventListener(event, handler); listeners.push(() => element.removeEventListener(event, handler)); }
  function say(message, error = false) { status.textContent = message; status.classList.toggle('is-error', error); }
  function emit() { onChange({ count: sensors.length, placing, selectedId, moving: Boolean(moveDraft) }); }
  function persist() { const error = writeSensorStorage(storage, sensors); if (error) say(error, true); }
  function updateList() {
    $('.sensor-count').textContent = `${sensors.length} / ${MAX_SENSORS}`;
    const select = $('#sensor-select');
    select.replaceChildren(new Option(sensors.length ? 'Select a sensor' : 'No sensors yet', ''));
    for (const sensor of sensors) select.add(new Option(sensor.name, sensor.id));
    select.value = selectedId ?? '';
    $('.sensor-add').disabled = sensors.length >= MAX_SENSORS;
    $('.sensor-at-center').disabled = sensors.length >= MAX_SENSORS;
    emit();
  }
  function render() {
    frame = 0;
    if (destroyed) return;
    const size = map.getSize();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(size.x * ratio), height = Math.round(size.y * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`; }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.x, size.y);
    hitTargets = [];
    // Only visible sensors are painted. No per-sensor DOM nodes or timers.
    for (const sensor of sensors) {
      const position = sensor.id === selectedId && moveDraft ? moveDraft : sensor;
      const point = map.latLngToContainerPoint([position.lat, position.lng]);
      if (point.x < -20 || point.y < -20 || point.x > size.x + 20 || point.y > size.y + 20) continue;
      drawIcon(context, sensor.type, point.x, point.y, sensor.id === selectedId);
      hitTargets.push({ id: sensor.id, x: point.x, y: point.y - 4 });
    }
  }
  function scheduleRender() { if (!frame) frame = requestAnimationFrame(render); }
  function setPlacement(value) {
    if (value && moveDraft) cancelMove();
    placing = Boolean(value) && sensors.length < MAX_SENSORS;
    map.getContainer().classList.toggle('sensor-placement-active', placing);
    $('.sensor-add').textContent = placing ? '× Cancel placement' : '＋ Place on map';
    $('.sensor-add').setAttribute('aria-pressed', String(placing));
    say(placing ? 'Click the map to place a sensor. Esc cancels.' : 'Select a sensor on the map or add another.');
    emit();
  }
  async function selectSensor(id) {
    cancelMove();
    sampleController?.abort();
    selectedId = sensors.some((sensor) => sensor.id === id) ? id : null;
    const sensor = sensors.find((entry) => entry.id === selectedId);
    $('.sensor-detail').hidden = !sensor;
    $('#sensor-select').value = selectedId ?? '';
    scheduleRender(); emit();
    if (!sensor) return;
    $('.sensor-type-name').textContent = SENSOR_TYPES[sensor.type].label;
    $('#sensor-name').value = sensor.name;
    $('.sensor-coordinates').textContent = `${Math.abs(sensor.lat).toFixed(5)}° ${sensor.lat < 0 ? 'S' : 'N'} · ${Math.abs(sensor.lng).toFixed(5)}° ${sensor.lng < 0 ? 'W' : 'E'}`;
    $('.sensor-reading').textContent = 'Loading location and forecast…';
    $('.sensor-geography').replaceChildren();
    $('.sensor-provenance').textContent = '';
    $('.sensor-detail').scrollIntoView({ block: 'nearest' });
    sampleController = new AbortController();
    const controller = sampleController;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(apiUrl(`/api/sample?lat=${encodeURIComponent(sensor.lat)}&lng=${encodeURIComponent(sensor.lng)}`), { signal: controller.signal });
      if (!response.ok) throw new Error('Sample unavailable');
      const sample = await response.json();
      if (destroyed || selectedId !== id) return;
      const geography = $('.sensor-geography');
      for (const [label, value] of [
        ['Land cover', sample.landCover?.className ?? 'Unavailable'],
        ['Ecoregion', sample.ecoregion?.name ?? sample.ecoregion?.ecoregion ?? 'Unavailable'],
        ['Ecosystem zone', sample.ecoregion?.zone?.replaceAll('-', ' ') ?? 'Unavailable'],
      ]) { const term = document.createElement('dt'), description = document.createElement('dd'); term.textContent = label; description.textContent = value; geography.append(term, description); }
      const readings = sensorReadings(sample, sensor.type).map((item) => {
        const row = document.createElement('div'); row.className = 'sensor-reading-row';
        const label = document.createElement('span'); label.textContent = item.label;
        const reading = document.createElement('strong'); reading.textContent = item.value === null ? '—' : `${item.value.toFixed(1)} ${item.unit}`;
        const note = document.createElement('span'); note.textContent = item.basis;
        row.append(label, reading, note); return row;
      });
      $('.sensor-reading').replaceChildren(...readings);
      const provenance = [];
      if (sample.landCover) provenance.push(`${sample.landCover.source ?? 'Land cover'} · ${sample.landCover.version ?? sample.landCover.year ?? 'date unavailable'} · retrieved ${sample.landCover.retrievedAt ?? 'time unavailable'}`);
      if (sample.ecoregion?.source) provenance.push(`${sample.ecoregion.source.dataset} · generalized regional boundaries`);
      if (sample.weather?.kind === 'forecast') provenance.push(`${sample.weather.provider ?? 'Weather provider'} forecast · valid ${sample.weather.validAt ?? 'time unavailable'} · retrieved ${sample.weather.retrievedAt ?? 'time unavailable'}`);
      if (!sample.weather) provenance.push('Weather unavailable. Missing values are not zero.');
      $('.sensor-provenance').textContent = provenance.join(' / ');
    } catch {
      if (!destroyed && selectedId === id && sampleController === controller) $('.sensor-reading').textContent = 'Sensor saved. Location data is unavailable; select it again to retry.';
    } finally { clearTimeout(timeout); }
  }
  function addSensor(latlng) {
    if (sensors.length >= MAX_SENSORS) { say(`The ${MAX_SENSORS}-sensor limit has been reached.`, true); return; }
    const type = $('#sensor-type').value;
    const sensor = { id: crypto.randomUUID(), type, name: `${SENSOR_TYPES[type].label} ${sensors.length + 1}`, lat: latlng.lat, lng: ((latlng.lng + 180) % 360 + 360) % 360 - 180 };
    try { validateSensors([sensor]); } catch (error) { say(error.message, true); return; }
    sensors.push(sensor); setPlacement(false); updateList();
    say('Sensor added. Click its icon to inspect it.'); persist(); selectSensor(sensor.id);
  }
  function mapClick(event) {
    if (moveDraft) { moveDraft = { lat: event.latlng.lat, lng: event.latlng.lng }; $('#sensor-lat').value = moveDraft.lat.toFixed(6); $('#sensor-lng').value = moveDraft.lng.toFixed(6); scheduleRender(); say('Position previewed. Save to apply, or Cancel.'); return; }
    if (placing) { addSensor(event.latlng); return; }
    const point = event.containerPoint;
    const target = [...hitTargets].reverse().find((entry) => Math.hypot(entry.x - point.x, entry.y - point.y) <= 21);
    if (target) selectSensor(target.id);
  }
  function cancelMove() {
    moveDraft = null;
    $('.sensor-move-editor').hidden = true;
    map.getContainer().classList.toggle('sensor-placement-active', placing);
    scheduleRender(); emit();
  }
  listen($('.sensor-move'), 'click', () => {
    const sensor = sensors.find((entry) => entry.id === selectedId);
    if (!sensor) return;
    setPlacement(false);
    moveDraft = { lat: sensor.lat, lng: sensor.lng };
    $('#sensor-lat').value = sensor.lat.toFixed(6); $('#sensor-lng').value = sensor.lng.toFixed(6);
    $('.sensor-move-editor').hidden = false;
    map.getContainer().classList.add('sensor-placement-active');
    say('Move preview: click the map or edit coordinates. Save applies the change.'); emit();
  });
  for (const field of ['#sensor-lat', '#sensor-lng']) listen($(field), 'change', () => {
    if (!moveDraft) return;
    try { moveDraft = parseSensorPosition($('#sensor-lat').value, $('#sensor-lng').value); scheduleRender(); }
    catch (error) { say(error.message, true); }
  });
  listen($('.sensor-move-save'), 'click', () => {
    const sensor = sensors.find((entry) => entry.id === selectedId);
    if (!sensor || !moveDraft) return;
    try {
      const position = parseSensorPosition($('#sensor-lat').value, $('#sensor-lng').value);
      Object.assign(sensor, position); cancelMove(); say('Sensor position saved.'); persist(); selectSensor(sensor.id);
    } catch (error) { say(error.message, true); }
  });
  listen($('.sensor-move-cancel'), 'click', () => { cancelMove(); say('Move cancelled. The original position is unchanged.'); });
  listen($('.sensor-add'), 'click', () => setPlacement(!placing));
  listen($('.sensor-at-center'), 'click', () => addSensor(map.getCenter()));
  listen($('#sensor-select'), 'change', (event) => selectSensor(event.target.value));
  listen(document, 'keydown', (event) => { if (event.key === 'Escape') { if (moveDraft) cancelMove(); else if (placing) setPlacement(false); } });
  listen($('#sensor-name'), 'change', (event) => {
    const sensor = sensors.find((entry) => entry.id === selectedId);
    if (!sensor) return;
    const name = event.target.value.trim();
    if (!name) { event.target.value = sensor.name; say('Name cannot be empty.', true); return; }
    sensor.name = name.slice(0, 80); updateList(); say('Name updated.'); persist();
  });
  listen($('.sensor-locate'), 'click', () => { const sensor = sensors.find((entry) => entry.id === selectedId); if (sensor) map.setView([sensor.lat, sensor.lng], Math.max(10, map.getZoom()), { animate: false }); });
  listen($('.sensor-delete'), 'click', () => {
    sensors = sensors.filter((sensor) => sensor.id !== selectedId);
    selectSensor(null); updateList(); say('Sensor deleted.'); persist();
  });
  listen($('.sensor-export'), 'click', () => {
    const blob = new Blob([serializeSensors(sensors)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'dryspell-sensors.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('Scene exported to JSON.');
  });
  listen($('.sensor-import'), 'click', () => $('.sensor-file').click());
  listen($('.sensor-file'), 'change', async (event) => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('File is too large. Maximum size is 512 KB.');
      const next = parseSensorFile(await file.text());
      if (destroyed) return;
      sensors = next; selectSensor(null); setPlacement(false); updateList(); scheduleRender();
      say(`Imported ${sensors.length} sensors.`); persist();
    } catch (error) { say(error.message, true); }
  });
  map.on('click', mapClick);
  map.on('move zoom resize', scheduleRender);
  updateList(); scheduleRender();
  say(restored.error ?? 'Choose a profile and place your first sensor.', Boolean(restored.error));
  return {
    getState: () => ({ sensors: sensors.map((sensor) => ({ ...sensor })), placing, selectedId, moveDraft: moveDraft ? { ...moveDraft } : null }),
    setPlacement, selectSensor,
    destroy() {
      destroyed = true; sampleController?.abort(); cancelAnimationFrame(frame);
      map.off('click', mapClick); map.off('move zoom resize', scheduleRender);
      for (const remove of listeners) remove();
      canvas.remove(); map.getContainer().classList.remove('sensor-placement-active'); container.replaceChildren();
    },
  };
}
