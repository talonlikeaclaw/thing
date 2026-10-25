//! Applying a view to rows: filter, then sort.
//!
//! The order is total: every sort key, then `updated_at` newest first, then the
//! object id. Two rows therefore never swap places between identical requests,
//! which a table that re-fetches on every edit depends on.

use std::cmp::Ordering;
use std::collections::HashMap;

use crate::filter::{self, Row};
use crate::model::{
    Direction, EmptyPlacement, Filter, ObjectSummary, PropertyFormat, Sort, UPDATED_AT_KEY,
};
use crate::validate::Schema;

/// The rows the view keeps, in the order it shows them.
pub fn apply(
    filter: &Filter,
    sorts: &[Sort],
    summaries: &[ObjectSummary],
    schema: &Schema,
) -> Vec<ObjectSummary> {
    let mut rows: Vec<ObjectSummary> = summaries
        .iter()
        .filter(|row| filter::row_matches(filter, row, schema))
        .cloned()
        .collect();
    // One option key lookup per sort key, not one per comparison.
    let keys: Vec<SortKey<'_, '_>> = sorts
        .iter()
        .map(|sort| SortKey::new(sort, schema))
        .collect();
    rows.sort_by(|left, right| compare_rows(&keys, left, right));
    rows
}

/// One sort key resolved against the schema: its format, and the option order
/// that decides a `Select` / `MultiSelect` column.
struct SortKey<'s, 'k> {
    sort: &'s Sort,
    format: PropertyFormat,
    options: Option<HashMap<&'k str, usize>>,
}

impl<'s, 'k> SortKey<'s, 'k> {
    fn new(sort: &'s Sort, schema: &Schema<'k>) -> Self {
        let def = schema.property(&sort.property);
        let format = def.map_or(PropertyFormat::Text, |def| def.format);
        let options = match def {
            Some(def)
                if matches!(
                    def.format,
                    PropertyFormat::Select | PropertyFormat::MultiSelect
                ) && !def.options.is_empty() =>
            {
                Some(
                    def.options
                        .iter()
                        .enumerate()
                        .map(|(position, option)| (option.key.as_str(), position))
                        .collect(),
                )
            }
            _ => None,
        };
        Self {
            sort,
            format,
            options,
        }
    }

    fn compare(&self, left: &ObjectSummary, right: &ObjectSummary) -> Ordering {
        // `updated_at` is a column like `title`, but every row has one, so it
        // does not go through the empty-value machinery.
        if self.sort.property == UPDATED_AT_KEY {
            let ordering = left.updated_at.cmp(&right.updated_at);
            return match self.sort.direction {
                Direction::Asc => ordering,
                Direction::Desc => ordering.reverse(),
            };
        }
        let left_row = Row::of(left, &self.sort.property);
        let right_row = Row::of(right, &self.sort.property);

        if left_row.is_empty() || right_row.is_empty() {
            return empty_order(self.sort.empty, left_row.is_empty(), right_row.is_empty());
        }
        let ordering = match &self.options {
            Some(positions) => left_row.ordering_by_option(positions, &right_row),
            None => left_row.ordering(self.format, &right_row),
        }
        .unwrap_or(Ordering::Equal);
        match self.sort.direction {
            Direction::Asc => ordering,
            Direction::Desc => ordering.reverse(),
        }
    }
}

fn compare_rows(keys: &[SortKey<'_, '_>], left: &ObjectSummary, right: &ObjectSummary) -> Ordering {
    for key in keys {
        let ordering = key.compare(left, right);
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    right
        .updated_at
        .cmp(&left.updated_at)
        .then_with(|| left.id.cmp(&right.id))
}

/// Where an empty value goes. Applied after the direction, so `Start` keeps
/// empty rows at the top of the table in either direction.
fn empty_order(empty: EmptyPlacement, left_empty: bool, right_empty: bool) -> Ordering {
    match (left_empty, right_empty) {
        (true, false) => match empty {
            EmptyPlacement::Start => Ordering::Less,
            EmptyPlacement::End => Ordering::Greater,
        },
        (false, true) => match empty {
            EmptyPlacement::Start => Ordering::Greater,
            EmptyPlacement::End => Ordering::Less,
        },
        _ => Ordering::Equal,
    }
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
        CondOp, Condition, Filter, FilterOp, ObjectDoc, OptionDef, PropertyDef, TITLE_KEY, TypeDef,
        TypeProperty, Value, ViewDef, ViewKind,
    };

    fn at(offset: i64) -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_760_000_000 + offset).expect("valid timestamp")
    }

    struct Fixture {
        types: BTreeMap<String, TypeDef>,
        properties: BTreeMap<String, PropertyDef>,
        objects: BTreeMap<Uuid, ObjectDoc>,
    }

    impl Fixture {
        fn new() -> Self {
            let properties: BTreeMap<String, PropertyDef> = [
                ("room", PropertyFormat::Text),
                ("count", PropertyFormat::Number),
                ("watered", PropertyFormat::Date),
            ]
            .into_iter()
            .map(|(key, format)| {
                (
                    key.to_owned(),
                    PropertyDef {
                        key: key.to_owned(),
                        name: key.to_owned(),
                        format,
                        options: Vec::new(),
                        target_type: None,
                        multi: false,
                    },
                )
            })
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
                views: vec![view(Vec::new())],
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

    fn row(id: u128, title: &str, updated: i64, values: &[(&str, Value)]) -> ObjectSummary {
        ObjectSummary {
            id: Uuid::from_u128(id),
            type_key: "plant".to_owned(),
            title: title.to_owned(),
            rev: 1,
            updated_at: at(updated),
            properties: values
                .iter()
                .map(|(key, value)| ((*key).to_owned(), value.clone()))
                .collect(),
        }
    }

    fn number(value: f64) -> Value {
        Value::Number(value)
    }

    fn text(value: &str) -> Value {
        Value::Text(value.to_owned())
    }

    fn list(values: &[&str]) -> Value {
        Value::List(values.iter().map(|value| (*value).to_owned()).collect())
    }

    /// A select or multi-select definition whose options are named by their keys.
    fn option_property(key: &str, format: PropertyFormat, options: &[&str]) -> PropertyDef {
        PropertyDef {
            key: key.to_owned(),
            name: key.to_owned(),
            format,
            options: options
                .iter()
                .map(|option| OptionDef {
                    key: (*option).to_owned(),
                    name: (*option).to_owned(),
                    color: "lichen".to_owned(),
                })
                .collect(),
            target_type: None,
            multi: false,
        }
    }

    fn with_property(mut fixture: Fixture, property: PropertyDef) -> Fixture {
        fixture.properties.insert(property.key.clone(), property);
        fixture
    }

    fn sort(property: &str, direction: Direction) -> Sort {
        Sort {
            property: property.to_owned(),
            direction,
            empty: EmptyPlacement::End,
        }
    }

    fn view(sorts: Vec<Sort>) -> ViewDef {
        ViewDef {
            key: "all".to_owned(),
            name: "All".to_owned(),
            kind: ViewKind::Table,
            sorts,
            filter: Filter {
                op: FilterOp::And,
                conditions: Vec::new(),
            },
            columns: vec![TITLE_KEY.to_owned()],
            widths: BTreeMap::new(),
            group_by: None,
            cover: None,
            date_property: None,
        }
    }

    /// The tests exercise the query engine, not the named-view envelope.
    fn apply(view: &ViewDef, summaries: &[ObjectSummary], schema: &Schema) -> Vec<ObjectSummary> {
        super::apply(&view.filter, &view.sorts, summaries, schema)
    }

    fn ids(rows: &[ObjectSummary]) -> Vec<u128> {
        rows.iter().map(|row| row.id.as_u128()).collect()
    }

    #[test]
    fn rows_without_sorts_fall_back_to_the_newest_then_the_id() {
        let fixture = Fixture::new();
        let rows = [
            row(1, "A", 10, &[]),
            row(3, "C", 20, &[]),
            row(2, "B", 10, &[]),
        ];
        assert_eq!(
            ids(&apply(&view(Vec::new()), &rows, &fixture.schema())),
            vec![3, 1, 2]
        );
    }

    #[test]
    fn the_updated_at_column_sorts_in_both_directions() {
        let fixture = Fixture::new();
        let rows = [
            row(1, "A", 10, &[]),
            row(2, "B", 30, &[]),
            row(3, "C", 20, &[]),
        ];
        let schema = fixture.schema();
        assert_eq!(
            ids(&apply(
                &view(vec![sort(UPDATED_AT_KEY, Direction::Asc)]),
                &rows,
                &schema
            )),
            vec![1, 3, 2]
        );
        assert_eq!(
            ids(&apply(
                &view(vec![sort(UPDATED_AT_KEY, Direction::Desc)]),
                &rows,
                &schema
            )),
            vec![2, 3, 1]
        );
    }

    #[test]
    fn a_sort_orders_by_its_property_in_both_directions() {
        let fixture = Fixture::new();
        let rows = [
            row(1, "A", 0, &[("count", number(3.0))]),
            row(2, "B", 0, &[("count", number(1.0))]),
            row(3, "C", 0, &[("count", number(2.0))]),
        ];
        let schema = fixture.schema();
        assert_eq!(
            ids(&apply(
                &view(vec![sort("count", Direction::Asc)]),
                &rows,
                &schema
            )),
            vec![2, 3, 1]
        );
        assert_eq!(
            ids(&apply(
                &view(vec![sort("count", Direction::Desc)]),
                &rows,
                &schema
            )),
            vec![1, 3, 2]
        );
    }

    #[test]
    fn empty_values_go_last_unless_the_sort_asks_for_start() {
        let fixture = Fixture::new();
        let rows = [
            row(1, "Full", 0, &[("room", text("Kitchen"))]),
            row(2, "Empty", 0, &[]),
            row(3, "Cellar", 0, &[("room", text("Cellar"))]),
        ];
        let schema = fixture.schema();
        let mut end = sort("room", Direction::Asc);
        assert_eq!(
            ids(&apply(&view(vec![end.clone()]), &rows, &schema)),
            vec![3, 1, 2]
        );
        assert_eq!(
            ids(&apply(
                &view(vec![sort("room", Direction::Desc)]),
                &rows,
                &schema
            )),
            vec![1, 3, 2]
        );
        end.empty = EmptyPlacement::Start;
        // `start` is applied after the direction: empty rows stay on top.
        assert_eq!(
            ids(&apply(&view(vec![end.clone()]), &rows, &schema)),
            vec![2, 3, 1]
        );
        end.direction = Direction::Desc;
        assert_eq!(ids(&apply(&view(vec![end]), &rows, &schema)), vec![2, 1, 3]);
    }

    #[test]
    fn a_select_sorts_by_option_order_not_by_text() {
        let fixture = with_property(
            Fixture::new(),
            option_property(
                "place",
                PropertyFormat::Select,
                &["kitchen", "study", "balcony"],
            ),
        );
        let rows = [
            row(1, "Balcony", 0, &[("place", text("balcony"))]),
            row(2, "Kitchen", 0, &[("place", text("kitchen"))]),
            row(3, "Study", 0, &[("place", text("study"))]),
        ];
        let schema = fixture.schema();
        assert_eq!(
            ids(&apply(
                &view(vec![sort("place", Direction::Asc)]),
                &rows,
                &schema
            )),
            vec![2, 3, 1]
        );
        assert_eq!(
            ids(&apply(
                &view(vec![sort("place", Direction::Desc)]),
                &rows,
                &schema
            )),
            vec![1, 3, 2]
        );
    }

    #[test]
    fn reordering_options_changes_the_next_query() {
        let fixture = with_property(
            Fixture::new(),
            option_property(
                "place",
                PropertyFormat::Select,
                &["balcony", "kitchen", "study"],
            ),
        );
        let rows = [
            row(1, "Balcony", 0, &[("place", text("balcony"))]),
            row(2, "Kitchen", 0, &[("place", text("kitchen"))]),
            row(3, "Study", 0, &[("place", text("study"))]),
        ];
        assert_eq!(
            ids(&apply(
                &view(vec![sort("place", Direction::Asc)]),
                &rows,
                &fixture.schema()
            )),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn an_option_the_property_no_longer_defines_sorts_last_then_by_text() {
        let fixture = with_property(
            Fixture::new(),
            option_property("place", PropertyFormat::Select, &["kitchen", "study"]),
        );
        let rows = [
            row(1, "Balcony", 0, &[("place", text("balcony"))]),
            row(2, "Cellar", 0, &[("place", text("cellar"))]),
            row(3, "Kitchen", 0, &[("place", text("kitchen"))]),
            row(4, "Attic", 0, &[("place", text("attic"))]),
        ];
        let schema = fixture.schema();
        // Known options first in their declared order, then unknown keys by text.
        assert_eq!(
            ids(&apply(
                &view(vec![sort("place", Direction::Asc)]),
                &rows,
                &schema
            )),
            vec![3, 4, 1, 2]
        );
        // Descending reverses the option order and the unknown tail with it.
        assert_eq!(
            ids(&apply(
                &view(vec![sort("place", Direction::Desc)]),
                &rows,
                &schema
            )),
            vec![2, 1, 4, 3]
        );
    }

    #[test]
    fn a_multi_select_compares_element_wise_in_option_order() {
        let fixture = with_property(
            Fixture::new(),
            option_property("tags", PropertyFormat::MultiSelect, &["a", "b", "c"]),
        );
        let rows = [
            row(1, "One", 0, &[("tags", list(&["b"]))]),
            row(2, "Two", 0, &[("tags", list(&["a", "c"]))]),
            row(3, "Three", 0, &[("tags", list(&["b", "a"]))]),
            row(4, "Four", 0, &[("tags", list(&["a"]))]),
        ];
        let schema = fixture.schema();
        // The first differing option decides; an equal prefix loses to a longer list.
        assert_eq!(
            ids(&apply(
                &view(vec![sort("tags", Direction::Asc)]),
                &rows,
                &schema
            )),
            vec![4, 2, 1, 3]
        );
        assert_eq!(
            ids(&apply(
                &view(vec![sort("tags", Direction::Desc)]),
                &rows,
                &schema
            )),
            vec![3, 1, 2, 4]
        );
    }

    #[test]
    fn empty_select_values_keep_their_placement_after_the_direction() {
        let fixture = with_property(
            Fixture::new(),
            option_property("place", PropertyFormat::Select, &["kitchen", "study"]),
        );
        let rows = [
            row(1, "Empty", 0, &[]),
            row(2, "Kitchen", 0, &[("place", text("kitchen"))]),
        ];
        let schema = fixture.schema();
        assert_eq!(
            ids(&apply(
                &view(vec![sort("place", Direction::Asc)]),
                &rows,
                &schema
            )),
            vec![2, 1]
        );
        let mut start = sort("place", Direction::Desc);
        start.empty = EmptyPlacement::Start;
        assert_eq!(ids(&apply(&view(vec![start]), &rows, &schema)), vec![1, 2]);
    }

    #[test]
    fn dates_sort_chronologically_and_text_ignores_case() {
        let fixture = Fixture::new();
        let rows = [
            row(1, "b", 0, &[("watered", text("2026-09-30"))]),
            row(2, "A", 0, &[("watered", text("2026-10-02"))]),
            row(3, "c", 0, &[("watered", text("2026-10-01"))]),
        ];
        let schema = fixture.schema();
        assert_eq!(
            ids(&apply(
                &view(vec![sort("watered", Direction::Asc)]),
                &rows,
                &schema
            )),
            vec![1, 3, 2]
        );
        assert_eq!(
            ids(&apply(
                &view(vec![sort(TITLE_KEY, Direction::Asc)]),
                &rows,
                &schema
            )),
            vec![2, 1, 3]
        );
    }

    #[test]
    fn later_sorts_break_ties_of_earlier_ones() {
        let fixture = Fixture::new();
        let rows = [
            row(
                1,
                "A",
                0,
                &[("room", text("Kitchen")), ("count", number(2.0))],
            ),
            row(
                2,
                "B",
                0,
                &[("room", text("Kitchen")), ("count", number(1.0))],
            ),
            row(
                3,
                "C",
                0,
                &[("room", text("Attic")), ("count", number(9.0))],
            ),
        ];
        let schema = fixture.schema();
        assert_eq!(
            ids(&apply(
                &view(vec![
                    sort("room", Direction::Asc),
                    sort("count", Direction::Desc),
                ]),
                &rows,
                &schema
            )),
            vec![3, 1, 2]
        );
    }

    #[test]
    fn a_sort_on_a_property_nobody_has_keeps_the_tiebreak_order() {
        let fixture = Fixture::new();
        let rows = [row(1, "A", 5, &[]), row(2, "B", 6, &[])];
        assert_eq!(
            ids(&apply(
                &view(vec![sort("ghost", Direction::Asc)]),
                &rows,
                &fixture.schema()
            )),
            vec![2, 1]
        );
    }

    #[test]
    fn the_filter_runs_before_the_sort() {
        let fixture = Fixture::new();
        let rows = [
            row(1, "A", 0, &[("count", number(1.0))]),
            row(2, "B", 0, &[("count", number(2.0))]),
            row(3, "C", 0, &[("count", number(3.0))]),
        ];
        let mut filtered = view(vec![sort("count", Direction::Desc)]);
        filtered.filter.conditions.push(Condition {
            property: "count".to_owned(),
            condition: CondOp::Greater,
            value: Some(number(1.0)),
        });
        assert_eq!(ids(&apply(&filtered, &rows, &fixture.schema())), vec![3, 2]);
    }

    #[test]
    fn the_input_rows_are_left_alone() {
        let fixture = Fixture::new();
        let rows = [
            row(1, "B", 0, &[("count", number(2.0))]),
            row(2, "A", 0, &[("count", number(1.0))]),
        ];
        let before = rows.clone();
        let _ = apply(
            &view(vec![sort("count", Direction::Asc)]),
            &rows,
            &fixture.schema(),
        );
        assert_eq!(rows, before);
    }
}
