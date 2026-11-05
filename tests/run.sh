#!/usr/bin/env bash
# Fresh database, then the SQL suite, then the demo contract. Needs Postgres 16 locally.
set -e
cd "$(dirname "$0")/.."
bash tests/pg.sh >/dev/null 2>&1
node --test --test-reporter=spec tests/sql.test.mjs
node --test --test-reporter=spec tests/contract.test.mjs
