# Deploying Desire on Fly.io

Status: runbook for the public test deployment. The image, the static file serving and the
configuration are covered by automated tests; the real deploy is run by the account owner.
Do not run `fly` against a real account from CI or from an agent.

## What runs

One Fly app in São Paulo (`gru`) serves the API and the compiled frontend from the same
origin and the same port:

- `desire-api` answers `/api/*` and, when `DESIRE_STATIC_DIR` is set, the Vite build.
- One machine stays running (`min_machines_running = 1`, `auto_stop_machines = "off"`):
  a sleeping machine cannot serve real-time table sessions.
- `/api/health` is the health check. It reports that the process is alive, not that
  PostgreSQL is reachable; a dead database still fails at startup.
- `release_command` runs `desire-api --migrate` on every deploy. A failed migration
  aborts the release before the new machine takes traffic.

The image is built by the repository's `Dockerfile` with `.dockerignore`; `fly.toml` is
the app configuration and is committed. Changing the region or the machine size is a
change to `fly.toml`, not a new app.

## Prerequisites

- `flyctl` installed and authenticated (`fly auth login`).
- A Google OAuth web client: see [identity and permissions](api/auth-realtime.md).
- A PostgreSQL 17 database in `gru` (next section).

## Database: choose one option

The deployment does not pick a provider for you. Either option ends as one
`DATABASE_URL` secret; nothing else in the application changes.

### Fly Managed Postgres

```sh
fly mpg create --name desire-db --region gru
fly mpg attach <cluster-id> --app desire-table
```

`fly mpg attach` provisions a database and sets `DATABASE_URL` on the app. Confirm with
`fly secrets list`; never print the value. Managed Postgres in `gru` keeps the database
in the same region as the machine.

### External provider

Create a PostgreSQL 17 database in `gru` (or the closest region the provider offers),
then set the URL yourself:

```sh
fly secrets set DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require'
```

Requirements:

- TLS in transit (`sslmode=require` or stricter); no plaintext internet connection.
- The provider must accept connections from Fly egress.
- The same region; a database in another continent adds latency to every request.
- The role needs `CREATE` on the database, because the release command installs the
  schema. After migrations, the running API only reads and writes rows.

## First deploy from zero

Run every command from the repository root.

1. Create the app without replacing the committed configuration:

   ```sh
   fly launch --no-deploy
   ```

   Choose the existing `fly.toml`; decline any prompt that offers to overwrite it.
   Check that the file is unchanged (`git diff -- fly.toml`). The committed name is
   `desire-table`; if it is taken, change only the `app` line (or run
   `fly apps create <your-name>` first), then deploy.

2. Set the secrets. Secrets never go into `fly.toml`, the repository or a log:

   ```sh
   fly secrets set \
     DATABASE_URL='postgres://…' \
     DESIRE_OIDC_CLIENT_ID='…' \
     DESIRE_OIDC_CLIENT_SECRET='…' \
     DESIRE_PUBLIC_URL='https://desire-table.fly.dev'
   ```

   `DESIRE_ALLOWED_EMAILS` is optional and restricts admission to a comma-separated
   allowlist of verified Google emails:

   ```sh
   fly secrets set DESIRE_ALLOWED_EMAILS='dm@example.com,player@example.com'
   ```

   `HOST`, `PORT`, `DESIRE_STATIC_DIR` and `DESIRE_TRUSTED_CLIENT_IP_HEADER` come from
   the `[env]` block in `fly.toml`; they are not secrets. `DESIRE_OIDC_ISSUER` defaults
   to Google and only needs setting for a different provider.

3. Deploy:

   ```sh
   fly deploy
   ```

   The deploy builds the image, runs the migrations, starts one machine and waits for
   `/api/health`.

4. Register the callback in the Google OAuth client:
   `https://desire-table.fly.dev/api/v1/auth/callback`. Visit
   `https://desire-table.fly.dev/api/v1/auth/login` and confirm the redirect back and
   `/api/v1/auth/identity`.

5. Check the deployment:

   ```sh
   fly status
   fly checks list
   curl -fsS https://desire-table.fly.dev/api/health
   ```

   Opening the root URL must return the Svelte app, not a directory listing.

## Custom domain

1. Add the certificate and read the DNS records:

   ```sh
   fly certs add DOMAIN
   fly certs show DOMAIN
   ```

2. Create the A/AAAA records (or the CNAME for a subdomain) at the DNS provider. Wait
   until `fly certs show DOMAIN` reports the certificate as issued.

3. Point the app at the browser-facing origin and update Google:

   ```sh
   fly secrets set DESIRE_PUBLIC_URL='https://DOMAIN'
   ```

   Add `https://DOMAIN/api/v1/auth/callback` to the Google OAuth client and remove the
   `fly.dev` callback if the domain replaces it. Secrets restart the machine; no image
   rebuild is needed.

The public URL must be the origin only: `https`, no path, credentials, query or
fragment. The API rejects anything else at startup and refuses a non-loopback bind
without OIDC.

## Rollback

```sh
fly releases --image        # previous image references
fly deploy --image registry.fly.io/desire-table:deployment-…
fly status
```

A binary rollback does **not** undo a database migration. Migrations are forward-only:
if a release already changed the schema, deploy a corrective release instead of
pretending the old binary is safe against the new schema. Roll back the image only when
the release did not migrate, or when the previous schema is still compatible.

## Logs and diagnostics

```sh
fly logs                          # all machines, live
fly logs -i <machine-id>          # one machine
fly checks list                   # health check state
fly status                        # machines, image, region
```

Migrations run in an ephemeral release machine; their output appears in `fly deploy`
and in the release history. `DESIRE_FLAGS_FILE` stays unset unless an operator mounts a
flags file; every runtime flag is off by default (see [flags](flags.md)).

## Local image check

`pnpm test:rust` covers the static file serving without Docker. To check the image
itself, build it and run it against a disposable database on a private network:

```sh
docker build -t desire-test .
docker network create desire-smoke
docker run -d --rm --name desire-db --network desire-smoke \
  -e POSTGRES_USER=desire -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=desire \
  postgres:17-alpine
docker run --rm --network desire-smoke -p 8080:8080 \
  -e DATABASE_URL='postgres://desire:smoke@desire-db:5432/desire' \
  -e DESIRE_OIDC_CLIENT_ID=local-smoke \
  -e DESIRE_OIDC_CLIENT_SECRET=local-smoke \
  -e DESIRE_PUBLIC_URL='https://localhost:8080' \
  desire-test
```

The throwaway OIDC values exist only because the binary refuses a shared bind without
OIDC; startup performs discovery against Google, and no login is attempted. In another
terminal:

```sh
curl -fsS http://localhost:8080/api/health
curl -fsS http://localhost:8080/ | head
```

The first response is JSON, the second is the app shell. Stop the API with Ctrl-C, then
remove the container and network:

```sh
docker rm -f desire-db
docker network rm desire-smoke
```

## Environment reference

| Variable | Set where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `fly secrets set` | PostgreSQL connection; required |
| `DESIRE_OIDC_CLIENT_ID` | `fly secrets set` | Google OAuth web client ID |
| `DESIRE_OIDC_CLIENT_SECRET` | `fly secrets set` | Server-only OAuth secret |
| `DESIRE_OIDC_ISSUER` | `fly secrets set` (optional) | Defaults to `https://accounts.google.com` |
| `DESIRE_PUBLIC_URL` | `fly secrets set` | Exact browser origin; callback is `{origin}/api/v1/auth/callback` |
| `DESIRE_ALLOWED_EMAILS` | `fly secrets set` (optional) | Comma-separated verified-email allowlist |
| `DESIRE_TRUSTED_CLIENT_IP_HEADER` | `fly.toml` `[env]` | `Fly-Client-IP`, so login quotas use the client IP |
| `HOST` | `fly.toml` `[env]` | `0.0.0.0` |
| `PORT` | `fly.toml` `[env]` | `8080`; must match `internal_port` |
| `DESIRE_STATIC_DIR` | `fly.toml` `[env]` | Compiled frontend directory; unset keeps the API-only behaviour |
| `DESIRE_FLAGS_FILE` | unset | Optional runtime flags file; all flags default off |

## Static serving rules

- Unset `DESIRE_STATIC_DIR`: unknown non-API paths return 404, exactly as before.
- Set: files under `/assets/` whose name carries a Vite content hash (at least eight
  characters after the last dash, such as `index-DAi1n9St.css`) are cached for a year
  as immutable. `index.html`, unhashed `public/` files (`mark.svg`, `abbey.jpg`) and
  everything else are `no-cache`. Unknown app routes return `index.html` so the client
  router can resolve them.
- `/api` and `/api/*` never fall back to `index.html`; an unknown API route stays 404.
- Paths with `..`, hidden segments, empty segments or percent-encoding never touch the
  filesystem; they fall back to the shell.
- Startup fails with an explicit error when the directory has no `index.html`.

`DESIRE_STATIC_DIR` is startup configuration, not a runtime flag. The flag registry in
[flags.md](flags.md) exists for behaviour that must change in a running process; a path
read once at boot does not qualify, and unset is the safe default.

## Out of scope

A PostgreSQL connection pool, real-time events across several machines
(`LISTEN/NOTIFY` or a broker) and a CDN for large assets are separate tasks. The current
single always-on machine is enough for the group test.
