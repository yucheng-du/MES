CREATE TABLE uploaded_files (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL CHECK(size > 0 AND size <= 10485760),
  sha256 text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
