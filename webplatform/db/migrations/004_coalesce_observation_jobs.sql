-- Keep one queued analysis cutoff per sensor; a running job can have a newer
-- queued successor. All observations remain durable and inform the next cutoff.
WITH duplicates AS (
  SELECT id,row_number() OVER(PARTITION BY payload->>'sensorId' ORDER BY created_at DESC,id DESC) AS rank
  FROM analysis_jobs WHERE kind='real-observation' AND status='queued'
)
UPDATE analysis_jobs SET status='cancelled',error='Superseded by a newer queued observation cutoff',updated_at=now()
WHERE id IN (SELECT id FROM duplicates WHERE rank>1);
CREATE UNIQUE INDEX IF NOT EXISTS analysis_jobs_real_sensor_queued_idx
  ON analysis_jobs((payload->>'sensorId')) WHERE kind='real-observation' AND status='queued';
