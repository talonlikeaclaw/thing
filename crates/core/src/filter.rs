//! Filter conditions against one row.
//!
//! The expected value comes from a client or a saved view, so it is whatever
//! `Value` variant the request carried; the property's format decides how the
//! two compare. `title` is a column like any other here, so a view can filter
//! and sort by it.

use std::cmp::Ordering;

use crate::model::{
    CondOp, Condition, Filter, FilterOp, ObjectSummary, PropertyFormat, TITLE_KEY, Value,
};
use crate::validate::Schema;
use crate::value;

/// A row's value for one column, borrowed from the row.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Row<'a> {
    /// The virtual `title` column.
    Title(&'a str),
    Property(&'a Value),
    /// The property key is not set on this object.
    Absent,
}

impl<'a> Row<'a> {
    /// The row's value for `key`, which is `title` or a property key.
    pub(crate) fn of(summary: &'a ObjectSummary, key: &str) -> Self {
        if key == TITLE_KEY {
            return Row::Title(&summary.title);
        }
        match summary.properties.get(key) {
            Some(value) => Row::Property(value),
            None => Row::Absent,
        }
    }

    /// Whether the column holds nothing: an absent key, or a value that counts
    /// as unset (`""`, `[]`). A hand-edited file then behaves as the UI expects.
    pub(crate) fn is_empty(&self) -> bool {
        match self {
            Row::Absent => true,
            Row::Title(title) => title.trim().is_empty(),
            Row::Property(value) => value::is_empty(value),
        }
    }

    /// Compares two non-empty row values of one column.
    ///
    /// `None` when the two do not share a representation; one column cannot
    /// produce that, and the caller treats it as a tie.
    pub(crate) fn ordering(&self, format: PropertyFormat, other: &Row<'_>) -> Option<Ordering> {
        if let (Some(left), Some(right)) = (self.text(), other.text()) {
            return Some(value::compare_text(left, right));
        }
        match (self.value(), other.value()) {
            (Some(left), Some(right)) => Some(value::compare(format, left, right)),
            _ => None,
        }
    }

    /// Compares two non-empty values of a `Select` / `MultiSelect` column by
    /// their option order instead of their text.
    pub(crate) fn ordering_by_option(
        &self,
        positions: &std::collections::HashMap<&str, usize>,
        other: &Row<'_>,
    ) -> Option<Ordering> {
        match (self.value(), other.value()) {
            (Some(left), Some(right)) => Some(value::compare_options(positions, left, right)),
            _ => None,
        }
    }

    /// Whether the row holds the expected value; an unset cell equals nothing.
    fn equals(&self, format: PropertyFormat, expected: &Value) -> bool {
        match (self, expected) {
            (Row::Absent, _) => false,
            (Row::Title(title), Value::Text(text)) => {
                value::text_equals(PropertyFormat::Text, title, text)
            }
            (Row::Title(_), _) => false,
            (Row::Property(actual), expected) => {
                !value::is_empty(actual) && value::equals(format, actual, expected)
            }
        }
    }

    /// Compares the row with a condition's expected value; `None` when either
    /// side holds nothing, since an unset cell is not greater or less.
    fn compare(&self, format: PropertyFormat, expected: &Value) -> Option<Ordering> {
        match (self, expected) {
            (Row::Absent, _) => None,
            (Row::Title(title), Value::Text(text)) => Some(value::compare_text(title, text)),
            (Row::Title(_), _) => None,
            (Row::Property(actual), expected) if !value::is_empty(actual) => {
                Some(value::compare(format, actual, expected))
            }
            (Row::Property(_), _) => None,
        }
    }

    fn text(&self) -> Option<&'a str> {
        match self {
            Row::Title(title) => Some(title),
            Row::Property(Value::Text(text)) => Some(text),
            Row::Property(_) | Row::Absent => None,
        }
    }

    fn value(&self) -> Option<&'a Value> {
        match self {
            Row::Property(value) => Some(value),
            Row::Title(_) | Row::Absent => None,
        }
    }

    /// Case-insensitive substring match; a list matches when any element does.
    fn contains(&self, expected: &Value) -> bool {
        let Value::Text(needle) = expected else {
            return false;
        };
        match self {
            Row::Absent => false,
            Row::Title(title) => contains_text(title, needle),
            Row::Property(Value::Text(text)) => contains_text(text, needle),
            Row::Property(Value::List(items)) => {
                items.iter().any(|item| contains_text(item, needle))
            }
            Row::Property(_) => false,
        }
    }

    /// Member of an expected list; `all` demands every element, otherwise one is
    /// enough. A single-value row counts as a one-element list.
    fn member_of(&self, format: PropertyFormat, expected: &Value, all: bool) -> bool {
        let (list, single): (&[String], Option<&str>) = match expected {
            Value::List(items) => (items, None),
            Value::Text(text) => (&[], Some(text)),
            _ => (&[], None),
        };
        let holds = |item: &str| self.holds_text(format, item);
        match single {
            Some(item) => holds(item),
            None if list.is_empty() => false,
            None if all => list.iter().all(|item| holds(item)),
            None => list.iter().any(|item| holds(item)),
        }
    }

    fn holds_text(&self, format: PropertyFormat, expected: &str) -> bool {
        match self {
            Row::Absent => false,
            Row::Title(title) => value::text_equals(PropertyFormat::Text, title, expected),
            Row::Property(Value::Text(text)) => value::text_equals(format, text, expected),
            Row::Property(Value::List(items)) => items
                .iter()
                .any(|item| value::text_equals(format, item, expected)),
            Row::Property(Value::Number(number)) => expected
                .parse::<f64>()
                .is_ok_and(|expected| expected == *number),
            Row::Property(Value::Bool(value)) => expected == if *value { "true" } else { "false" },
            Row::Property(Value::Recurrence(_)) => false,
        }
    }
}

/// Whether one condition holds for one row.
pub fn matches(condition: &Condition, summary: &ObjectSummary, schema: &Schema) -> bool {
    let row = Row::of(summary, &condition.property);
    if condition.condition == CondOp::IsEmpty {
        return row.is_empty();
    }
    if condition.condition == CondOp::IsNotEmpty {
        return !row.is_empty();
    }
    let Some(expected) = &condition.value else {
        return false;
    };
    let format = schema
        .property(&condition.property)
        .map_or(PropertyFormat::Text, |def| def.format);
    match condition.condition {
        CondOp::IsEmpty | CondOp::IsNotEmpty => unreachable!("handled above"),
        CondOp::Equal => row.equals(format, expected),
        CondOp::NotEqual => !row.equals(format, expected),
        CondOp::Greater => row.compare(format, expected) == Some(Ordering::Greater),
        CondOp::Less => row.compare(format, expected) == Some(Ordering::Less),
        CondOp::GreaterOrEqual => matches!(
            row.compare(format, expected),
            Some(Ordering::Greater | Ordering::Equal)
        ),
        CondOp::LessOrEqual => matches!(
            row.compare(format, expected),
            Some(Ordering::Less | Ordering::Equal)
        ),
        CondOp::Contains => row.contains(expected),
        CondOp::NotContains => !row.contains(expected),
        CondOp::In => row.member_of(format, expected, false),
        CondOp::NotIn => !row.member_of(format, expected, false),
        CondOp::AllIn => row.member_of(format, expected, true),
    }
}

/// Whether every condition of `filter` holds for one row.
pub fn row_matches(filter: &Filter, summary: &ObjectSummary, schema: &Schema) -> bool {
    // An empty filter passes everything whatever its operator: a view with no
    // conditions is unfiltered, not empty.
    if filter.conditions.is_empty() {
        return true;
    }
    match filter.op {
        FilterOp::And => filter
            .conditions
            .iter()
            .all(|condition| matches(condition, summary, schema)),
        FilterOp::Or => filter
            .conditions
            .iter()
            .any(|condition| matches(condition, summary, schema)),
    }
}

/// Case-insensitive substring test; allocation-free while both sides are ASCII.
fn contains_text(haystack: &str, needle: &str) -> bool {
    if haystack.is_ascii() && needle.is_ascii() {
        return haystack.len() >= needle.len()
            && haystack
                .as_bytes()
                .windows(needle.len())
                .any(|window| window.eq_ignore_ascii_case(needle.as_bytes()));
    }
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    static SCHEDULE_PROPERTIES: std::sync::LazyLock<BTreeMap<String, PropertyDef>> =
        std::sync::LazyLock::new(crate::schedule::schedule_property_defs);

    use time::OffsetDateTime;
    use uuid::Uuid;

    use super::*;
    use crate::model::{
        Filter, FilterOp, OptionDef, PropertyDef, TypeDef, TypeProperty, ViewDef, ViewKind,
    };

    fn at() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_760_000_000).expect("valid timestamp")
    }

    fn property(key: &str, format: PropertyFormat) -> PropertyDef {
        PropertyDef {
            key: key.to_owned(),
            name: key.to_owned(),
            format,
            options: Vec::new(),
            target_type: None,
            multi: false,
        }
    }

    struct Fixture {
        types: BTreeMap<String, TypeDef>,
        properties: BTreeMap<String, PropertyDef>,
        objects: BTreeMap<Uuid, crate::model::ObjectDoc>,
    }

    impl Fixture {
        fn new() -> Self {
            let mut status = property("status", PropertyFormat::Select);
            status.options = vec![OptionDef {
                key: "todo".to_owned(),
                name: "To do".to_owned(),
                color: "grey".to_owned(),
            }];
            let properties: BTreeMap<String, PropertyDef> = [
                property("room", PropertyFormat::Text),
                property("count", PropertyFormat::Number),
                property("done", PropertyFormat::Checkbox),
                property("watered", PropertyFormat::Date),
                property("seen", PropertyFormat::Datetime),
                property("link", PropertyFormat::Url),
                property("tags", PropertyFormat::MultiSelect),
                status,
            ]
            .into_iter()
            .map(|def| (def.key.clone(), def))
            .collect();
            let def = TypeDef {
                key: "plant".to_owned(),
                name: "Plant".to_owned(),
                name_plural: "Plants".to_owned(),
                icon: None,
                description: String::new(),
                schedule: false,
                schedule_labels: Default::default(),
                properties: properties
                    .keys()
                    .map(|key| TypeProperty {
                        key: key.clone(),
                        required: false,
                        featured: false,
                    })
                    .collect(),
                views: vec![ViewDef {
                    key: "all".to_owned(),
                    name: "All".to_owned(),
                    kind: ViewKind::Table,
                    sorts: Vec::new(),
                    filter: Filter {
                        op: FilterOp::And,
                        conditions: Vec::new(),
                    },
                    columns: vec![TITLE_KEY.to_owned()],
                    widths: BTreeMap::new(),
                    group_by: None,
                    cover: None,
                    date_property: None,
                }],
                default_view: "all".to_owned(),
            };
            Self {
                types: BTreeMap::from([("plant".to_owned(), def)]),
                properties,
                objects: BTreeMap::new(),
            }
        }

        fn schema(&self) -> Schema<'_> {
            Schema {
                types: &self.types,
                properties: &self.properties,
                schedule_properties: &SCHEDULE_PROPERTIES,
                objects: &self.objects,
                trash: &self.objects,
            }
        }
    }

    fn row(title: &str, values: &[(&str, Value)]) -> ObjectSummary {
        ObjectSummary {
            id: Uuid::from_u128(values.len() as u128 + 1),
            type_key: "plant".to_owned(),
            title: title.to_owned(),
            icon: None,
            rev: 1,
            updated_at: at(),
            properties: values
                .iter()
                .map(|(key, value)| ((*key).to_owned(), value.clone()))
                .collect(),
        }
    }

    fn text(s: &str) -> Value {
        Value::Text(s.to_owned())
    }

    fn list(items: &[&str]) -> Value {
        Value::List(items.iter().map(|item| (*item).to_owned()).collect())
    }

    fn check(
        fixture: &Fixture,
        summary: &ObjectSummary,
        property: &str,
        condition: CondOp,
        value: Option<Value>,
    ) -> bool {
        matches(
            &Condition {
                property: property.to_owned(),
                condition,
                value,
            },
            summary,
            &fixture.schema(),
        )
    }

    #[test]
    fn equal_is_case_insensitive_for_text_and_numeric_for_numbers() {
        let fixture = Fixture::new();
        let plant = row(
            "Fern",
            &[("room", text("Kitchen")), ("count", Value::Number(3.0))],
        );
        assert!(check(
            &fixture,
            &plant,
            "room",
            CondOp::Equal,
            Some(text("kitchen"))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "room",
            CondOp::Equal,
            Some(text("cellar"))
        ));
        assert!(check(
            &fixture,
            &plant,
            "count",
            CondOp::Equal,
            Some(Value::Number(3.0))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "count",
            CondOp::Equal,
            Some(Value::Number(3.5))
        ));
        assert!(check(
            &fixture,
            &plant,
            "room",
            CondOp::NotEqual,
            Some(text("cellar"))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "room",
            CondOp::NotEqual,
            Some(text("KITCHEN"))
        ));
    }

    #[test]
    fn dates_compare_chronologically_not_lexicographically() {
        let fixture = Fixture::new();
        let plant = row(
            "Fern",
            &[
                ("watered", text("2026-09-30")),
                ("seen", text("2026-09-30T23:30:00Z")),
            ],
        );
        assert!(check(
            &fixture,
            &plant,
            "watered",
            CondOp::Greater,
            Some(text("2026-09-07"))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "watered",
            CondOp::Less,
            Some(text("2026-09-07"))
        ));
        assert!(check(
            &fixture,
            &plant,
            "watered",
            CondOp::GreaterOrEqual,
            Some(text("2026-09-30"))
        ));
        assert!(check(
            &fixture,
            &plant,
            "watered",
            CondOp::LessOrEqual,
            Some(text("2026-10-01"))
        ));
        assert!(check(
            &fixture,
            &plant,
            "seen",
            CondOp::Greater,
            Some(text("2026-10-01T00:00:00+02:00"))
        ));
    }

    #[test]
    fn numbers_and_checkboxes_order_themselves() {
        let fixture = Fixture::new();
        let plant = row(
            "Fern",
            &[("count", Value::Number(7.0)), ("done", Value::Bool(false))],
        );
        assert!(check(
            &fixture,
            &plant,
            "count",
            CondOp::Greater,
            Some(Value::Number(6.0))
        ));
        assert!(check(
            &fixture,
            &plant,
            "count",
            CondOp::Less,
            Some(Value::Number(8.0))
        ));
        assert!(check(
            &fixture,
            &plant,
            "done",
            CondOp::Less,
            Some(Value::Bool(true))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "done",
            CondOp::Greater,
            Some(Value::Bool(true))
        ));
    }

    #[test]
    fn contains_is_a_case_insensitive_substring_for_text() {
        let fixture = Fixture::new();
        let plant = row(
            "Monstera deliciosa",
            &[
                ("room", text("North window")),
                ("link", text("https://example.test/Monstera")),
                ("tags", list(&["Houseplant", "Climbing"])),
                ("count", Value::Number(3.0)),
            ],
        );
        assert!(check(
            &fixture,
            &plant,
            "room",
            CondOp::Contains,
            Some(text("window"))
        ));
        assert!(check(
            &fixture,
            &plant,
            "room",
            CondOp::Contains,
            Some(text("WINDOW"))
        ));
        assert!(check(
            &fixture,
            &plant,
            "link",
            CondOp::Contains,
            Some(text("monstera"))
        ));
        assert!(check(
            &fixture,
            &plant,
            "tags",
            CondOp::Contains,
            Some(text("climb"))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "room",
            CondOp::Contains,
            Some(text("cellar"))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "count",
            CondOp::Contains,
            Some(text("3"))
        ));
        assert!(check(
            &fixture,
            &plant,
            "count",
            CondOp::NotContains,
            Some(text("3"))
        ));
        assert!(check(
            &fixture,
            &plant,
            "room",
            CondOp::NotContains,
            Some(text("cellar"))
        ));
        assert!(check(
            &fixture,
            &plant,
            TITLE_KEY,
            CondOp::Contains,
            Some(text("DELICIOSA"))
        ));
    }

    #[test]
    fn contains_folds_non_ascii_text() {
        let fixture = Fixture::new();
        let plant = row("Étude", &[("room", text("Étage"))]);
        assert!(check(
            &fixture,
            &plant,
            "room",
            CondOp::Contains,
            Some(text("étage"))
        ));
        assert!(check(
            &fixture,
            &plant,
            TITLE_KEY,
            CondOp::Contains,
            Some(text("ÉTUDE"))
        ));
    }

    #[test]
    fn in_means_one_of_and_allin_every_one_of() {
        let fixture = Fixture::new();
        let plant = row(
            "Fern",
            &[("tags", list(&["a", "b"])), ("room", text("Kitchen"))],
        );
        assert!(check(
            &fixture,
            &plant,
            "tags",
            CondOp::In,
            Some(list(&["b", "z"]))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "tags",
            CondOp::In,
            Some(list(&["z"]))
        ));
        assert!(check(
            &fixture,
            &plant,
            "tags",
            CondOp::AllIn,
            Some(list(&["a", "b"]))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "tags",
            CondOp::AllIn,
            Some(list(&["a", "z"]))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "tags",
            CondOp::NotIn,
            Some(list(&["a"]))
        ));
        assert!(check(
            &fixture,
            &plant,
            "tags",
            CondOp::NotIn,
            Some(list(&["z"]))
        ));
        assert!(check(
            &fixture,
            &plant,
            "room",
            CondOp::In,
            Some(list(&["kitchen"]))
        ));
        assert!(check(
            &fixture,
            &plant,
            "room",
            CondOp::AllIn,
            Some(list(&["KITCHEN"]))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "room",
            CondOp::AllIn,
            Some(list(&["kitchen", "cellar"]))
        ));
    }

    #[test]
    fn in_matches_numbers_and_booleans_by_their_text() {
        let fixture = Fixture::new();
        let plant = row(
            "Fern",
            &[("count", Value::Number(7.0)), ("done", Value::Bool(true))],
        );
        assert!(check(
            &fixture,
            &plant,
            "count",
            CondOp::In,
            Some(list(&["7"]))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "count",
            CondOp::In,
            Some(list(&["7.5"]))
        ));
        assert!(check(
            &fixture,
            &plant,
            "done",
            CondOp::In,
            Some(list(&["true"]))
        ));
        assert!(!check(
            &fixture,
            &plant,
            "done",
            CondOp::In,
            Some(list(&["false"]))
        ));
    }

    #[test]
    fn empty_operators_cover_an_absent_key_and_an_unset_value() {
        let fixture = Fixture::new();
        let absent = row("Fern", &[]);
        let blank = row("Fern", &[("room", text("  ")), ("tags", list(&[]))]);
        let filled = row("Fern", &[("room", text("Kitchen"))]);
        assert!(check(&fixture, &absent, "room", CondOp::IsEmpty, None));
        assert!(check(&fixture, &blank, "room", CondOp::IsEmpty, None));
        assert!(check(&fixture, &blank, "tags", CondOp::IsEmpty, None));
        assert!(!check(&fixture, &filled, "room", CondOp::IsEmpty, None));
        assert!(check(&fixture, &filled, "room", CondOp::IsNotEmpty, None));
        assert!(!check(&fixture, &absent, "room", CondOp::IsNotEmpty, None));
        assert!(check(&fixture, &filled, "ghost", CondOp::IsEmpty, None));
    }

    #[test]
    fn an_absent_value_never_equals_but_is_not_equal() {
        let fixture = Fixture::new();
        let absent = row("Fern", &[]);
        assert!(!check(
            &fixture,
            &absent,
            "room",
            CondOp::Equal,
            Some(text("Kitchen"))
        ));
        assert!(check(
            &fixture,
            &absent,
            "room",
            CondOp::NotEqual,
            Some(text("Kitchen"))
        ));
        assert!(!check(
            &fixture,
            &absent,
            "room",
            CondOp::Greater,
            Some(text("Kitchen"))
        ));
        assert!(!check(
            &fixture,
            &absent,
            "room",
            CondOp::LessOrEqual,
            Some(text("Kitchen"))
        ));
        assert!(check(
            &fixture,
            &absent,
            "room",
            CondOp::NotContains,
            Some(text("Kitchen"))
        ));
        assert!(!check(
            &fixture,
            &absent,
            "room",
            CondOp::In,
            Some(list(&["Kitchen"]))
        ));
        assert!(check(
            &fixture,
            &absent,
            "room",
            CondOp::NotIn,
            Some(list(&["Kitchen"]))
        ));
    }

    #[test]
    fn a_condition_without_a_value_matches_nothing() {
        let fixture = Fixture::new();
        let plant = row("Fern", &[("room", text("Kitchen"))]);
        assert!(!check(&fixture, &plant, "room", CondOp::Equal, None));
        assert!(!check(&fixture, &plant, "room", CondOp::In, None));
    }

    #[test]
    fn and_needs_every_condition_and_or_one_of_them() {
        let fixture = Fixture::new();
        let plant = row(
            "Fern",
            &[("room", text("Kitchen")), ("count", Value::Number(3.0))],
        );
        let room = Condition {
            property: "room".to_owned(),
            condition: CondOp::Equal,
            value: Some(text("Kitchen")),
        };
        let count = Condition {
            property: "count".to_owned(),
            condition: CondOp::Greater,
            value: Some(Value::Number(9.0)),
        };
        let and = Filter {
            op: FilterOp::And,
            conditions: vec![room.clone(), count.clone()],
        };
        let or = Filter {
            op: FilterOp::Or,
            conditions: vec![room, count],
        };
        assert!(!row_matches(&and, &plant, &fixture.schema()));
        assert!(row_matches(&or, &plant, &fixture.schema()));
    }

    #[test]
    fn an_empty_filter_passes_every_row_whatever_the_operator() {
        let fixture = Fixture::new();
        let plant = row("Fern", &[]);
        for op in [FilterOp::And, FilterOp::Or] {
            let filter = Filter {
                op,
                conditions: Vec::new(),
            };
            assert!(row_matches(&filter, &plant, &fixture.schema()), "{op:?}");
        }
    }
}
