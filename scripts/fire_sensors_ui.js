// Live temperature observations from the team's independent WebSocket receiver.
// Registry is browser-local; observations are held in memory and never alter forecasts.
const ESC = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};
const esc = s => String(s).replace(/[&<>"]/g, ch => ESC[ch]);
const place = d => `${Math.abs(d.lat).toFixed(3)}°${d.lat >= 0 ? 'N' : 'S'} ${Math.abs(d.lon).toFixed(3)}°${d.lon >= 0 ? 'E' : 'W'}`;
let devices = [];
try {
  const stored = JSON.parse(localStorage.getItem('wildfireSensors') || '[]');
  if (Array.isArray(stored)) devices = stored.filter(d => d && Number.isFinite(d.lat) && Number.isFinite(d.lon) &&
    Math.abs(d.lat) <= 90 && Math.abs(d.lon) <= 180).slice(0, 100).map(d => ({
      name: String(d.name || 'Controller').slice(0, 40), type: 'Temperature', lat: d.lat, lon: d.lon,
      deviceId: FireTelemetry.deviceId(d.deviceId) ? d.deviceId : null}));
} catch (_) {}
const readings = new Map(), markers = new Map();
map.createPane('sensors').style.zIndex = 620;
const sensorGroup = L.featureGroup().addTo(map);
let picked = null, pickMarker = null, sensorSocket = null, sensorRetry = null;
let sensorConnected = false, sensorWanted = false, sensorGeneration = 0, sensorAttempts = 0, sensorURL = '';
function picking() { return document.body.classList.contains('picking'); }
function setPicking(on) {
  document.body.classList.toggle('picking', on);
  $('iotPick').classList.toggle('picking', on);
  $('iotPick').textContent = on ? 'Click the map…' : 'Choose place on the map';
}
function saveSensors() {
  try { localStorage.setItem('wildfireSensors', JSON.stringify(devices)); } catch (_) {}
}
function sensorDetails(d) {
  const r = readings.get(d.deviceId);
  const status = d.deviceId ? FireTelemetry.status(r, sensorConnected) : 'Link device ID';
  const time = r ? new Date(r.measuredMs).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : '';
  const basis = r?.timeSource === 'device' ? 'Measured' : r?.timeSource === 'server' ? 'Received by server' : 'Received in browser';
  return {status, temperature: r ? `${r.temperatureC.toFixed(1)} °C` : '—',
    detail: r ? `${basis}: ${time}` : 'Waiting for a reading from this controller.'};
}
function sensorPopup(d, detail) {
  return `<b>${esc(d.name)}</b><div class="pop-place">${esc(d.deviceId || 'Device ID not linked')} · ${place(d)}</div>` +
    `<div class="pop-p">${detail.temperature}</div><b>${detail.status}</b><div>${detail.detail}</div>` +
    '<div class="hint">Ground observation. Separate from the cached fire forecast.</div>';
}
function renderSensors() {
  const live = devices.filter(d => sensorDetails(d).status === 'Live').length;
  $('iotCount').textContent = devices.length ? `${devices.length} added · ${live} live` : 'None added';
  $('iotList').innerHTML = devices.map((d, k) => {
    const detail = sensorDetails(d);
    const color = detail.status === 'Live' ? '#4ade80' : detail.status === 'Stale' ? '#fbbf24' : '#94a3b8';
    let marker = markers.get(d);
    if (!marker) {
      marker = L.circleMarker([d.lat, d.lon], {pane: 'sensors', radius: 7, weight: 2, color: '#fff', fillOpacity: 1}).addTo(sensorGroup);
      marker.bindPopup(''); markers.set(d, marker);
    }
    marker.setStyle({fillColor: color}); marker.getPopup().setContent(sensorPopup(d, detail));
    return `<div class="device"><i style="background:${color}"></i><div data-k="${k}" role="button" tabindex="0">` +
      `<strong>${esc(d.name)}</strong><small>${esc(d.deviceId || 'Device ID not linked')} · ${place(d)}</small>` +
      `<span class="sensor-reading">${detail.temperature}</span> <span>${detail.status}</span><small>${detail.detail}</small></div>` +
      `<button data-link="${k}">Link ID</button><button data-remove="${k}" aria-label="Remove ${esc(d.name)}">×</button></div>`;
  }).join('') || '<div class="hint">Add your controller and match its device ID.</div>';
  for (const [d, marker] of markers) if (!devices.includes(d)) {sensorGroup.removeLayer(marker); markers.delete(d);}
  $('iotList').querySelectorAll('[data-k]').forEach(el => {
    const show = () => {const d = devices[+el.dataset.k]; map.flyTo([d.lat, d.lon], Math.max(map.getZoom(), 7), {duration: .8}); markers.get(d)?.openPopup();};
    el.onclick = show; el.onkeydown = e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); show();}};
  });
  $('iotList').querySelectorAll('[data-remove]').forEach(el => el.onclick = () => {
    const [d] = devices.splice(+el.dataset.remove, 1); readings.delete(d.deviceId); saveSensors(); renderSensors();
  });
  $('iotList').querySelectorAll('[data-link]').forEach(el => el.onclick = () => {
    const d = devices[+el.dataset.link];
    const id = prompt('Device ID sent by this controller:', d.deviceId || '');
    if (id === null) return;
    if (!FireTelemetry.deviceId(id.trim()) || devices.some(other => other !== d && other.deviceId === id.trim())) {
      $('iotMessage').textContent = 'Use a unique device ID: letters, digits, dot, dash, colon or underscore.'; return;
    }
    readings.delete(d.deviceId); d.deviceId = id.trim(); saveSensors(); renderSensors();
  });
}
function sensorConnectionLabel(text) {
  $('iotConnection').textContent = text;
  $('iotConnect').disabled = sensorWanted;
  $('iotDisconnect').disabled = !sensorWanted;
}
function saveSensorConnection() {
  try {localStorage.setItem('wildfireTelemetry', JSON.stringify({url: sensorURL, enabled: sensorWanted}));} catch (_) {}
}
function stopSensors() {
  sensorWanted = false; sensorConnected = false; ++sensorGeneration; clearTimeout(sensorRetry);
  if (sensorSocket) {sensorSocket.close(); sensorSocket = null;}
  saveSensorConnection(); sensorConnectionLabel('Disconnected'); renderSensors();
}
function openSensors(generation) {
  if (!sensorWanted || generation !== sensorGeneration) return;
  sensorConnectionLabel(sensorAttempts ? 'Reconnecting…' : 'Connecting…');
  let socket;
  try { socket = new WebSocket(sensorURL); } catch (_) {
    sensorWanted = false; saveSensorConnection(); sensorConnectionLabel('Connection unavailable'); return;
  }
  sensorSocket = socket;
  const current = () => generation === sensorGeneration && sensorWanted;
  const timeout = setTimeout(() => {if (current() && socket.readyState === WebSocket.CONNECTING) socket.close();}, 10000);
  socket.onopen = () => {
    clearTimeout(timeout); if (!current()) return socket.close();
    sensorConnected = true; sensorAttempts = 0; sensorConnectionLabel('Connected to controller server'); renderSensors();
  };
  socket.onmessage = event => {
    if (!current()) return;
    try {
      const reading = FireTelemetry.normalize(event.data);
      if (!reading) return;
      if (!devices.some(d => d.deviceId === reading.deviceId)) {
        $('iotMessage').textContent = `Unlinked device: ${reading.deviceId}. Add it or use Link ID.`; return;
      }
      const previous = readings.get(reading.deviceId);
      if (previous && reading.measuredMs <= previous.measuredMs) return;
      readings.set(reading.deviceId, reading);
      $('iotMessage').textContent = ''; renderSensors();
    } catch (error) { $('iotMessage').textContent = error.message; }
  };
  socket.onerror = () => {if (current()) sensorConnectionLabel('Connection error · retrying');};
  socket.onclose = () => {
    clearTimeout(timeout); if (!current()) return;
    sensorConnected = false; renderSensors();
    const delay = Math.min(30000, 1000 * 2 ** Math.min(sensorAttempts++, 5));
    sensorConnectionLabel(`Disconnected · retrying in ${delay / 1000}s`);
    sensorRetry = setTimeout(() => openSensors(generation), delay);
  };
}
$('iotConnect').onclick = () => {
  let url;
  try {url = FireTelemetry.endpoint($('iotEndpoint').value.trim(), location.protocol);}
  catch (error) {$('iotMessage').textContent = error.message; return;}
  stopSensors(); sensorURL = url; sensorWanted = true; sensorAttempts = 0;
  $('iotMessage').textContent = ''; saveSensorConnection(); openSensors(sensorGeneration);
};
$('iotDisconnect').onclick = stopSensors;
$('iotPick').onclick = () => setPicking(!picking());
map.on('click', e => {
  if (window.FireSimulation?.isActive()) return;
  if (picking()) {
    const ll = e.latlng.wrap(); picked = {lat: +ll.lat.toFixed(4), lon: +ll.lng.toFixed(4)};
    if (Math.abs(picked.lat) > 90) return;
    if (pickMarker) map.removeLayer(pickMarker);
    pickMarker = L.circleMarker([picked.lat, picked.lon], {radius: 7, color: '#2563eb', weight: 2, fillOpacity: 0, interactive: false, pane: 'sensors'}).addTo(map);
    $('iotPlace').textContent = place(picked); $('iotAdd').disabled = false; setPicking(false); return;
  }
  const i = cellAt(e.latlng); if (i < 0) return;
  popCell = i; popup = L.popup({maxWidth: 290}).setLatLng(e.latlng).setContent(popupHtml(i, dayNow())).openOn(map);
});
$('iotAdd').onclick = () => {
  if (!picked) return;
  const id = $('iotDeviceId').value.trim();
  if (!FireTelemetry.deviceId(id) || devices.some(d => d.deviceId === id)) {
    $('iotMessage').textContent = 'Enter a unique device ID matching the controller.'; return;
  }
  if (devices.length >= 100) {$('iotMessage').textContent = 'Up to 100 controllers can be saved in this browser.'; return;}
  devices.push({deviceId: id, name: $('iotName').value.trim() || id, type: 'Temperature', ...picked});
  picked = null; if (pickMarker) {map.removeLayer(pickMarker); pickMarker = null;}
  $('iotName').value = ''; $('iotDeviceId').value = ''; $('iotPlace').textContent = 'No place chosen';
  $('iotAdd').disabled = true; $('iotMessage').textContent = ''; saveSensors(); renderSensors();
};
sensorConnectionLabel('Not connected');
setInterval(renderSensors, 5000);
try {
  const saved = JSON.parse(localStorage.getItem('wildfireTelemetry') || '{}');
  if (saved.url) {$('iotEndpoint').value = FireTelemetry.endpoint(saved.url, location.protocol);}
  if (saved.enabled && saved.url) setTimeout(() => $('iotConnect').click(), 0);
} catch (_) {}
window.FireSensors = {getState: () => ({connected: sensorConnected,
  devices: devices.map(d => ({deviceId: d.deviceId, ...sensorDetails(d)}))})};
