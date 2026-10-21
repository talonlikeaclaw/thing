//! Scheduling's shared vocabulary: the generated property definitions, the
//! recurrence shape, and the rules that keep a recurrence unambiguous.
//!
//! Date arithmetic and completion live here too, once M2 is implemented; this
//! module is the only place that knows what a due date means.

use std::collections::BTreeMap;

use crate::error::CoreError;
use crate::model::{PropertyDef, PropertyFormat, Recurrence, RecurrenceKind};

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

#[cfg(test)]
mod tests {
    use super::*;

    fn recurrence(kind: RecurrenceKind, every: u32) -> Recurrence {
        Recurrence {
            kind,
            every,
            weekday: None,
            day: None,
        }
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
}
