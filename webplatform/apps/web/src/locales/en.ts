/** Core workspace catalogue. Keep keys stable for a later Ukrainian catalogue. */
export const en = {
  appName: 'Dryspell', simulation: 'Simulation', live: 'Live', history: 'History',
  tools: { select: 'Select', sensor: 'Sensor', ignition: 'Ignite', terrain: 'Terrain', sensors: 'Sensors', addSensor: 'Add sensor', addIgnition: 'Add ignition', inspectTerrain: 'Inspect terrain', coordinates: 'Coordinates', cancelPlacement: 'Cancel placement' },
  time: { run: 'Run', pauseRun: 'Pause run', playReplay: 'Play replay', pauseReplay: 'Pause replay', rewind: 'Rewind to start', step: 'Step forward 5 seconds', replaySpeed: 'Replay speed', follow: 'Follow run' },
  readings: { temperatureC: 'Temperature', humidityPct: 'Humidity', smokePct: 'Smoke index', unsupported: 'Not supported', missing: 'No reading', stale: 'Stale' },
  loading: 'Loading…', loadingLandscape: 'Loading landscape…', loadingWorkspace: 'Preparing the map workspace…', loadingEnvironment: 'Preparing the scenario and terrain. Placement is available when loading finishes.',
  placeObject: 'Place object', previewPosition: 'Preview position', cancel: 'Cancel', save: 'Save',
  overlappingObjects: 'Objects at this point', chooseObject: 'Choose the object to inspect. The sensor list also selects objects directly.',
  fault: { title: 'Simulated sensor faults', help: 'Faults affect only this simulated device. Saving creates a new draft revision; unsupported channels remain unsupported.', type: 'Fault type', start: 'Start (simulation seconds)', end: 'End (simulation seconds)', channels: 'Affected measurements', value: 'Fault value', delay: 'Packet delay (seconds)', add: 'Add fault', remove: 'Remove fault', save: 'Save fault configuration', empty: 'No faults configured.', invalidWindow: 'Fault end must be later than its start and within the scenario duration.', channelRequired: 'Choose at least one supported measurement.', labels: { dropout: 'Dropout', stuck: 'Stuck value', spike: 'Measurement spike', delay: 'Delayed packets', 'smoke-without-fire': 'Smoke without fire' } },
} as const;
