ALTER TABLE records ADD COLUMN feedback_by uuid REFERENCES users(id);
ALTER TABLE records ADD COLUMN feedback_at timestamptz;
ALTER TABLE records ADD CONSTRAINT records_feedback_complete CHECK ((feedback_by IS NULL) = (feedback_at IS NULL));
