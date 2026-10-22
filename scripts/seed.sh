#!/usr/bin/env bash
# Builds the "Garden" demo space through the API: two scheduled types, three
# shared properties, eight records and named views (Plant's default table, a
# room board, a gallery and a watering calendar). Dates are relative to
# Montreal's calendar day so the Schedule page starts with real overdue and
# upcoming work.
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

space="$(request POST /api/spaces \
    '{"name":"Garden","icon":"🪴","timezone":"America/Toronto"}' | json id)"
echo "seed: space $space (America/Toronto)"

# --- relative dates --------------------------------------------------------

# Due and completion dates are civil days in the space zone. Keep the demo
# useful whenever it is run instead of freezing it to one week in 2026.
read -r yesterday today in_two in_three in_fourteen last_three last_four last_six last_eight now in_three_weekday <<< "$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

zone = ZoneInfo("America/Toronto")
today = datetime.now(zone).date()
stamp = datetime.now(timezone.utc).replace(microsecond=0)
def day(offset):
    return (today + timedelta(days=offset)).isoformat()
def at(days_ago):
    return (stamp - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
# Python weekday: Monday=1…Sunday=7; recurrence weekday: Sunday=0…Saturday=6.
print(
    day(-1), day(0), day(2), day(3), day(14),
    at(3), at(4), at(6), at(8), stamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
    (today + timedelta(days=3)).isoweekday() % 7,
)
PY
)"

# --- the types -------------------------------------------------------------

request POST "/api/spaces/$space/types" '{
    "name":"Plant","name_plural":"Plants","icon":"🪴",
    "description":"Everything growing in the flat",
    "schedule":true,
    "schedule_labels":{
        "due":"Next watering",
        "recurrence":"Water every",
        "last_completed":"Last watered",
        "complete":"Water"
    }}' >/dev/null
request POST "/api/spaces/$space/types" '{
    "name":"Chore",
    "schedule":true,
    "schedule_labels":{
        "due":"Due",
        "recurrence":"Repeats",
        "last_completed":"Last done",
        "complete":"Done"
    }}' >/dev/null

# --- the properties --------------------------------------------------------

request POST "/api/spaces/$space/properties" \
    '{"name":"Room","format":"select","options":[
        {"name":"Kitchen","color":"amber"},
        {"name":"Study","color":"blue"},
        {"name":"Balcony","color":"green"}]}' >/dev/null
request POST "/api/spaces/$space/properties" \
    '{"name":"Tags","format":"multi_select","options":[
        {"name":"Easy","color":"green"},
        {"name":"Indoors","color":"blue"}]}' >/dev/null
request POST "/api/spaces/$space/properties" \
    '{"name":"Related plant","format":"relation","target_type":"plant"}' >/dev/null
echo "seed: properties room, tags, related_plant"

# --- what each type shows --------------------------------------------------

request PATCH "/api/spaces/$space/types/plant" '{
    "properties": [
        {"key":"room","featured":true},
        {"key":"tags"},
        {"key":"related_plant"}
    ]}' >/dev/null
request PATCH "/api/spaces/$space/types/plant/views/all" '{
    "columns": ["title","room","due_date","recurrence","last_completed_at","tags","related_plant"],
    "widths": {"title":280,"due_date":160},
    "sorts": [{"property":"updated_at","direction":"desc"}],
    "filter": {"op":"and","conditions":[]}
}' >/dev/null
request POST "/api/spaces/$space/types/plant/views" '{
    "name":"By room","kind":"board","group_by":"room",
    "columns": ["title","due_date","recurrence"],
    "sorts": [{"property":"due_date","direction":"asc"}]
}' >/dev/null
request POST "/api/spaces/$space/types/plant/views" '{
    "name":"Gallery","kind":"gallery","cover":"room",
    "columns": ["title","due_date","tags"]
}' >/dev/null
request POST "/api/spaces/$space/types/plant/views" '{
    "name":"Watering","kind":"calendar","date_property":"due_date",
    "sorts": [{"property":"due_date","direction":"asc"}]
}' >/dev/null
request PATCH "/api/spaces/$space/types/chore" '{
    "properties": [
        {"key":"room","featured":true}
    ]}' >/dev/null
request PATCH "/api/spaces/$space/types/chore/views/all" '{
    "columns": ["title","room","due_date","recurrence","last_completed_at"],
    "sorts": [{"property":"updated_at","direction":"desc"}],
    "filter": {"op":"and","conditions":[]}
}' >/dev/null
echo "seed: type views set"

# --- the records -----------------------------------------------------------

fiddle="$(object plant "Fiddle-leaf fig" \
    "{\"room\":\"study\",\"due_date\":\"$in_two\",\"recurrence\":{\"kind\":\"days\",\"every\":10},\"last_completed_at\":\"$last_eight\",\"tags\":[\"indoors\"]}" \
    "
Repotted in spring; leaves wiped every other week.
")"
monstera="$(object plant "Monstera in the study" \
    "{\"room\":\"kitchen\",\"due_date\":\"$yesterday\",\"recurrence\":{\"kind\":\"days\",\"every\":7},\"last_completed_at\":\"$last_eight\",\"tags\":[\"easy\",\"indoors\"],\"related_plant\":\"$fiddle\"}" \
    "
Watered this week, new leaf unfurling at the top.
")"
object plant "Balcony herbs" \
    "{\"room\":\"balcony\",\"due_date\":\"$today\",\"recurrence\":{\"kind\":\"days\",\"every\":3},\"last_completed_at\":\"$last_three\",\"tags\":[\"easy\"]}" \
    "
Basil, mint and thyme in one trough.
" >/dev/null
object plant "Snake plant" \
    "{\"room\":\"study\",\"due_date\":\"$in_fourteen\",\"recurrence\":{\"kind\":\"days\",\"every\":14},\"last_completed_at\":\"$now\",\"tags\":[\"easy\"]}" \
    "
Nearly impossible to kill; water it when the soil is dry.
" >/dev/null
object chore "Water the monstera" \
    "{\"room\":\"kitchen\",\"due_date\":\"$yesterday\",\"recurrence\":{\"kind\":\"days\",\"every\":3},\"last_completed_at\":\"$last_four\"}" >/dev/null
object chore "Dust the shelves" \
    "{\"room\":\"study\",\"due_date\":\"$in_three\",\"recurrence\":{\"kind\":\"weekly\",\"every\":1,\"weekday\":$in_three_weekday},\"last_completed_at\":\"$last_four\"}" >/dev/null
object chore "Sweep the balcony" \
    "{\"room\":\"balcony\",\"due_date\":\"$in_two\"}" >/dev/null
object chore "Repot the fiddle-leaf" \
    "{\"room\":\"study\",\"last_completed_at\":\"$last_six\"}" >/dev/null

echo "seed: 8 objects"
echo
echo "space:      $space"
echo "timezone:   America/Toronto"
echo "browse:     $BASE/s/$space/t/plant"
echo "the file:   ${THING_DATA_DIR:-./data}/spaces/$space/objects/plant/monstera-in-the-study.md"
echo "the record: ${THING_DATA_DIR:-./data}/spaces/$space/history/$monstera.ndjson"
