CREATE TABLE device_events (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  event_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('offline','idle','running','fault','maintenance')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  time_source text NOT NULL CHECK (time_source IN ('device','server')),
  source text NOT NULL CHECK (source IN ('mqtt','manual')),
  UNIQUE(device_id,event_key)
);
CREATE INDEX device_events_timeline ON device_events(device_id,occurred_at);
CREATE TABLE device_states (
  device_id uuid PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  status text NOT NULL,
  occurred_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE integration_failures (
  id uuid PRIMARY KEY,
  integration text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
