ALTER TABLE device_events DROP CONSTRAINT device_events_status_check;
ALTER TABLE device_events ADD CONSTRAINT device_events_status_check
  CHECK (status IN ('offline','idle','running','fault','maintenance','deactivated','scrapped'));
ALTER TABLE device_events ADD COLUMN piece_scale numeric(12,3) NOT NULL DEFAULT 1 CHECK (piece_scale > 0 AND piece_scale <= 1000000);
ALTER TABLE device_events ADD COLUMN reason text NOT NULL DEFAULT '';
ALTER TABLE device_events ADD COLUMN actor_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX records_device_binding_unique ON records ((data->>'deviceNo'))
  WHERE resource='devices' AND status<>'archived' AND COALESCE(data->>'deviceNo','')<>'';
CREATE INDEX device_events_ordered ON device_events(device_id,occurred_at,received_at,id);
