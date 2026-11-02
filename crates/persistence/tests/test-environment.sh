#!/usr/bin/env bash
# Invalid routing is deliberate: this must succeed without consulting libpq environment settings.
set -euo pipefail
cd "$(dirname "$0")/../../.."
PGHOSTADDR=d08-not-a-numeric-address \
PGSERVICE=d08-service-that-does-not-exist \
PGSERVICEFILE=/d08-service-file-that-does-not-exist \
PGPORT=1 PGOPTIONS='-c d08.invalid=1' \
    bash crates/persistence/test-postgres.sh
