#!/usr/bin/env bash
# A socket-only cluster owned by this invocation; never connects to an existing service.
set -euo pipefail
# PostgreSQL rejects a Unix-domain socket path longer than 103 bytes, and a merge candidate's
# checkout path is long enough to overflow it. Enter the checkout through a short symlink, so no
# path this script derives from $PWD follows the depth of the checkout. The cluster and its logs
# still live in the worktree; only the path used to reach them is short.
checkout=$(cd "$(dirname "$0")/../.." && pwd -P)
root=$(mktemp -d /tmp/desire-harness.XXXXXX)
ln -s "$checkout" "$root/checkout"
cd "$root/checkout"
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
trap 'cleanup; rm -rf "${root:-}"' EXIT
initdb -D "$cluster/data" -U desire_test --auth-local=trust --no-locale > "$cluster/init.log"
pg_ctl -D "$cluster/data" -l "$cluster/server.log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$sockets' -c fsync=off" -w start
export PGHOST="$sockets" PGUSER=desire_test PGDATABASE=postgres
export DESIRE_TEST_SOCKET="$sockets"
# The Rust tests install the schema through the production migration runner and run the SQL
# constraint files against it, so the harness never seeds a second, divergent schema.
cargo test --workspace --locked
