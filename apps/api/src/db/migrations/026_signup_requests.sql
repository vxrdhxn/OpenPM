-- Verify-by-email sign-up (docs/signup.md). A sign-up waits here until its owner opens the emailed
-- link; only then are the organization and account created. One pending sign-up per email address
-- (signing up again replaces it). Only the token's hash is stored; the password is already hashed.
-- Not tied to an organization (there is none yet), so no foreign keys.
CREATE TABLE signup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  org_name VARCHAR(255) NOT NULL,
  org_slug VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Expired requests are deleted whenever a new one is made.
CREATE INDEX idx_signup_requests_expires ON signup_requests (expires_at);
