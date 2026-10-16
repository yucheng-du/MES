CREATE TABLE auto_review_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  delay_minutes integer NOT NULL DEFAULT 5 CHECK (delay_minutes BETWEEN 0 AND 1440),
  max_amount numeric(18,2) NOT NULL DEFAULT 2000 CHECK (max_amount > 0 AND max_amount <= 1000000000),
  min_duration_ratio numeric(6,5) NOT NULL DEFAULT 0 CHECK (min_duration_ratio BETWEEN 0 AND 1),
  require_full_quantity boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  eligible_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO auto_review_settings(id) VALUES (true);

ALTER TABLE reports ADD COLUMN approval_mode text CHECK (approval_mode IN ('manual','automatic'));
ALTER TABLE reports ADD COLUMN auto_review_status text NOT NULL DEFAULT 'not_applicable' CHECK (auto_review_status IN ('not_applicable','pending','manual','approved'));
ALTER TABLE reports ADD COLUMN auto_review_reasons jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(auto_review_reasons)='array');
ALTER TABLE reports ADD COLUMN auto_review_eligible_at timestamptz;
ALTER TABLE reports ADD COLUMN auto_review_rule_revision integer;
ALTER TABLE reports ADD COLUMN had_rejection boolean NOT NULL DEFAULT false;

UPDATE reports SET had_rejection=true
WHERE status='rejected' OR EXISTS (
  SELECT 1 FROM audit_logs a WHERE a.resource='reports' AND a.resource_id=reports.id AND a.action IN ('reject','resubmit')
);
UPDATE reports SET approval_mode='manual' WHERE status='approved';
UPDATE reports SET auto_review_status='manual',auto_review_rule_revision=1,
  auto_review_reasons=CASE WHEN had_rejection
    THEN '["启用前的完工积压，需要人工审核","曾被驳回或重新提交，需要人工复核"]'::jsonb
    ELSE '["启用前的完工积压，需要人工审核"]'::jsonb END
WHERE status='complete';
UPDATE reports SET auto_review_status='manual',auto_review_reasons='["曾被驳回或重新提交，需要人工复核"]'::jsonb
WHERE status='rejected';
CREATE INDEX reports_auto_review_queue ON reports(completed_at,id) WHERE status='complete' AND auto_review_status IN ('pending','not_applicable');

CREATE TABLE auto_review_runs (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running','completed','failed','skipped')),
  trigger text NOT NULL CHECK (trigger IN ('startup','timer','manual')),
  triggered_by uuid REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  rule_revision integer,
  scanned_count integer NOT NULL DEFAULT 0,
  approved_count integer NOT NULL DEFAULT 0,
  manual_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error_message text
);
CREATE INDEX auto_review_runs_recent ON auto_review_runs(started_at DESC);
CREATE TABLE auto_review_attempts (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES auto_review_runs(id),
  report_id uuid NOT NULL REFERENCES reports(id),
  rule_revision integer NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('approved','manual','waiting','skipped','error','retry')),
  reasons jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(reasons)='array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(run_id,report_id)
);
