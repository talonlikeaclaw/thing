//! How a value, a table row and an object leave the API as JSON.
//!
//! Every value leaves as `{value, label}`: `value` is what a query compares and
//! what frontmatter stores, `label` is what a table cell shows. The client
//! therefore never re-derives an option's name, a relation's title or a
//! checkbox's spelling from the raw value.

use serde::Serialize;
use serde_json::{Map, Value as Json, json};
use thing_core::index::SpaceIndex;
use thing_core::model::{
    ObjectDoc, ObjectSummary, PropertyDef, PropertyFormat, TITLE_KEY, TypeDef, Value,
};
use thing_core::schedule::{self, TimeZone};
use thing_core::validate;
use thing_core::value;
use time::OffsetDateTime;
use uuid::Uuid;

/// One row of a type's table.
#[derive(Debug, Serialize)]
pub struct SummaryJson {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub type_key: String,
    pub title: String,
    pub rev: u64,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    /// The type's view columns, minus `title`: an unset value is an absent key.
    pub values: Map<String, Json>,
    pub missing_relations: Vec<Uuid>,
    /// Timing for a scheduled type; absent on every other type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<ScheduleJson>,
}

/// One object, whole: every property it holds, its body, and its timestamps.
#[derive(Debug, Serialize)]
pub struct ObjectJson {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub type_key: String,
    pub title: String,
    pub rev: u64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    pub created_by: Uuid,
    pub updated_by: Uuid,
    #[serde(
        with = "time::serde::rfc3339::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub trashed_at: Option<OffsetDateTime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trashed_from: Option<String>,
    pub properties: Map<String, Json>,
    pub body: String,
    pub missing_relations: Vec<Uuid>,
    /// Timing for a scheduled type; absent on every other type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<ScheduleJson>,
}

/// A scheduled record's derived timing, as every surface reads it.
#[derive(Debug, Serialize)]
pub struct ScheduleJson {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    pub status: schedule::DueStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days_until_due: Option<i64>,
    #[serde(
        with = "time::serde::rfc3339::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub completed_at: Option<OffsetDateTime>,
}

impl ScheduleJson {
    fn of(state: schedule::ScheduleState) -> Self {
        Self {
            due_date: state.due_date.map(|date| date.to_string()),
            status: state.status,
            days_until_due: state.days_until_due,
            completed_at: state.last_completed_at,
        }
    }
}

/// The keys a row carries: the type's view columns, in display order, without
/// the title column, which is a field of its own.
pub fn value_columns(def: &TypeDef) -> impl Iterator<Item = &str> {
    def.view
        .columns
        .iter()
        .map(String::as_str)
        .filter(|key| *key != TITLE_KEY)
}

/// One request's projection context: the space zone resolved once, and one
/// clock reading shared by every row it renders.
pub struct Projection<'a> {
    index: &'a SpaceIndex,
    timezone: TimeZone,
    now: OffsetDateTime,
}

impl<'a> Projection<'a> {
    pub fn new(index: &'a SpaceIndex) -> Self {
        Self {
            index,
            timezone: space_timezone(index),
            now: OffsetDateTime::now_utc(),
        }
    }

    /// One table row, with the labels its cells show.
    pub fn summary_json(&self, def: &TypeDef, summary: &ObjectSummary) -> SummaryJson {
        let values = value_columns(def)
            .filter_map(|key| {
                summary
                    .properties
                    .get(key)
                    .map(|value| (key.to_owned(), value_json(self.index, key, value)))
            })
            .collect();
        SummaryJson {
            id: summary.id,
            type_key: summary.type_key.clone(),
            title: summary.title.clone(),
            rev: summary.rev,
            updated_at: summary.updated_at,
            values,
            missing_relations: self
                .index
                .object(summary.id)
                .map(|doc| missing_relations(self.index, doc))
                .unwrap_or_default(),
            schedule: self.index.object(summary.id).and_then(|doc| {
                schedule::state(def, doc, &self.timezone, self.now).map(ScheduleJson::of)
            }),
        }
    }

    /// One object, whole. Every key it holds is rendered, including one a type
    /// no longer lists: a value on disk is never dropped from a response.
    pub fn object_json(&self, doc: &ObjectDoc) -> ObjectJson {
        let def = self.index.type_def(&doc.type_key);
        let ordered = ordered_keys(def, doc);
        let properties = ordered
            .iter()
            .filter_map(|key| {
                doc.properties
                    .get(key)
                    .map(|value| (key.clone(), value_json(self.index, key, value)))
            })
            .collect();
        ObjectJson {
            id: doc.id,
            type_key: doc.type_key.clone(),
            title: doc.title.clone(),
            rev: doc.rev,
            created_at: doc.created_at,
            updated_at: doc.updated_at,
            created_by: doc.created_by,
            updated_by: doc.updated_by,
            trashed_at: doc.trashed_at,
            trashed_from: doc.trashed_from.clone(),
            properties,
            body: doc.body.clone(),
            missing_relations: missing_relations(self.index, doc),
            schedule: def
                .and_then(|def| schedule::state(def, doc, &self.timezone, self.now))
                .map(ScheduleJson::of),
        }
    }
}

/// The space zone, or UTC when `space.yml` names one that does not resolve.
pub fn space_timezone(index: &SpaceIndex) -> TimeZone {
    schedule::resolve_timezone(&index.meta().timezone)
        .unwrap_or_else(|_| schedule::resolve_timezone("UTC").expect("UTC is a zone"))
}

/// One object, whole, through a fresh projection.
pub fn object_json(index: &SpaceIndex, doc: &ObjectDoc) -> ObjectJson {
    Projection::new(index).object_json(doc)
}

/// The object's keys: its type's properties in display order first, then any
/// key the type does not list, so a leftover value is still shown.
fn ordered_keys(def: Option<&TypeDef>, doc: &ObjectDoc) -> Vec<String> {
    let mut keys: Vec<String> = Vec::with_capacity(doc.properties.len());
    if let Some(def) = def {
        for member in &def.properties {
            if doc.properties.contains_key(&member.key) {
                keys.push(member.key.clone());
            }
        }
        if def.schedule {
            for key in schedule::SCHEDULE_KEYS {
                if doc.properties.contains_key(key) {
                    keys.push(key.to_owned());
                }
            }
        }
    }
    for key in doc.properties.keys() {
        if !keys.iter().any(|known| known == key) {
            keys.push(key.clone());
        }
    }
    keys
}

/// The relation targets this object points at that the space does not hold.
fn missing_relations(index: &SpaceIndex, doc: &ObjectDoc) -> Vec<Uuid> {
    validate::missing_relations(&index.schema(), doc)
}

/// One value with its label.
pub fn value_json(index: &SpaceIndex, key: &str, value: &Value) -> Json {
    let Some(def) = index.property_def(key) else {
        return json!({ "value": value::to_json(value), "label": plain(value) });
    };
    match def.format {
        PropertyFormat::Select => match value {
            Value::Text(option) => json!({
                "value": value::to_json(value),
                "label": option_label(def, option),
            }),
            _ => json!({ "value": value::to_json(value), "label": plain(value) }),
        },
        PropertyFormat::MultiSelect => match value {
            Value::List(options) => json!({
                "value": value::to_json(value),
                "label": options
                    .iter()
                    .map(|option| option_label(def, option))
                    .collect::<Vec<_>>()
                    .join(", "),
            }),
            _ => json!({ "value": value::to_json(value), "label": plain(value) }),
        },
        PropertyFormat::Relation => relation_json(index, value),
        _ => json!({ "value": value::to_json(value), "label": plain(value) }),
    }
}

/// A relation value: the ids it stores, the titles they name, and whether any
/// target is gone. A missing target keeps its id as its label — it is surfaced,
/// never dropped.
fn relation_json(index: &SpaceIndex, value: &Value) -> Json {
    let schema = index.schema();
    let mut missing = false;
    let labels: Vec<String> = relation_ids(value)
        .map(|target| match Uuid::parse_str(target) {
            Ok(id) => match schema.object(id) {
                Some(doc) => doc.title.clone(),
                None => {
                    missing = true;
                    target.to_owned()
                }
            },
            Err(_) => {
                missing = true;
                target.to_owned()
            }
        })
        .collect();
    json!({
        "value": value::to_json(value),
        "label": labels.join(", "),
        "missing": missing,
    })
}

fn relation_ids(value: &Value) -> impl Iterator<Item = &str> {
    let ids: Vec<&str> = match value {
        Value::Text(id) => vec![id.as_str()],
        Value::List(ids) => ids.iter().map(String::as_str).collect(),
        _ => Vec::new(),
    };
    ids.into_iter()
}

/// An option's display name, or its key when the property does not define it —
/// a value whose option was removed still reads as itself.
fn option_label(def: &PropertyDef, option: &str) -> String {
    def.options
        .iter()
        .find(|known| known.key == option)
        .map_or_else(|| option.to_owned(), |known| known.name.clone())
}

/// A value as one line of text, for the formats that have no label of their own.
fn plain(value: &Value) -> String {
    match value {
        Value::Text(text) => text.clone(),
        Value::Number(number) => number_label(*number),
        Value::Bool(flag) => flag.to_string(),
        Value::List(items) => items.join(", "),
        Value::Recurrence(recurrence) => schedule::recurrence_label(recurrence),
    }
}

/// A number as a table shows it: integral values without a trailing `.0`.
fn number_label(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e15 {
        format!("{}", number as i64)
    } else {
        number.to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use thing_core::model::{
        Direction, EmptyPlacement, Filter, FilterOp, OptionDef, Sort, TypeProperty, ViewDef,
    };

    use super::*;

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

    fn select_property() -> PropertyDef {
        PropertyDef {
            options: vec![OptionDef {
                key: "todo".to_owned(),
                name: "To do".to_owned(),
                color: "amber".to_owned(),
            }],
            ..property("status", PropertyFormat::Select)
        }
    }

    #[test]
    fn a_select_value_carries_the_option_display_name() {
        let index = index_of(&[select_property()]);
        assert_eq!(
            value_json(&index, "status", &Value::Text("todo".to_owned())),
            json!({ "value": "todo", "label": "To do" })
        );
        // An option the property does not define reads as its own key.
        assert_eq!(
            value_json(&index, "status", &Value::Text("gone".to_owned())),
            json!({ "value": "gone", "label": "gone" })
        );
    }

    /// A space holding one property definition and no objects at all.
    fn index_of(properties: &[PropertyDef]) -> SpaceIndex {
        let dir = tempfile::tempdir().expect("a temporary space");
        let meta = thing_core::model::SpaceMeta {
            id: Uuid::now_v7(),
            name: "Garden".to_owned(),
            icon: None,
            timezone: "UTC".to_owned(),
            created_at: OffsetDateTime::now_utc(),
            members: Vec::new(),
        };
        let store = thing_core::store::fs::FsSpaceStore::create(dir.path(), &meta)
            .expect("creates the space");
        for def in properties {
            thing_core::store::SpaceStore::save_property(&store, def, None).expect("property");
        }
        SpaceIndex::rebuild_from_disk(&store).expect("index")
    }

    /// A summary of one object of a type whose view shows every property given.
    fn summary(properties: &BTreeMap<String, Value>, columns: &[&str]) -> (TypeDef, ObjectSummary) {
        let def = TypeDef {
            key: "plant".to_owned(),
            name: "Plant".to_owned(),
            name_plural: "Plants".to_owned(),
            icon: None,
            description: String::new(),
            schedule: false,
            schedule_labels: Default::default(),
            properties: columns
                .iter()
                .map(|key| TypeProperty {
                    key: (*key).to_owned(),
                    required: false,
                    featured: false,
                })
                .collect(),
            view: ViewDef {
                sorts: vec![Sort {
                    property: "updated_at".to_owned(),
                    direction: Direction::Desc,
                    empty: EmptyPlacement::End,
                }],
                filter: Filter {
                    op: FilterOp::And,
                    conditions: Vec::new(),
                },
                columns: std::iter::once(TITLE_KEY.to_owned())
                    .chain(columns.iter().map(|key| (*key).to_owned()))
                    .collect(),
            },
        };
        let summary = ObjectSummary {
            id: Uuid::now_v7(),
            type_key: "plant".to_owned(),
            title: "Monstera".to_owned(),
            rev: 1,
            updated_at: OffsetDateTime::UNIX_EPOCH,
            properties: properties.clone(),
        };
        (def, summary)
    }

    #[test]
    fn a_row_carries_its_view_columns_and_leaves_unset_ones_out() {
        let index = index_of(&[property("room", PropertyFormat::Text)]);
        let (def, summary) = summary(
            &BTreeMap::from([
                ("room".to_owned(), Value::Text("kitchen".to_owned())),
                ("hidden".to_owned(), Value::Text("x".to_owned())),
            ]),
            &["room", "watering"],
        );
        let json = serde_json::to_value(Projection::new(&index).summary_json(&def, &summary))
            .expect("json");
        assert_eq!(json["title"], "Monstera");
        assert_eq!(
            json["values"]["room"],
            json!({ "value": "kitchen", "label": "kitchen" })
        );
        assert_eq!(
            json["values"].get("watering"),
            None,
            "an unset value is an absent key"
        );
        assert_eq!(
            json["values"].get("hidden"),
            None,
            "a column the view does not show is not in the row"
        );
        assert!(
            json.get("schedule").is_none(),
            "an unscheduled type carries no schedule"
        );
    }

    #[test]
    fn a_relation_value_reports_a_missing_target_instead_of_dropping_it() {
        let index = index_of(&[property("related", PropertyFormat::Relation)]);
        let target = Uuid::now_v7().to_string();
        assert_eq!(
            value_json(&index, "related", &Value::Text(target.clone())),
            json!({ "value": target, "label": target, "missing": true })
        );
    }

    #[test]
    fn a_schedule_projection_omits_what_it_does_not_know() {
        let done = ScheduleJson::of(schedule::ScheduleState {
            due_date: None,
            status: schedule::DueStatus::Done,
            days_until_due: None,
            last_completed_at: Some(OffsetDateTime::UNIX_EPOCH),
        });
        assert_eq!(
            serde_json::to_value(done).expect("json"),
            json!({ "status": "done", "completed_at": "1970-01-01T00:00:00Z" })
        );

        let overdue = ScheduleJson::of(schedule::ScheduleState {
            due_date: Some("2026-10-19".parse().expect("a date")),
            status: schedule::DueStatus::Overdue,
            days_until_due: Some(-2),
            last_completed_at: None,
        });
        assert_eq!(
            serde_json::to_value(overdue).expect("json"),
            json!({ "due_date": "2026-10-19", "status": "overdue", "days_until_due": -2 })
        );
    }

    #[test]
    fn numbers_read_without_a_trailing_zero() {
        assert_eq!(plain(&Value::Number(7.0)), "7");
        assert_eq!(plain(&Value::Number(7.5)), "7.5");
        assert_eq!(
            plain(&Value::List(vec!["a".to_owned(), "b".to_owned()])),
            "a, b"
        );
        assert_eq!(plain(&Value::Bool(true)), "true");
    }
}
