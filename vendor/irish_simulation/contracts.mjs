export const CONTRACT_VERSION = '1.1.0';
export const UNITS = {
    temperatureC: '°C',
    humidityPct: '% RH',
    smokePct: '% index'
};
export const SENSOR_PROFILES = {
    combined: {
        id: 'combined',
        name: 'Combined',
        capabilities: [
            'temperatureC',
            'humidityPct',
            'smokePct'
        ],
        sampleIntervalSec: 5,
        noise: {
            temperatureC: .5,
            humidityPct: 3,
            smokePct: 1
        },
        responseTimeSec: 15
    },
    temperature: {
        id: 'temperature',
        name: 'Temperature',
        capabilities: [
            'temperatureC'
        ],
        sampleIntervalSec: 5,
        noise: {
            temperatureC: .5
        },
        responseTimeSec: 15
    },
    humidity: {
        id: 'humidity',
        name: 'Humidity',
        capabilities: [
            'humidityPct'
        ],
        sampleIntervalSec: 5,
        noise: {
            humidityPct: 3
        },
        responseTimeSec: 15
    },
    smoke: {
        id: 'smoke',
        name: 'Smoke',
        capabilities: [
            'smokePct'
        ],
        sampleIntervalSec: 5,
        noise: {
            smokePct: 1
        },
        responseTimeSec: 15
    }
};
export function readingState(sensor, observation, channel, at) {
    if (!sensor.capabilities.includes(channel)) return {
        state: 'unsupported',
        unit: UNITS[channel]
    };
    if (observation?.values[channel] === undefined) return {
        state: 'missing',
        unit: UNITS[channel]
    };
    return {
        state: Date.parse(at) - Date.parse(observation.recordedAt) > sensor.expectedIntervalSec * 3000 ? 'stale' : 'fresh',
        value: observation.values[channel],
        unit: UNITS[channel],
        recordedAt: observation.recordedAt
    };
}
export const DEFAULT_SIMULATION_CONFIG = {
    durationSec: 21600,
    outputIntervalSec: 5,
    checkpointIntervalSec: 60,
    responseRadiusM: 50,
    temperatureGainC: 90,
    burnDurationSec: 180,
    timeZone: 'UTC'
};
export const API_PREFIX = '/api/v1';
