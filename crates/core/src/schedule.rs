//! Scheduling's shared vocabulary: the generated property definitions, the
//! recurrence shape, and the rules that keep a recurrence unambiguous.
//!
//! Date arithmetic and completion live here too, once M2 is implemented; this
//! module is the only place that knows what a due date means.

use std::collections::BTreeMap;

use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::{Span, Timestamp};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::CoreError;
use crate::model::{
    ObjectDoc, PropertyDef, PropertyFormat, Recurrence, RecurrenceKind, TypeDef, Value,
};
use crate::value;

/// The property key a scheduled record's due day is stored under.
pub const DUE_DATE_KEY: &str = "due_date";
/// The property key a scheduled record's recurrence is stored under.
pub const RECURRENCE_KEY: &str = "recurrence";
/// The property key a scheduled record's last completion is stored under.
pub const LAST_COMPLETED_KEY: &str = "last_completed_at";

/// Every generated schedule key, in display order.
pub const SCHEDULE_KEYS: [&str; 3] = [DUE_DATE_KEY, RECURRENCE_KEY, LAST_COMPLETED_KEY];

/// Whether a property key belongs to the scheduling vocabulary. Such a key may
/// never be declared in `properties/`, whether or not a type is scheduled.
pub fn is_schedule_key(key: &str) -> bool {
    SCHEDULE_KEYS.contains(&key)
}

/// The three property definitions every scheduled type exposes. They are
/// generated, never written to `properties/<key>.yml`.
pub fn schedule_property_defs() -> BTreeMap<String, PropertyDef> {
    let def = |key: &str, name: &str, format| PropertyDef {
        key: key.to_owned(),
        name: name.to_owned(),
        format,
        options: Vec::new(),
        target_type: None,
        multi: false,
    };
    BTreeMap::from([
        (
            DUE_DATE_KEY.to_owned(),
            def(DUE_DATE_KEY, "Due", PropertyFormat::Date),
        ),
        (
            RECURRENCE_KEY.to_owned(),
            def(RECURRENCE_KEY, "Repeats", PropertyFormat::Recurrence),
        ),
        (
            LAST_COMPLETED_KEY.to_owned(),
            def(
                LAST_COMPLETED_KEY,
                "Last completed",
                PropertyFormat::Datetime,
            ),
        ),
    ])
}

/// Checks the shape of a recurrence: a bounded interval, a weekday only for
/// weekly, a month day only for monthly, and no irrelevant field left over.
pub fn validate_recurrence(recurrence: &Recurrence) -> Result<(), CoreError> {
    let invalid = |message: &str| CoreError::ValidationFailed {
        field: RECURRENCE_KEY.to_owned(),
        message: message.to_owned(),
    };
    if !(1..=1000).contains(&recurrence.every) {
        return Err(invalid("the interval must be between 1 and 1000"));
    }
    match recurrence.kind {
        RecurrenceKind::Days => {
            if recurrence.weekday.is_some() || recurrence.day.is_some() {
                return Err(invalid("a days recurrence does not take a weekday or day"));
            }
        }
        RecurrenceKind::Weekly => {
            if recurrence.weekday.is_none_or(|weekday| weekday > 6) {
                return Err(invalid("a weekly recurrence needs a weekday from 0 to 6"));
            }
            if recurrence.day.is_some() {
                return Err(invalid("a weekly recurrence does not take a day"));
            }
        }
        RecurrenceKind::Monthly => {
            if recurrence.day.is_none_or(|day| !(1..=31).contains(&day)) {
                return Err(invalid("a monthly recurrence needs a day from 1 to 31"));
            }
            if recurrence.weekday.is_some() {
                return Err(invalid("a monthly recurrence does not take a weekday"));
            }
        }
    }
    Ok(())
}

/// A recurrence as one line of prose, for tables and the API.
pub fn recurrence_label(recurrence: &Recurrence) -> String {
    match recurrence.kind {
        RecurrenceKind::Days => {
            if recurrence.every == 1 {
                "Every day".to_owned()
            } else {
                format!("Every {} days", recurrence.every)
            }
        }
        RecurrenceKind::Weekly => {
            let on = recurrence
                .weekday
                .and_then(weekday_name)
                .map(|name| format!(" on {name}"))
                .unwrap_or_default();
            if recurrence.every == 1 {
                format!("Every week{on}")
            } else {
                format!("Every {} weeks{on}", recurrence.every)
            }
        }
        RecurrenceKind::Monthly => {
            let on = recurrence
                .day
                .map(|day| format!(" on day {day}"))
                .unwrap_or_default();
            if recurrence.every == 1 {
                format!("Every month{on}")
            } else {
                format!("Every {} months{on}", recurrence.every)
            }
        }
    }
}

/// `0`=Sunday through `6`=Saturday, matching the on-disk weekday.
pub fn weekday_name(weekday: u8) -> Option<&'static str> {
    Some(match weekday {
        0 => "Sunday",
        1 => "Monday",
        2 => "Tuesday",
        3 => "Wednesday",
        4 => "Thursday",
        5 => "Friday",
        6 => "Saturday",
        _ => return None,
    })
}

/// Where a scheduled record stands relative to its space's today.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DueStatus {
    Unscheduled,
    Done,
    Overdue,
    Today,
    Upcoming,
}

/// A scheduled record's derived timing. Computed on read; never stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduleState {
    pub due_date: Option<Date>,
    pub status: DueStatus,
    pub days_until_due: Option<i64>,
    pub last_completed_at: Option<OffsetDateTime>,
}

/// Resolves an IANA zone name, the only way a space's zone is interpreted.
pub fn resolve_timezone(name: &str) -> Result<TimeZone, CoreError> {
    TimeZone::get(name).map_err(|_| CoreError::ValidationFailed {
        field: "timezone".to_owned(),
        message: format!("unknown time zone {name}"),
    })
}

/// The civil date `now` falls on in `timezone`.
pub fn today_in(timezone: &TimeZone, now: OffsetDateTime) -> Date {
    timestamp(now).to_zoned(timezone.clone()).date()
}

/// The due day after completing a recurring record.
///
/// A late completion re-phases from `base` (today); an early one preserves the
/// planned cadence because the caller passes the existing due date.
pub fn advance(base: Date, recurrence: &Recurrence) -> Date {
    let every = i64::from(recurrence.every);
    match recurrence.kind {
        RecurrenceKind::Days => base
            .checked_add(Span::new().days(every))
            .unwrap_or(Date::MAX),
        RecurrenceKind::Weekly => {
            let target = i64::from(recurrence.weekday.unwrap_or(0));
            let current = i64::from(base.weekday().to_sunday_zero_offset());
            let mut delta = (target - current).rem_euclid(7);
            if delta == 0 {
                delta = 7;
            }
            base.checked_add(Span::new().days(delta + 7 * (every - 1)))
                .unwrap_or(Date::MAX)
        }
        RecurrenceKind::Monthly => {
            let day = i64::from(recurrence.day.unwrap_or(1));
            let start = i64::from(base.year()) * 12 + i64::from(base.month()) - 1;
            let mut step = 0;
            loop {
                let total = start + step * every;
                let year = total.div_euclid(12);
                let month = total.rem_euclid(12) + 1;
                let candidate = month_date(year, month, day);
                if candidate > base || year > i64::from(Date::MAX.year()) {
                    return candidate;
                }
                step += 1;
            }
        }
    }
}

/// What a scheduled record's timing is today, or `None` for an unscheduled
/// type.
pub fn state(
    def: &TypeDef,
    doc: &ObjectDoc,
    timezone: &TimeZone,
    now: OffsetDateTime,
) -> Option<ScheduleState> {
    if !def.schedule {
        return None;
    }
    let due_date = due_date(doc).ok().flatten();
    let last_completed_at = doc
        .properties
        .get(LAST_COMPLETED_KEY)
        .and_then(text)
        .and_then(value::parse_datetime);
    let today = today_in(timezone, now);
    let (status, days_until_due) = match due_date {
        Some(due) => {
            let days = due
                .since(today)
                .map(|span| i64::from(span.get_days()))
                .unwrap_or(0);
            let status = if days < 0 {
                DueStatus::Overdue
            } else if days == 0 {
                DueStatus::Today
            } else {
                DueStatus::Upcoming
            };
            (status, Some(days))
        }
        None if last_completed_at.is_some() => (DueStatus::Done, None),
        None => (DueStatus::Unscheduled, None),
    };
    Some(ScheduleState {
        due_date,
        status,
        days_until_due,
        last_completed_at,
    })
}

/// Records a completion in `doc.properties`, returning the updated document.
///
/// The server owns `rev`, `updated_at`, `updated_by`, the file path and the
/// revision append; this only moves the schedule fields.
pub fn complete(
    def: &TypeDef,
    doc: &ObjectDoc,
    timezone: &TimeZone,
    now: OffsetDateTime,
) -> Result<ObjectDoc, CoreError> {
    if !def.schedule {
        return Err(CoreError::ValidationFailed {
            field: "schedule".to_owned(),
            message: "this type is not scheduled".to_owned(),
        });
    }
    let due = due_date(doc)?;
    let recurrence = match doc.properties.get(RECURRENCE_KEY) {
        Some(Value::Recurrence(recurrence)) => {
            validate_recurrence(recurrence)?;
            Some(*recurrence)
        }
        Some(_) => {
            return Err(CoreError::ValidationFailed {
                field: RECURRENCE_KEY.to_owned(),
                message: "expected a recurrence".to_owned(),
            });
        }
        None => None,
    };
    let mut doc = doc.clone();
    match recurrence {
        None => {
            doc.properties.remove(DUE_DATE_KEY);
        }
        Some(recurrence) => {
            let today = today_in(timezone, now);
            let base = due.map_or(today, |due| due.max(today));
            let next = advance(base, &recurrence);
            doc.properties
                .insert(DUE_DATE_KEY.to_owned(), Value::Text(format_date(next)));
        }
    }
    doc.properties.insert(
        LAST_COMPLETED_KEY.to_owned(),
        Value::Text(format_datetime(now)?),
    );
    Ok(doc)
}

/// The due date stored on `doc`, distinguishing absent from malformed.
fn due_date(doc: &ObjectDoc) -> Result<Option<Date>, CoreError> {
    match doc.properties.get(DUE_DATE_KEY) {
        None => Ok(None),
        Some(value) => text(value)
            .and_then(|raw| raw.parse::<Date>().ok())
            .map(Some)
            .ok_or_else(|| CoreError::ValidationFailed {
                field: DUE_DATE_KEY.to_owned(),
                message: "expected a YYYY-MM-DD date".to_owned(),
            }),
    }
}

fn text(value: &Value) -> Option<&str> {
    match value {
        Value::Text(text) => Some(text),
        _ => None,
    }
}

/// A clamped `year-month-day`, never rolled into the next month.
fn month_date(year: i64, month: i64, day: i64) -> Date {
    let first = Date::new(year as i16, month as i8, 1).unwrap_or(Date::MAX);
    let day = day.min(i64::from(first.days_in_month()));
    Date::new(year as i16, month as i8, day as i8).unwrap_or(Date::MAX)
}

fn format_date(date: Date) -> String {
    format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day())
}

fn format_datetime(now: OffsetDateTime) -> Result<String, CoreError> {
    now.format(&Rfc3339)
        .map_err(|_| CoreError::ValidationFailed {
            field: LAST_COMPLETED_KEY.to_owned(),
            message: "could not format the completion time".to_owned(),
        })
}

/// `time` to `jiff` at the boundary; both carry the same instant.
fn timestamp(now: OffsetDateTime) -> Timestamp {
    Timestamp::from_nanosecond(now.unix_timestamp_nanos()).unwrap_or(Timestamp::UNIX_EPOCH)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Filter, FilterOp, ViewDef};
    use uuid::Uuid;

    fn recurrence(kind: RecurrenceKind, every: u32) -> Recurrence {
        Recurrence {
            kind,
            every,
            weekday: None,
            day: None,
        }
    }

    fn at(text: &str) -> OffsetDateTime {
        OffsetDateTime::parse(text, &Rfc3339).expect("valid timestamp")
    }

    fn date(text: &str) -> Date {
        text.parse().expect("valid date")
    }

    fn zone(name: &str) -> TimeZone {
        resolve_timezone(name).expect("known zone")
    }

    fn type_def(schedule: bool) -> TypeDef {
        TypeDef {
            key: "chore".to_owned(),
            name: "Chore".to_owned(),
            name_plural: "Chores".to_owned(),
            icon: None,
            description: String::new(),
            schedule,
            properties: Vec::new(),
            view: ViewDef {
                sorts: Vec::new(),
                filter: Filter {
                    op: FilterOp::And,
                    conditions: Vec::new(),
                },
                columns: vec!["title".to_owned()],
            },
        }
    }

    fn doc(properties: &[(&str, Value)]) -> ObjectDoc {
        let now = at("2026-10-21T07:12:00Z");
        ObjectDoc {
            id: Uuid::now_v7(),
            type_key: "chore".to_owned(),
            title: "Water the monstera".to_owned(),
            rev: 3,
            created_at: now,
            updated_at: now,
            created_by: Uuid::now_v7(),
            updated_by: Uuid::now_v7(),
            trashed_at: None,
            trashed_from: None,
            properties: properties
                .iter()
                .map(|(key, value)| ((*key).to_owned(), value.clone()))
                .collect(),
            body: String::new(),
        }
    }

    fn completed_at(doc: &ObjectDoc) -> OffsetDateTime {
        doc.properties
            .get(LAST_COMPLETED_KEY)
            .and_then(text)
            .and_then(value::parse_datetime)
            .expect("completion recorded")
    }

    fn due(doc: &ObjectDoc) -> Date {
        due_date(doc).ok().flatten().expect("due date recorded")
    }

    #[test]
    fn the_generated_definitions_are_the_three_documented_keys() {
        let defs = schedule_property_defs();
        assert_eq!(
            defs.keys().collect::<Vec<_>>(),
            vec![DUE_DATE_KEY, LAST_COMPLETED_KEY, RECURRENCE_KEY]
        );
        assert_eq!(defs[DUE_DATE_KEY].format, PropertyFormat::Date);
        assert_eq!(defs[RECURRENCE_KEY].format, PropertyFormat::Recurrence);
        assert_eq!(defs[LAST_COMPLETED_KEY].format, PropertyFormat::Datetime);
    }

    #[test]
    fn only_the_three_keys_are_schedule_keys() {
        for key in SCHEDULE_KEYS {
            assert!(is_schedule_key(key));
        }
        assert!(!is_schedule_key("due"));
        assert!(!is_schedule_key("repeats"));
    }

    #[test]
    fn intervals_are_bounded() {
        for every in [0, 1001] {
            assert!(validate_recurrence(&recurrence(RecurrenceKind::Days, every)).is_err());
        }
        assert!(validate_recurrence(&recurrence(RecurrenceKind::Days, 1)).is_ok());
        assert!(validate_recurrence(&recurrence(RecurrenceKind::Days, 1000)).is_ok());
    }

    #[test]
    fn each_kind_takes_only_its_own_fields() {
        let mut daily = recurrence(RecurrenceKind::Days, 3);
        daily.weekday = Some(1);
        assert!(validate_recurrence(&daily).is_err());

        let mut weekly = recurrence(RecurrenceKind::Weekly, 2);
        assert!(validate_recurrence(&weekly).is_err());
        weekly.weekday = Some(1);
        assert!(validate_recurrence(&weekly).is_ok());
        weekly.day = Some(1);
        assert!(validate_recurrence(&weekly).is_err());

        let mut monthly = recurrence(RecurrenceKind::Monthly, 1);
        assert!(validate_recurrence(&monthly).is_err());
        monthly.day = Some(31);
        assert!(validate_recurrence(&monthly).is_ok());
        monthly.weekday = Some(0);
        assert!(validate_recurrence(&monthly).is_err());
    }

    #[test]
    fn labels_name_the_interval_and_the_selected_day() {
        assert_eq!(
            recurrence_label(&recurrence(RecurrenceKind::Days, 1)),
            "Every day"
        );
        assert_eq!(
            recurrence_label(&recurrence(RecurrenceKind::Days, 3)),
            "Every 3 days"
        );
        let mut weekly = recurrence(RecurrenceKind::Weekly, 2);
        weekly.weekday = Some(1);
        assert_eq!(recurrence_label(&weekly), "Every 2 weeks on Monday");
        let mut monthly = recurrence(RecurrenceKind::Monthly, 1);
        monthly.day = Some(31);
        assert_eq!(recurrence_label(&monthly), "Every month on day 31");
    }

    #[test]
    fn a_days_recurrence_adds_whole_civil_days() {
        let every_three = recurrence(RecurrenceKind::Days, 3);
        assert_eq!(
            advance(date("2026-10-20"), &every_three),
            date("2026-10-23")
        );
        // Across a DST change: still exactly one calendar day.
        let daily = recurrence(RecurrenceKind::Days, 1);
        assert_eq!(advance(date("2026-03-29"), &daily), date("2026-03-30"));
        assert_eq!(advance(date("2026-10-25"), &daily), date("2026-10-26"));
    }

    #[test]
    fn a_weekly_recurrence_moves_to_the_selected_weekday() {
        let mut weekly = recurrence(RecurrenceKind::Weekly, 1);
        // 2026-10-21 is a Wednesday (3); the same weekday means next week.
        weekly.weekday = Some(3);
        assert_eq!(advance(date("2026-10-21"), &weekly), date("2026-10-28"));
        weekly.weekday = Some(1);
        assert_eq!(advance(date("2026-10-21"), &weekly), date("2026-10-26"));
        weekly.every = 3;
        assert_eq!(advance(date("2026-10-21"), &weekly), date("2026-11-09"));
    }

    #[test]
    fn a_monthly_recurrence_clamps_to_the_month_end() {
        let mut monthly = recurrence(RecurrenceKind::Monthly, 1);
        monthly.day = Some(31);
        assert_eq!(advance(date("2026-01-31"), &monthly), date("2026-02-28"));
        assert_eq!(advance(date("2028-01-31"), &monthly), date("2028-02-29"));
        // From the clamped February day, the next month returns to day 31.
        assert_eq!(advance(date("2026-02-28"), &monthly), date("2026-03-31"));
        monthly.every = 2;
        assert_eq!(advance(date("2026-01-31"), &monthly), date("2026-03-31"));
        assert_eq!(advance(date("2026-03-31"), &monthly), date("2026-05-31"));
    }

    #[test]
    fn a_late_completion_re_phases_from_today() {
        let now = at("2026-10-21T07:12:00Z");
        let recurrence = recurrence(RecurrenceKind::Days, 3);
        let original = doc(&[
            (DUE_DATE_KEY, Value::Text("2026-10-20".to_owned())),
            (RECURRENCE_KEY, Value::Recurrence(recurrence)),
        ]);
        let updated = complete(&type_def(true), &original, &zone("UTC"), now).expect("completes");
        assert_eq!(due(&updated), date("2026-10-24"));
        assert_eq!(completed_at(&updated), now);
        // The input is untouched; Complete returns a new document.
        assert_eq!(due(&original), date("2026-10-20"));
    }

    #[test]
    fn an_early_completion_preserves_the_planned_cadence() {
        let now = at("2026-10-21T07:12:00Z");
        let mut recurrence = recurrence(RecurrenceKind::Days, 3);
        recurrence.every = 3;
        let original = doc(&[
            (DUE_DATE_KEY, Value::Text("2026-10-25".to_owned())),
            (RECURRENCE_KEY, Value::Recurrence(recurrence)),
        ]);
        let updated = complete(&type_def(true), &original, &zone("UTC"), now).expect("completes");
        assert_eq!(due(&updated), date("2026-10-28"));
        assert_eq!(completed_at(&updated), now);
    }

    #[test]
    fn a_one_off_completion_clears_the_due_date() {
        let now = at("2026-10-21T07:12:00Z");
        let original = doc(&[(DUE_DATE_KEY, Value::Text("2026-10-20".to_owned()))]);
        let updated = complete(&type_def(true), &original, &zone("UTC"), now).expect("completes");
        assert!(!updated.properties.contains_key(DUE_DATE_KEY));
        assert_eq!(completed_at(&updated), now);
        let state = state(&type_def(true), &updated, &zone("UTC"), now).expect("scheduled");
        assert_eq!(state.status, DueStatus::Done);
        assert_eq!(state.days_until_due, None);
    }

    #[test]
    fn completing_an_unscheduled_type_is_a_validation_failure() {
        let now = at("2026-10-21T07:12:00Z");
        let err =
            complete(&type_def(false), &doc(&[]), &zone("UTC"), now).expect_err("unscheduled type");
        assert_eq!(
            err.to_string(),
            "invalid schedule: this type is not scheduled"
        );
    }

    #[test]
    fn state_derives_status_and_whole_day_distance() {
        let now = at("2026-10-21T07:12:00Z");
        let utc = zone("UTC");
        let def = type_def(true);
        let at_date = |text: &str| doc(&[(DUE_DATE_KEY, Value::Text(text.to_owned()))]);

        let overdue = state(&def, &at_date("2026-10-18"), &utc, now).expect("scheduled");
        assert_eq!(overdue.status, DueStatus::Overdue);
        assert_eq!(overdue.days_until_due, Some(-3));

        let today = state(&def, &at_date("2026-10-21"), &utc, now).expect("scheduled");
        assert_eq!(today.status, DueStatus::Today);
        assert_eq!(today.days_until_due, Some(0));

        let upcoming = state(&def, &at_date("2026-10-23"), &utc, now).expect("scheduled");
        assert_eq!(upcoming.status, DueStatus::Upcoming);
        assert_eq!(upcoming.days_until_due, Some(2));

        let bare = state(&def, &doc(&[]), &utc, now).expect("scheduled");
        assert_eq!(bare.status, DueStatus::Unscheduled);
        assert_eq!(bare.due_date, None);
        assert_eq!(
            state(&type_def(false), &at_date("2026-10-23"), &utc, now),
            None
        );
    }

    #[test]
    fn timezone_boundaries_pick_the_space_day() {
        // 02:00Z is still the previous evening in California.
        assert_eq!(
            today_in(&zone("America/Los_Angeles"), at("2026-10-21T02:00:00Z")),
            date("2026-10-20")
        );
        // 12:00Z is already tomorrow in Kiritimati (UTC+14).
        assert_eq!(
            today_in(&zone("Pacific/Kiritimati"), at("2026-10-21T12:00:00Z")),
            date("2026-10-22")
        );
    }

    #[test]
    fn dst_changes_do_not_shift_a_due_day() {
        let berlin = zone("Europe/Berlin");
        // Spring forward is 2026-03-29 at 01:00Z; the civil day is unchanged.
        assert_eq!(
            today_in(&berlin, at("2026-03-28T23:30:00Z")),
            date("2026-03-29")
        );
        assert_eq!(
            today_in(&berlin, at("2026-03-29T00:30:00Z")),
            date("2026-03-29")
        );
        // Fall back is 2026-10-25 at 01:00Z.
        assert_eq!(
            today_in(&berlin, at("2026-10-25T00:30:00Z")),
            date("2026-10-25")
        );

        let mut weekly = recurrence(RecurrenceKind::Weekly, 1);
        weekly.weekday = Some(0);
        assert_eq!(advance(date("2026-03-23"), &weekly), date("2026-03-29"));
        assert_eq!(advance(date("2026-03-29"), &weekly), date("2026-04-05"));
    }

    #[test]
    fn an_unknown_timezone_names_the_field() {
        let err = resolve_timezone("Mars/Olympus_Mons").expect_err("unknown zone");
        assert!(matches!(
            &err,
            CoreError::ValidationFailed { field, .. } if field == "timezone"
        ));
        assert_eq!(
            err.to_string(),
            "invalid timezone: unknown time zone Mars/Olympus_Mons"
        );
    }

    #[test]
    fn a_completion_uses_the_space_day_to_choose_the_base() {
        // 23:30Z on the 20th is already the 21st in Kiritimati, so a due date
        // of the 20th is late and the next due date starts from the 21st.
        let now = at("2026-10-20T23:30:00Z");
        let recurrence = recurrence(RecurrenceKind::Days, 3);
        let original = doc(&[
            (DUE_DATE_KEY, Value::Text("2026-10-20".to_owned())),
            (RECURRENCE_KEY, Value::Recurrence(recurrence)),
        ]);
        let updated = complete(&type_def(true), &original, &zone("Pacific/Kiritimati"), now)
            .expect("completes");
        assert_eq!(due(&updated), date("2026-10-24"));
    }
}
