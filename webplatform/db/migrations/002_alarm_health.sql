CREATE TABLE IF NOT EXISTS alarm_states (
  key text PRIMARY KEY,
  last_observation_id text,
  last_recorded_at timestamptz,
  document jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS sensor_health (
  sensor_id text PRIMARY KEY REFERENCES sensors(id) ON DELETE CASCADE,
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telemetry_sensor_received_idx ON telemetry(sensor_id,received_at DESC);
CREATE INDEX IF NOT EXISTS external_detections_time_idx ON external_detections(observed_at,received_at);
