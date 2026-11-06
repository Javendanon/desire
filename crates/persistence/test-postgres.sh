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
# A Unix-domain socket path is capped near 104 bytes. A deep worktree (a merge candidate lives
# under a long directory name) overflows that cap and PostgreSQL refuses to start, so the
# socket directory is short and lives outside the worktree. The cluster and its logs stay here.
sockets=$(mktemp -d /tmp/desire-pg.XXXXXX)
cleanup() {
    # A failed start or stop must not leave the cluster or socket directory behind.
    pg_ctl -D "$cluster/data" -m immediate -w stop > /dev/null || true
    rm -rf "$cluster" "$sockets"
}
trap cleanup EXIT
initdb -D "$cluster/data" -U desire_test --auth-local=trust --no-locale > "$cluster/init.log"
pg_ctl -D "$cluster/data" -l "$cluster/server.log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$sockets' -c fsync=off" -w start
export PGHOST="$sockets" PGUSER=desire_test PGDATABASE=postgres
export DESIRE_TEST_SOCKET="$sockets"
# The Rust tests install the schema through the production migration runner and run the SQL
# constraint files against it, so the harness never seeds a second, divergent schema.
cargo test --workspace --locked
