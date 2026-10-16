ALTER TABLE users ADD COLUMN allowed_permissions text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN denied_permissions text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN profile jsonb NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN department_id uuid REFERENCES records(id);
ALTER TABLE users ADD COLUMN job_title text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN mobile text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE users ADD COLUMN archived_at timestamptz;
ALTER TABLE uploaded_files ADD COLUMN visibility text NOT NULL DEFAULT 'business' CHECK (visibility IN ('business','personnel'));
ALTER TABLE payroll ADD COLUMN description text NOT NULL DEFAULT '';
CREATE TABLE payroll_adjustments (
 id uuid PRIMARY KEY, worker_id uuid NOT NULL REFERENCES users(id), quantity numeric(18,4) NOT NULL CHECK(quantity>0),
 unit_price numeric(18,4) NOT NULL, amount numeric(18,2) NOT NULL, work_date date NOT NULL,
 reason text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_active_mobile ON users(mobile) WHERE mobile<>'' AND archived_at IS NULL;
CREATE TABLE login_codes(user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,code_hash text NOT NULL,nonce text NOT NULL,expires_at timestamptz NOT NULL,requested_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),consumed boolean NOT NULL DEFAULT false);
