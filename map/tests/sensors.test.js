import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSensors, parseSensorFile, serializeSensors, readSensorStorage, writeSensorStorage, sensorReadings, parseSensorPosition, MAX_SENSORS, MAX_IMPORT_BYTES } from '../public/sensors.js';

const sensor = (changes = {}) => ({ id: 'sensor-1', name: 'Moisture 1', type: 'moisture', lat: 48.1, lng: 31.3, ...changes });

test('scene exports and imports a stable bounded sensor schema', () => {
  const original = [sensor({ untrusted: 'discarded' })];
  assert.deepEqual(parseSensorFile(serializeSensors(original)), [sensor()]);
  assert.equal(JSON.parse(serializeSensors(original)).synthetic, true);
});

test('invalid imports are rejected atomically, including duplicate ids', () => {
  for (const invalid of [
    [sensor(), sensor()], [sensor({ type: '__proto__' })], [sensor({ type: 'toString' })],
    [sensor({ lat: '48' })], [sensor({ lat: 91 })], [sensor({ lng: -181 })],
    [sensor({ lat: Infinity })], [sensor({ name: ' ' })], [sensor({ id: '../bad' })],
    [sensor({ name: 'a'.repeat(81) })], { version: 2, sensors: [] },
  ]) assert.throws(() => validateSensors(invalid));
  assert.throws(() => parseSensorFile('{broken'));
});

test('limits prevent large scene and unicode payload memory growth', () => {
  const max = Array.from({ length: MAX_SENSORS }, (_, index) => sensor({ id: `sensor-${index}` }));
  assert.equal(validateSensors(max).length, MAX_SENSORS);
  assert.throws(() => validateSensors([...max, sensor({ id: 'extra' })]));
  assert.throws(() => parseSensorFile('я'.repeat(MAX_IMPORT_BYTES / 2 + 1)), /too large/);
});

test('storage handles browser restrictions and corruption without crashing', () => {
  const unavailable = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  assert.deepEqual(readSensorStorage(unavailable).sensors, []);
  assert.ok(readSensorStorage(unavailable).error);
  assert.ok(writeSensorStorage(unavailable, [sensor()]));
  assert.ok(readSensorStorage({ getItem: () => '{' }).error);
  let saved;
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  assert.deepEqual(readSensorStorage(storage).sensors, []);
  assert.equal(writeSensorStorage(storage, [sensor()]), null);
  assert.deepEqual(readSensorStorage(storage).sensors, [sensor()]);
});

test('normalization returns copies and never executes name markup', () => {
  const original = sensor({ name: ' <img onerror=evil> ' });
  const [copy] = validateSensors([original]);
  assert.equal(copy.name, '<img onerror=evil>');
  copy.lat = 0;
  assert.equal(original.lat, 48.1);
});

test('profiles display declared channels only and forecasts are not telemetry', () => {
  const sample = { synthetic: false, temperatureC: 0, humidityPct: 80, smokePct: 9, weather: { kind: 'forecast' } };
  const combined = sensorReadings(sample, 'combined');
  assert.deepEqual(combined.map((row) => row.channel), ['temperature', 'humidity', 'smoke']);
  assert.equal(combined[0].value, 0);
  assert.equal(combined[0].basis, 'Forecast baseline');
  assert.equal(combined[2].value, null);
  assert.equal(combined[2].basis, 'No observation');
  assert.equal(sensorReadings(sample, 'humidity').length, 1);
  assert.equal(sensorReadings(sample, 'smoke')[0].value, null);
  assert.equal(sensorReadings({ ...sample, synthetic: true }, 'smoke')[0].basis, 'Simulated reading');
});

test('unavailable data is never converted into zero or synthetic readings', () => {
  for (const type of ['combined', 'temperature', 'humidity', 'smoke', 'moisture', 'wind', 'water']) {
    assert.ok(sensorReadings({ temperatureC: null, humidityPct: undefined, weather: null }, type).every((row) => row.value === null && row.basis === 'No observation'));
  }
  assert.equal(sensorReadings({ temperatureC: 22 }, 'temperature')[0].value, null);
  const wind = sensorReadings({ windSpeedMs: 3, windDirectionDeg: null, weather: { kind: 'forecast' } }, 'wind');
  assert.equal(wind[0].value, 3);
  assert.equal(wind[1].value, null);
});

test('move coordinates accept explicit zero but reject blank and invalid positions', () => {
  assert.deepEqual(parseSensorPosition('0', '0'), { lat: 0, lng: 0 });
  assert.deepEqual(parseSensorPosition('48.5', '-10.25'), { lat: 48.5, lng: -10.25 });
  for (const [lat, lng] of [['', '0'], ['1', ' '], ['90', '10'], ['0', '-181'], ['NaN', '0'], [null, 0], [false, 0]]) assert.throws(() => parseSensorPosition(lat, lng));
});
