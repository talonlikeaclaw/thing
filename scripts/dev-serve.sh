#!/usr/bin/env bash
# Runs both dev servers in one container: cargo-watch restarts the API on Rust
# changes, Vite serves the SPA with hot module replacement. Either side exiting
# stops the other so the container never looks half-alive.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -x web/node_modules/.bin/vite ]; then
    (cd web && npm ci)
fi

stopping=0
cleanup() {
    if [ "$stopping" = 1 ]; then
        return
    fi
    stopping=1
    trap - EXIT INT TERM
    kill 0
}
trap cleanup EXIT INT TERM

cargo watch -w crates -w Cargo.toml -w Cargo.lock -x 'run -p thing-server' &
(cd web && npm run dev -- --host 0.0.0.0) &
wait -n
