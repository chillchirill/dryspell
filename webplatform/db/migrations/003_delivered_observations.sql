-- Multiple observations from one sensor may arrive at the same simulation tick
-- after a configured delay. Observation identity, not delivery tick, deduplicates.
DO $$
DECLARE duplicate_constraint record;
BEGIN
  FOR duplicate_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='simulation_readings'::regclass AND contype='u'
      AND pg_get_constraintdef(oid)='UNIQUE (scenario_id, revision, sensor_id, time_sec)'
  LOOP
    EXECUTE format('ALTER TABLE simulation_readings DROP CONSTRAINT %I',duplicate_constraint.conname);
  END LOOP;
END $$;
COMMENT ON COLUMN simulation_readings.time_sec IS 'Delivery simulation time; recordedAt in document retains original observation time. Multiple observations may share a delivery tick.';
