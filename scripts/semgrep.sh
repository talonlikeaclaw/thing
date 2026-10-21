#!/usr/bin/env bash
# The repository's Semgrep gate: the same command CI runs. Pinned to the image
# digest so a local scan and CI scan use the same engine.
set -euo pipefail

cd "$(dirname "$0")/.."

exec docker run --rm -v "$PWD:/src" -w /src \
    semgrep/semgrep@sha256:81474464c1f07483ba0682a44787fd93c91397419762a04abe2bafaae396304b \
    semgrep scan --metrics=off --error \
    --config p/rust \
    --config p/dockerfile \
    --config p/docker-compose \
    --config p/secrets \
    --config p/owasp-top-ten \
    --exclude target \
    --exclude web/node_modules \
    --exclude web/dist \
    --exclude data \
    "$@"
