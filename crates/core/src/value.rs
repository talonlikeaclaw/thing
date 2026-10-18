//! Per-format value conversion and ordering.
//!
//! Frontmatter, history and the HTTP API all spell a value three ways: YAML,
//! JSON and [`Value`]. Documents embed a value through `Value`'s derived serde
//! impls; the functions here are for callers that hold the property key, so a
//! failure reads `invalid days: expected a number, found text`.

use std::cmp::Ordering;

use serde_json::Value as Json;
use serde_yaml_ng::Value as Yaml;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;

use crate::error::CoreError;
use crate::model::{PropertyFormat, Value};

/// Reads a YAML scalar or sequence as a value of the given format.
///
/// Structural only: whether `2026-13-45` is a legal `date`, or an option key
/// exists, is validation's job.
pub fn parse_value(format: PropertyFormat, key: &str, raw: &Yaml) -> Result<Value, CoreError> {
    let invalid = |found: &Yaml| CoreError::ValidationFailed {
        field: key.to_owned(),
        message: format!("expected {}, found {}", expected(format), yaml_kind(found)),
    };
    match format {
        PropertyFormat::Text
        | PropertyFormat::Select
        | PropertyFormat::Url
        | PropertyFormat::Email
        | PropertyFormat::Date
        | PropertyFormat::Datetime => raw
            .as_str()
            .map(|s| Value::Text(s.to_owned()))
            .ok_or_else(|| invalid(raw)),
        PropertyFormat::Number => raw
            .as_f64()
            .filter(|n| n.is_finite())
            .map(Value::Number)
            .ok_or_else(|| invalid(raw)),
        PropertyFormat::Checkbox => raw.as_bool().map(Value::Bool).ok_or_else(|| invalid(raw)),
        PropertyFormat::MultiSelect => string_list(raw)
            .map(Value::List)
            .ok_or_else(|| invalid(raw)),
        PropertyFormat::Relation if raw.is_sequence() => string_list(raw)
            .map(Value::List)
            .ok_or_else(|| invalid(raw)),
        PropertyFormat::Relation => raw
            .as_str()
            .map(|s| Value::Text(s.to_owned()))
            .ok_or_else(|| invalid(raw)),
    }
}

/// Writes a value as the YAML node frontmatter stores.
pub fn to_yaml(value: &Value) -> Yaml {
    match value {
        Value::Text(s) => Yaml::String(s.clone()),
        Value::Number(n) => Yaml::Number((*n).into()),
        Value::Bool(b) => Yaml::Bool(*b),
        Value::List(items) => Yaml::Sequence(items.iter().cloned().map(Yaml::String).collect()),
    }
}

/// Writes a value as the JSON node history and the API store.
pub fn to_json(value: &Value) -> Json {
    match value {
        Value::Text(s) => Json::String(s.clone()),
        Value::Number(n) => {
            Json::Number(serde_json::Number::from_f64(*n).expect("Value::Number is always finite"))
        }
        Value::Bool(b) => Json::Bool(*b),
        Value::List(items) => Json::Array(items.iter().cloned().map(Json::String).collect()),
    }
}

/// Reads a JSON node back into a value.
pub fn from_json(key: &str, raw: &Json) -> Result<Value, CoreError> {
    let invalid = |found: &'static str| CoreError::ValidationFailed {
        field: key.to_owned(),
        message: format!("expected a value, found {found}"),
    };
    match raw {
        Json::String(s) => Ok(Value::Text(s.clone())),
        Json::Bool(b) => Ok(Value::Bool(*b)),
        Json::Number(n) => n
            .as_f64()
            .filter(|n| n.is_finite())
            .map(Value::Number)
            .ok_or_else(|| invalid("a non-finite number")),
        Json::Array(items) => items
            .iter()
            .map(|item| item.as_str().map(str::to_owned))
            .collect::<Option<Vec<String>>>()
            .map(Value::List)
            .ok_or_else(|| invalid("an array that is not all strings")),
        Json::Null => Err(invalid("null")),
        Json::Object(_) => Err(invalid("an object")),
    }
}

/// Whether a value counts as unset for `required` checks and empty sorting.
pub fn is_empty(value: &Value) -> bool {
    match value {
        Value::Text(s) => s.trim().is_empty(),
        Value::List(items) => items.is_empty(),
        Value::Number(_) | Value::Bool(_) => false,
    }
}

/// Total order for sorting one property's values.
///
/// Numbers compare numerically, dates and datetimes chronologically, everything
/// else case-insensitively. Values of different variants compare by variant so
/// the order stays total even for a malformed row.
pub fn compare(format: PropertyFormat, a: &Value, b: &Value) -> Ordering {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.partial_cmp(y).unwrap_or(Ordering::Equal),
        (Value::Bool(x), Value::Bool(y)) => x.cmp(y),
        (Value::Text(x), Value::Text(y)) => match format {
            PropertyFormat::Date => compare_parsed(x, y, parse_date),
            PropertyFormat::Datetime => compare_parsed(x, y, parse_datetime),
            _ => compare_text(x, y),
        },
        (Value::List(x), Value::List(y)) => x
            .iter()
            .zip(y)
            .map(|(xi, yi)| compare_text(xi, yi))
            .find(|ord| *ord != Ordering::Equal)
            .unwrap_or_else(|| x.len().cmp(&y.len())),
        _ => rank(a).cmp(&rank(b)),
    }
}

fn rank(value: &Value) -> u8 {
    match value {
        Value::Bool(_) => 0,
        Value::Number(_) => 1,
        Value::Text(_) => 2,
        Value::List(_) => 3,
    }
}

fn compare_text(a: &str, b: &str) -> Ordering {
    let folded = a
        .chars()
        .flat_map(char::to_lowercase)
        .cmp(b.chars().flat_map(char::to_lowercase));
    folded.then_with(|| a.cmp(b))
}

fn compare_parsed(a: &str, b: &str, parse: fn(&str) -> Option<OffsetDateTime>) -> Ordering {
    match (parse(a), parse(b)) {
        (Some(x), Some(y)) => x.cmp(&y),
        _ => compare_text(a, b),
    }
}

fn parse_date(s: &str) -> Option<OffsetDateTime> {
    let format = format_description!("[year]-[month]-[day]");
    let date = time::Date::parse(s, &format).ok()?;
    Some(date.midnight().assume_utc())
}

fn parse_datetime(s: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(s, &Rfc3339).ok()
}

fn string_list(raw: &Yaml) -> Option<Vec<String>> {
    raw.as_sequence()?
        .iter()
        .map(|item| item.as_str().map(str::to_owned))
        .collect()
}

fn expected(format: PropertyFormat) -> &'static str {
    match format {
        PropertyFormat::Text => "text",
        PropertyFormat::Number => "a number",
        PropertyFormat::Checkbox => "a boolean",
        PropertyFormat::Date => "a YYYY-MM-DD date",
        PropertyFormat::Datetime => "an RFC 3339 datetime",
        PropertyFormat::Select => "an option key",
        PropertyFormat::MultiSelect => "a list of option keys",
        PropertyFormat::Url => "a URL",
        PropertyFormat::Email => "an email address",
        PropertyFormat::Relation => "an object id or a list of them",
    }
}

fn yaml_kind(raw: &Yaml) -> &'static str {
    match raw {
        Yaml::Null => "null",
        Yaml::Bool(_) => "a boolean",
        Yaml::Number(_) => "a number",
        Yaml::String(_) => "text",
        Yaml::Sequence(_) => "a list",
        Yaml::Mapping(_) => "a map",
        Yaml::Tagged(_) => "a tagged value",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn yaml(s: &str) -> Yaml {
        serde_yaml_ng::from_str(s).expect("test yaml parses")
    }

    fn json(s: &str) -> Json {
        serde_json::from_str(s).expect("test json parses")
    }

    fn parsed(format: PropertyFormat, raw: &str) -> Value {
        parse_value(format, "field", &yaml(raw)).expect("valid value")
    }

    #[test]
    fn parses_scalars_by_format() {
        assert_eq!(
            parsed(PropertyFormat::Text, "kitchen"),
            Value::Text("kitchen".into())
        );
        assert_eq!(parsed(PropertyFormat::Number, "7"), Value::Number(7.0));
        assert_eq!(parsed(PropertyFormat::Checkbox, "true"), Value::Bool(true));
        assert_eq!(
            parsed(PropertyFormat::Select, "todo"),
            Value::Text("todo".into())
        );
        assert_eq!(
            parsed(PropertyFormat::Date, "2026-10-15"),
            Value::Text("2026-10-15".into())
        );
        assert_eq!(
            parsed(PropertyFormat::Datetime, "2026-10-17T12:30:00Z"),
            Value::Text("2026-10-17T12:30:00Z".into())
        );
    }

    #[test]
    fn parses_lists_and_relations() {
        assert_eq!(
            parsed(PropertyFormat::MultiSelect, "[easy, indoors]"),
            Value::List(vec!["easy".into(), "indoors".into()])
        );
        assert_eq!(
            parsed(
                PropertyFormat::Relation,
                "0199f2c1-3333-7c2e-9b1d-2a4f6e8c0a1b"
            ),
            Value::Text("0199f2c1-3333-7c2e-9b1d-2a4f6e8c0a1b".into())
        );
        assert_eq!(
            parsed(PropertyFormat::Relation, "[a, b]"),
            Value::List(vec!["a".into(), "b".into()])
        );
    }

    #[test]
    fn rejects_the_wrong_yaml_kind() {
        for (format, raw) in [
            (PropertyFormat::Text, "7"),
            (PropertyFormat::Number, "seven"),
            (PropertyFormat::Number, ".nan"),
            (PropertyFormat::Checkbox, "\"yes\""),
            (PropertyFormat::MultiSelect, "easy"),
            (PropertyFormat::MultiSelect, "[1, 2]"),
            (PropertyFormat::Relation, "3"),
            (PropertyFormat::Select, "null"),
        ] {
            let err = parse_value(format, "field", &yaml(raw)).expect_err(raw);
            assert!(matches!(err, CoreError::ValidationFailed { .. }), "{raw}");
            assert!(err.to_string().starts_with("invalid field: "), "{raw}");
        }
    }

    #[test]
    fn yaml_round_trips() {
        let cases = [
            (PropertyFormat::Text, Value::Text("Monstera".into())),
            (PropertyFormat::Number, Value::Number(1.5)),
            (PropertyFormat::Checkbox, Value::Bool(false)),
            (
                PropertyFormat::MultiSelect,
                Value::List(vec!["easy".into()]),
            ),
        ];
        for (format, value) in cases {
            let node = to_yaml(&value);
            assert_eq!(
                parse_value(format, "field", &node).expect("round trip"),
                value
            );
        }
    }

    #[test]
    fn json_round_trips() {
        for value in [
            Value::Text("kitchen".into()),
            Value::Number(-2.5),
            Value::Bool(true),
            Value::List(vec!["a".into(), "b".into()]),
        ] {
            assert_eq!(
                from_json("field", &to_json(&value)).expect("round trip"),
                value
            );
        }
    }

    #[test]
    fn rejects_null_and_objects_in_json() {
        assert!(from_json("field", &json("null")).is_err());
        assert!(from_json("field", &json("{}")).is_err());
        assert!(from_json("field", &json("[1]")).is_err());
    }

    #[test]
    fn derived_serde_agrees_with_these_functions() {
        let cases = [
            (PropertyFormat::Text, Value::Text("kitchen".into())),
            (PropertyFormat::Number, Value::Number(-2.5)),
            (PropertyFormat::Checkbox, Value::Bool(true)),
            (
                PropertyFormat::MultiSelect,
                Value::List(vec!["easy".into(), "indoors".into()]),
            ),
        ];
        for (format, value) in cases {
            let json = to_json(&value);
            assert_eq!(serde_json::to_value(&value).expect("derived encode"), json);
            assert_eq!(
                serde_json::from_value::<Value>(json.clone()).expect("derived decode"),
                value
            );
            assert_eq!(from_json("field", &json).expect("decode"), value);

            let node = to_yaml(&value);
            assert_eq!(
                serde_yaml_ng::to_value(&value).expect("derived encode"),
                node
            );
            assert_eq!(
                serde_yaml_ng::from_value::<Value>(node.clone()).expect("derived decode"),
                value
            );
            assert_eq!(parse_value(format, "field", &node).expect("decode"), value);
        }
    }

    #[test]
    fn derived_serde_refuses_the_same_json_as_these_functions() {
        for raw in [json("null"), json("{}"), json("[1]")] {
            assert!(from_json("field", &raw).is_err(), "{raw}");
            assert!(
                serde_json::from_value::<Value>(raw.clone()).is_err(),
                "{raw}"
            );
        }
    }

    #[test]
    fn emptiness_follows_the_absent_key_rule() {
        assert!(is_empty(&Value::Text(String::new())));
        assert!(is_empty(&Value::Text("   ".into())));
        assert!(!is_empty(&Value::Text("x".into())));
        assert!(is_empty(&Value::List(Vec::new())));
        assert!(!is_empty(&Value::Number(0.0)));
        assert!(!is_empty(&Value::Bool(false)));
    }

    #[test]
    fn numbers_sort_numerically() {
        assert_eq!(
            compare(
                PropertyFormat::Number,
                &Value::Number(2.0),
                &Value::Number(10.0)
            ),
            Ordering::Less
        );
    }

    #[test]
    fn text_sorts_case_insensitively() {
        assert_eq!(
            compare(
                PropertyFormat::Text,
                &Value::Text("Apple".into()),
                &Value::Text("banana".into())
            ),
            Ordering::Less
        );
        assert_eq!(
            compare(
                PropertyFormat::Text,
                &Value::Text("apple".into()),
                &Value::Text("Apple".into())
            ),
            Ordering::Greater
        );
    }

    #[test]
    fn datetimes_sort_chronologically_not_lexicographically() {
        let earlier = Value::Text("2026-10-17T01:30:00+02:00".into());
        let later = Value::Text("2026-10-17T00:00:00Z".into());
        assert_eq!(
            compare(PropertyFormat::Datetime, &earlier, &later),
            Ordering::Less
        );
    }

    #[test]
    fn dates_sort_chronologically() {
        assert_eq!(
            compare(
                PropertyFormat::Date,
                &Value::Text("2026-02-01".into()),
                &Value::Text("2026-10-15".into())
            ),
            Ordering::Less
        );
    }

    #[test]
    fn unparseable_dates_fall_back_to_text_order() {
        assert_eq!(
            compare(
                PropertyFormat::Date,
                &Value::Text("2026-13-45".into()),
                &Value::Text("soon".into())
            ),
            Ordering::Less
        );
    }

    #[test]
    fn lists_sort_element_wise_then_by_length() {
        let a = Value::List(vec!["a".into(), "b".into()]);
        let b = Value::List(vec!["a".into(), "c".into()]);
        let c = Value::List(vec!["a".into()]);
        assert_eq!(compare(PropertyFormat::MultiSelect, &a, &b), Ordering::Less);
        assert_eq!(
            compare(PropertyFormat::MultiSelect, &a, &c),
            Ordering::Greater
        );
    }

    #[test]
    fn mismatched_variants_have_a_stable_order() {
        let number = Value::Number(1.0);
        let text = Value::Text("a".into());
        assert_eq!(
            compare(PropertyFormat::Text, &number, &text),
            Ordering::Less
        );
        assert_eq!(
            compare(PropertyFormat::Text, &text, &number),
            Ordering::Greater
        );
    }
}
