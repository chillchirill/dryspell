/* Shared telemetry contract. No network access, storage or model changes. */
(function (root) {
  'use strict';
  const STALE_MS = 120000;
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const deviceId = x => typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(x);
  function timestamp(value) {
    if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
    return Date.parse(value);
  }
  function normalize(raw, now = Date.now()) {
    if (typeof raw === 'string') {
      if (raw.length > 65536) throw new Error('Message too large');
      try { raw = JSON.parse(raw); } catch { throw new Error('Expected a JSON telemetry message'); }
    }
    if (!object(raw)) throw new Error('Expected a JSON object');
    let data = raw, relayTime;
    // Existing webiot receiver broadcasts {event:"request", time, query, body}.
    if ('event' in raw) {
      if (raw.event !== 'request') return null;
      let body = raw.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { throw new Error('Controller body must be JSON'); }
      }
      data = {...(object(raw.query) ? raw.query : {}), ...(object(body) ? body : {})};
      relayTime = raw.time;
    }
    const id = data.deviceId ?? data.device_id;
    if (!deviceId(id)) throw new Error('Telemetry needs a deviceId matching the controller on the map');
    const value = data.temperatureC ?? data.tempC ?? data.temperature ?? data.temp;
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') {
      throw new Error('Missing temperature in degrees Celsius');
    }
    const temperatureC = Number(value);
    if (!Number.isFinite(temperatureC) || temperatureC < -273.15 || temperatureC > 2000) {
      throw new Error('Invalid temperature');
    }
    if (data.unit != null && !['c', '°c', 'celsius'].includes(String(data.unit).toLowerCase())) {
      throw new Error('Temperature unit must be Celsius');
    }
    const supplied = data.recordedAt ?? data.recorded_at ?? relayTime;
    const measuredMs = supplied == null ? now : timestamp(supplied);
    if (!Number.isFinite(measuredMs) || measuredMs > now + 120000) {
      throw new Error('Invalid or future timestamp; use ISO 8601 with a timezone');
    }
    return {deviceId: id, temperatureC, measuredMs, receivedMs: now,
      timeSource: data.recordedAt != null || data.recorded_at != null ? 'device' : relayTime != null ? 'server' : 'browser'};
  }
  function status(reading, connected, now = Date.now()) {
    if (!reading) return 'Waiting for data';
    if (!connected) return 'Disconnected';
    if (now - reading.measuredMs > STALE_MS || now - reading.receivedMs > STALE_MS) return 'Stale';
    return 'Live';
  }
  function endpoint(value, pageProtocol = 'http:') {
    let url;
    try { url = new URL(value); } catch { throw new Error('Enter a ws:// or wss:// address'); }
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Use a ws:// or wss:// address without credentials, query or fragment');
    }
    if (pageProtocol === 'https:' && url.protocol !== 'wss:') throw new Error('This HTTPS map requires a wss:// connection');
    return url.href;
  }
  const api = {normalize, status, endpoint, deviceId, STALE_MS};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FireTelemetry = api;
})(globalThis);
