-- Opaque bearer sessions are the identity bridge; raw tokens are never stored.
CREATE SCHEMA identity;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
CREATE TABLE identity.accounts (
    id uuid PRIMARY KEY,
    username text NOT NULL UNIQUE
        CHECK (username = lower(username) AND length(username) BETWEEN 3 AND 64),
    password_hash text NOT NULL
        CHECK (password_hash ~ '^pbkdf2_sha256[$][0-9]+[$][0-9a-f]{32}[$][0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now()
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
