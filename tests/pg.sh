#!/usr/bin/env bash
# Starts a throwaway Postgres and loads every setup script in the order the README gives.
set -e
DIR="${PGTEST_DIR:-/tmp/pl-courier-pg}"
BIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
as_pg() { su postgres -s /bin/bash -c "$1"; }
as_pg "$BIN/pg_ctl -D $DIR stop -m immediate >/dev/null 2>&1 || true"
rm -rf "$DIR"; mkdir -p "$DIR"; chown postgres "$DIR"; chmod 700 "$DIR"
as_pg "$BIN/initdb -D $DIR -A trust -U postgres >/dev/null"
as_pg "$BIN/pg_ctl -D $DIR -o '-p 54329 -k /tmp -c listen_addresses=127.0.0.1' -l $DIR/log -w start >/dev/null"
P="psql -h 127.0.0.1 -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$P -f "$ROOT/tests/supabase-stub.sql"
load() { sed -E '/^create extension if not exists/d' "$1" | $P -f - ; }
load "$ROOT/setup.sql"
load "$ROOT/setup-push.sql"
load "$ROOT/setup-names.sql"
load "$ROOT/setup-phone.sql"
# Two lines that already exist before the courier script runs, as they do in the live project.
$P -c "insert into auth.users (email) values ('jake@crossroadsweddingco.shop'), ('terry@crossroadsweddingco.shop');"
load "$ROOT/setup-courier.sql"
load "$ROOT/setup-courier.sql"  # must be safe to run twice
echo loaded
