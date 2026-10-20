#!/usr/bin/env bash
# A socket-only cluster owned by this invocation; never connects to an existing service.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .local/d08
cluster=$(mktemp -d "$PWD/.local/d08/pg.XXXXXX")
cleanup() {
    pg_ctl -D "$cluster/data" -m immediate -w stop > /dev/null
    rm -rf "$cluster"
}
initdb -D "$cluster/data" -U desire_test --auth-local=trust --no-locale > "$cluster/init.log"
pg_ctl -D "$cluster/data" -l "$cluster/server.log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$cluster' -c fsync=off" -w start
trap cleanup EXIT
export PGHOST="$cluster" PGUSER=desire_test PGDATABASE=postgres
export DESIRE_TEST_SOCKET="$cluster"
for migration in migrations/[0-9]*.sql; do
    if [[ -f "$migration" ]]; then
        psql -X -v ON_ERROR_STOP=1 -1 -f "$migration" > /dev/null
    fi
done
psql -X -v ON_ERROR_STOP=1 -f crates/persistence/tests/schema.sql
psql -X -v ON_ERROR_STOP=1 -f crates/persistence/tests/constraints.sql
if [[ -f crates/persistence/Cargo.toml ]]; then
    cargo test -p desire-persistence --locked
fi
