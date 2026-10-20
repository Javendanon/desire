#!/usr/bin/env bash
# A socket-only cluster owned by this invocation; never connects to an existing service.
set -euo pipefail
cd "$(dirname "$0")/../.."
# libpq hostaddr/service/options can override a socket host; inherit none of them.
for variable in "${!PG@}"; do
    unset "$variable"
done
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
if [[ -f crates/persistence/Cargo.toml ]]; then
    # The Rust tests install the schema through the production migration runner and run the SQL
    # constraint files against it, so the harness never seeds a second, divergent schema.
    cargo test --workspace --locked
fi
