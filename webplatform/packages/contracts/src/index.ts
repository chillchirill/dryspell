/** Dryspell integration contract v1. All wire timestamps are UTC ISO-8601. */
export const CONTRACT_VERSION = '1.1.0';
export type Channel = 'temperatureC' | 'humidityPct' | 'smokePct';
export type ProfileId = 'combined' | 'temperature' | 'humidity' | 'smoke';
export const UNITS: Record<Channel, string> = { temperatureC: '°C', humidityPct: '% RH', smokePct: '% index' };
export interface SensorProfile { id: ProfileId; name: string; capabilities: Channel[]; sampleIntervalSec: number; noise: Partial<Record<Channel, number>>; responseTimeSec: number; }
export const SENSOR_PROFILES: Record<ProfileId, SensorProfile> = {
  combined: { id: 'combined', name: 'Combined', capabilities: ['temperatureC', 'humidityPct', 'smokePct'], sampleIntervalSec: 5, noise: { temperatureC: .5, humidityPct: 3, smokePct: 1 }, responseTimeSec: 15 },
  temperature: { id: 'temperature', name: 'Temperature', capabilities: ['temperatureC'], sampleIntervalSec: 5, noise: { temperatureC: .5 }, responseTimeSec: 15 },
  humidity: { id: 'humidity', name: 'Humidity', capabilities: ['humidityPct'], sampleIntervalSec: 5, noise: { humidityPct: 3 }, responseTimeSec: 15 },
  smoke: { id: 'smoke', name: 'Smoke', capabilities: ['smokePct'], sampleIntervalSec: 5, noise: { smokePct: 1 }, responseTimeSec: 15 }
};
export interface Coordinate { longitude: number; latitude: number; }
export interface Bounds { west: number; south: number; east: number; north: number; }
export type Context = 'simulation' | 'live' | 'history';
export interface SensorStatus { sensorId: string; state: 'waiting'|'online'|'stale'|'offline'|'disabled'|'archived'; freshness:'missing'|'fresh'|'stale'; lastRecordedAt:string|null; lastReceivedAt:string|null; evaluatedAt:string; expectedIntervalSec:number; }
export interface SimulationFault { type: 'dropout'|'stuck'|'spike'|'delay'|'smoke-without-fire'; startTimeSec: number; endTimeSec: number; channels?: Channel[]; value?: number; delaySec?: number; }
export interface Sensor { id: string; deviceId: string; name: string; source: 'real' | 'simulated'; location: Coordinate; profileId: ProfileId; capabilities: Channel[]; expectedIntervalSec: number; enabled: boolean; archived?: boolean; tags: string[]; createdAt: string; updatedAt: string; locationVersion?: number; calibration?: Partial<Record<Channel, number>>; simulationFaults?: SimulationFault[]; hardware?: { model?: string; temperatureRangeC?: { min: number; max: number } }; }
/** Local simulated devices may disable any subset of their profile's channels. Real-device API rules are unchanged. */
export function validSimulationChannels(sensor:Pick<Sensor,'profileId'|'capabilities'|'enabled'>):boolean {
  const profile=SENSOR_PROFILES[sensor.profileId];
  return !!profile&&(!sensor.enabled||sensor.capabilities.length>0)&&new Set(sensor.capabilities).size===sensor.capabilities.length&&sensor.capabilities.every(channel=>profile.capabilities.includes(channel));
}
export type QualityFlag = 'server-time' | 'late' | 'stale' | 'saturated' | 'fault' | 'clock-skew' | 'missing';
export interface TelemetryPacket { deviceId: string; messageId?: string; recordedAt?: string; temperatureC?: number; humidityPct?: number; smokePct?: number; smoke?: boolean; batteryVoltage?: number; extra?: Record<string, unknown>; }
export interface ValidatedObservation { id: string; sensorId: string; source: 'real' | 'simulated'; scenarioId?: string; revision?: number; recordedAt: string; receivedAt: string; simulationTimeSec?: number; location: Coordinate; locationVersion: number; values: Partial<Record<Channel, number>>; smoke?: boolean; quality: QualityFlag[]; }
export type ReadingState = { state: 'unsupported' | 'missing'; unit: string } | { state: 'fresh' | 'stale'; value: number; unit: string; recordedAt: string };
export function readingState(sensor: Sensor, observation: ValidatedObservation | undefined, channel: Channel, at: string): ReadingState {
  if (!sensor.capabilities.includes(channel)) return {state:'unsupported',unit:UNITS[channel]};
  if (observation?.values[channel] === undefined) return {state:'missing',unit:UNITS[channel]};
  return {state: Date.parse(at)-Date.parse(observation.recordedAt)>sensor.expectedIntervalSec*3000 ? 'stale':'fresh', value:observation.values[channel]!,unit:UNITS[channel],recordedAt:observation.recordedAt};
}
export interface Provenance { provider: string; sourceUrl: string; version: string; retrievedAt: string; validAt: string; resolutionM?: number; license: string; attribution: string; checksum: string; sample: boolean; parameters?: Record<string, unknown>; }
export interface WeatherSample { timeSec: number; temperatureC: number; humidityPct: number; windSpeedMps: number; windFromDeg: number; precipitationMm: number; }
export interface WeatherSnapshot { id: string; validAt: string; issuedAt: string; samples: WeatherSample[]; provenance: Provenance[]; stale: boolean; }
export type LandCover = 'grass' | 'woodland' | 'scrub' | 'water' | 'built' | 'unknown';
export interface LandscapeCell { sourceClassCode?: number; ecologicalZone?: string; elevationM: number | null; slopeDeg: number | null; aspectDeg: number | null; cover: LandCover; fuelModel: string; burnable: boolean; spreadRateMps: number; moisture: number; }
export interface LandscapeSnapshot { id: string; bounds: Bounds; origin: Coordinate; projection: string; width: number; height: number; cellSizeM: number; cells: LandscapeCell[]; provenance: Provenance[]; checksum: string; }
export interface EnvironmentSnapshot { id: string; name: string; createdAt: string; sample: boolean; status: 'ready' | 'partial' | 'preparing' | 'unavailable'; landscape: LandscapeSnapshot; weather: WeatherSnapshot; warnings: string[]; }
export interface Ignition { id: string; location: Coordinate; timeSec: number; }
export interface SimulationConfig { durationSec: number; outputIntervalSec: number; checkpointIntervalSec: number; responseRadiusM: number; temperatureGainC: number; burnDurationSec: number; timeZone: string; }
export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = { durationSec: 21600, outputIntervalSec: 5, checkpointIntervalSec: 60, responseRadiusM: 50, temperatureGainC: 90, burnDurationSec: 180, timeZone: 'UTC' };
export interface Scenario { id: string; name: string; revision: number; status: 'draft' | 'running' | 'paused' | 'completed' | 'failed'; seed: number; startTime: string; environmentId: string; sensors: Sensor[]; ignitions: Ignition[]; config: SimulationConfig; authoritativeTimeSec: number; createdAt: string; updatedAt: string; }
/** Illustrative two-component surface fuel state; source terms use horizontal area. */
export interface CombustionCell { cell: number; phase:'flaming'|'residual'; intensity:number; fuelRemainingKgM2:number; heatFluxWm2:number; smokeFluxKgM2Sec:number; }
export interface SimulationFrame { scenarioId: string; revision: number; environmentId: string; timeSec: number; timestamp: string; engineVersion: string; burningCells: number[]; burnedCells: number[]; combustion?:CombustionCell[]; readings: ValidatedObservation[]; weather: WeatherSample; checksum: string; }
export interface SimulationCheckpoint { scenarioId: string; revision: number; timeSec: number; engineVersion: string; environmentId: string; state: unknown; checksum: string; }
export interface FireHypothesis { location: Coordinate; ignitionTime: string; weight: number; }
export interface FirePosterior { hypotheses: FireHypothesis[]; noFireProbability: number; processedObservationIds: string[]; sensorMemory?: Record<string,{recordedAt:string;temperatureAnomaly?:number;smokePct?:number;consecutiveAbnormal:number}>; }
export interface SatelliteObservation { id: string; location: Coordinate; observedAt: string; receivedAt: string; confidence: string; instrument: string; nominalResolutionM: number; }
export interface PredictionConfig { ensembleSize: number; horizonSec: number; retrospective?: boolean; }
export interface PredictionInput { area: {type:'Polygon';coordinates:number[][][]}; issuedAt: string; requestedTimes: string[]; observations: ValidatedObservation[]; previousPosterior?: FirePosterior; weatherSnapshot: WeatherSnapshot; landscapeSnapshot: LandscapeSnapshot; satelliteEvidence?: SatelliteObservation[]; modelVersion?: string; config: PredictionConfig; seed: number; }
export interface PredictionGrid { time: string; pBurningNow: (number|null)[]; pReachedByTime: (number|null)[]; pIgnitionOrigin: (number|null)[]; }
export interface PredictionResult { id: string; issuedAt: string; inputCutoff: string; environmentId: string; modelVersion: string; calibrationStatus: 'uncalibrated' | 'calibrated'; posterior: FirePosterior; grids: PredictionGrid[]; warnings: string[]; diagnostics: Record<string,number|string>; arrivalTimeQuantiles?: {cell:number;p10:number|null;p50:number|null;p90:number|null;noArrivalProbability:number}[]; }
export interface Incident { id: string; sensorId: string; state: 'suspicious'|'critical'|'acknowledged'|'confirmed'|'resolved'; context: Context; scenarioId?: string; revision?: number; observedAt: string; evidence: string[]; }
export type EventType = 'snapshot'|'resync.required'|'sensor.reading'|'sensor.status'|'sensor.updated'|'incident.updated'|'prediction.updated'|'scenario.progress'|'source.status';
export interface WsEnvelope<T = unknown> { eventId: string; cursor: string; type: EventType; context: Context; scenarioId?: string; revision?: number; eventTime: string; payload: T; }
export interface ApiError { error: { code: string; message: string; details?: unknown; retryable?: boolean; }; }
export interface SessionInfo { authenticated: boolean; username?: string; csrfToken?: string; }
export interface WorkspaceSnapshot { scenario: Scenario; environment: EnvironmentSnapshot; frame: SimulationFrame | null; cursor: string; }
export const API_PREFIX = '/api/v1';


