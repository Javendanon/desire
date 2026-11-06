-- OIDC identity uses the provider's stable issuer/subject pair, not display email.
CREATE SCHEMA identity;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
CREATE TABLE identity.accounts (
    id uuid PRIMARY KEY,
    issuer text NOT NULL CHECK (length(issuer) > 0),
    subject text NOT NULL CHECK (length(subject) > 0),
    email text NOT NULL CHECK (length(email) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (issuer, subject)
);
CREATE TABLE identity.sessions (
    token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    account_id uuid NOT NULL REFERENCES identity.accounts ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CHECK (expires_at > created_at)
);
CREATE INDEX sessions_account ON identity.sessions (account_id);
REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM PUBLIC;
