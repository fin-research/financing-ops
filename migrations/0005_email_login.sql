ALTER TABLE audit_logs ADD COLUMN actor_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_people_email_unique
	ON people(lower(email))
	WHERE email IS NOT NULL AND trim(email) != '';
