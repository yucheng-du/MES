ALTER TABLE reports ADD COLUMN device_metrics jsonb CHECK (device_metrics IS NULL OR jsonb_typeof(device_metrics)='object');
