#!/usr/bin/env bash
# Builds the "Garden" demo space through the API, exactly as the M1 plan's
# smoke test describes it: two types, six properties and eight records.
#
#   THING_DATA_DIR=./data cargo run -p thing-server &
#   scripts/seed.sh
#
# It signs in as THING_SEED_EMAIL, registering that account if the install has
# no users yet, and makes a new Garden space on every run.

set -euo pipefail

BASE="${THING_BASE:-http://127.0.0.1:8080}"
EMAIL="${THING_SEED_EMAIL:-a@b.c}"
PASSWORD="${THING_SEED_PASSWORD:-}"
NAME="${THING_SEED_NAME:-Talon}"

JAR="$(mktemp)"
BODY_FILE="$(mktemp)"
trap 'rm -f "$JAR" "$BODY_FILE"' EXIT

die() {
    echo "seed: $*" >&2
    exit 1
}

[ -n "$PASSWORD" ] || die "set THING_SEED_PASSWORD; this script does not ship a default"

# request METHOD PATH [JSON] — prints the response body, fails on a non-2xx.
request() {
    local method="$1" path="$2" body="${3-}" status
    local args=(-sS -o "$BODY_FILE" -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method")
    if [ -n "$body" ]; then
        # The body can carry the seed password; stdin keeps it out of `ps`.
        status="$(printf '%s' "$body" | curl "${args[@]}" -H 'content-type: application/json' --data-binary @- "$BASE$path")"
    else
        status="$(curl "${args[@]}" "$BASE$path")"
    fi
    if [ "${status:0:1}" != "2" ]; then
        echo "seed: $method $path returned $status:" >&2
        cat "$BODY_FILE" >&2
        echo >&2
        exit 1
    fi
    cat "$BODY_FILE"
}

# Unchecked, for the sign-in probe: prints the status code.
status_of() {
    local method="$1" path="$2" body="$3"
    printf '%s' "$body" | curl -sS -o "$BODY_FILE" -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method" \
        -H 'content-type: application/json' --data-binary @- "$BASE$path"
}

# json KEY — reads one field out of a JSON object on stdin.
json() {
    python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"
}

# object TYPE TITLE PROPERTIES_JSON [BODY] — prints the new object's id.
object() {
    request POST "/api/spaces/$space/objects" "$(
        python3 -c '
import json, sys
print(json.dumps({
    "type": sys.argv[1],
    "title": sys.argv[2],
    "properties": json.loads(sys.argv[3]),
    "body": sys.argv[4],
}))
' "$1" "$2" "$3" "${4-}"
    )" | json id
}

login_body="$(THING_SEED_EMAIL="$EMAIL" THING_SEED_PASSWORD="$PASSWORD" python3 -c 'import json, os; print(json.dumps({"email": os.environ["THING_SEED_EMAIL"], "password": os.environ["THING_SEED_PASSWORD"]}))')"
register_body="$(THING_SEED_EMAIL="$EMAIL" THING_SEED_PASSWORD="$PASSWORD" THING_SEED_NAME="$NAME" python3 -c 'import json, os; print(json.dumps({"email": os.environ["THING_SEED_EMAIL"], "password": os.environ["THING_SEED_PASSWORD"], "name": os.environ["THING_SEED_NAME"]}))')"

# Sign in; the first account of an empty install needs no invite.
if [ "$(status_of POST /api/auth/login "$login_body")" != "200" ]; then
    status="$(status_of POST /api/auth/register "$register_body")"
    case "$status" in
        201) ;;
        422) die "$EMAIL is not registered here and cannot register without an invite" ;;
        *) die "registering $EMAIL returned $status" ;;
    esac
fi
echo "seed: signed in as $EMAIL"

# --- the space -------------------------------------------------------------

space="$(request POST /api/spaces '{"name":"Garden","icon":"🪴"}' | json id)"
echo "seed: space $space"

# --- the types -------------------------------------------------------------

request POST "/api/spaces/$space/types" \
    '{"name":"Plant","name_plural":"Plants","icon":"🪴","description":"Everything growing in the flat"}' >/dev/null
request POST "/api/spaces/$space/types" '{"name":"Chore"}' >/dev/null

# --- the properties --------------------------------------------------------

request POST "/api/spaces/$space/properties" \
    '{"name":"Room","format":"select","options":[
        {"name":"Kitchen","color":"amber"},
        {"name":"Study","color":"blue"},
        {"name":"Balcony","color":"green"}]}' >/dev/null
request POST "/api/spaces/$space/properties" \
    '{"name":"Watering interval days","format":"number"}' >/dev/null
request POST "/api/spaces/$space/properties" \
    '{"name":"Last watered","format":"date"}' >/dev/null
request POST "/api/spaces/$space/properties" \
    '{"name":"Tags","format":"multi_select","options":[
        {"name":"Easy","color":"green"},
        {"name":"Indoors","color":"blue"}]}' >/dev/null
request POST "/api/spaces/$space/properties" \
    '{"name":"Related plant","format":"relation","target_type":"plant"}' >/dev/null
echo "seed: properties room, watering_interval_days, last_watered, tags, related_plant"

# --- what each type shows --------------------------------------------------

request PATCH "/api/spaces/$space/types/plant" '{
    "properties": [
        {"key":"room","featured":true},
        {"key":"watering_interval_days","featured":true},
        {"key":"last_watered"},
        {"key":"tags"},
        {"key":"related_plant"}
    ],
    "view": {
        "columns": ["title","room","watering_interval_days","last_watered","tags","related_plant"],
        "sorts": [{"property":"updated_at","direction":"desc"}],
        "filter": {"op":"and","conditions":[]}
    }}' >/dev/null
request PATCH "/api/spaces/$space/types/chore" '{
    "properties": [
        {"key":"room","featured":true},
        {"key":"last_watered","featured":true}
    ],
    "view": {
        "columns": ["title","room","last_watered"],
        "sorts": [{"property":"updated_at","direction":"desc"}],
        "filter": {"op":"and","conditions":[]}
    }}' >/dev/null
echo "seed: type views set"

# --- the records -----------------------------------------------------------

fiddle="$(object plant "Fiddle-leaf fig" \
    '{"room":"study","watering_interval_days":10,"last_watered":"2026-10-10","tags":["indoors"]}' \
    "
Repotted in spring; leaves wiped every other week.
")"
monstera="$(object plant "Monstera in the study" \
    "{\"room\":\"kitchen\",\"watering_interval_days\":7,\"last_watered\":\"2026-10-15\",\"tags\":[\"easy\",\"indoors\"],\"related_plant\":\"$fiddle\"}" \
    "
Watered today, new leaf unfurling at the top.
")"
object plant "Balcony herbs" \
    '{"room":"balcony","watering_interval_days":3,"last_watered":"2026-10-16","tags":["easy"]}' \
    "
Basil, mint and thyme in one trough.
" >/dev/null
object plant "Snake plant" \
    '{"room":"study","watering_interval_days":14,"last_watered":"2026-09-30","tags":["easy"]}' \
    "
Nearly impossible to kill; water it when the soil is dry.
" >/dev/null
object chore "Water the monstera" \
    '{"room":"kitchen","last_watered":"2026-10-15"}' >/dev/null
object chore "Dust the shelves" \
    '{"room":"study","last_watered":"2026-10-08"}' >/dev/null
object chore "Sweep the balcony" \
    '{"room":"balcony","last_watered":"2026-10-12"}' >/dev/null
object chore "Repot the fiddle-leaf" \
    '{"room":"study"}' >/dev/null

echo "seed: 8 objects"
echo
echo "space:      $space"
echo "browse:     $BASE/s/$space/t/plant"
echo "the file:   ${THING_DATA_DIR:-./data}/spaces/$space/objects/plant/monstera-in-the-study.md"
echo "the record: ${THING_DATA_DIR:-./data}/spaces/$space/history/$monstera.ndjson"
