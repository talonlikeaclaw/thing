//! CSV as a projection of a type: the interchange surface, never a store.
//!
//! The header names property **keys**, because keys are stable and unique while
//! display names are editable and may collide. Lists and recurrences travel as
//! JSON inside one cell, which is the one spelling the API and frontmatter
//! already use. An empty cell means the key is absent, matching the unset-value
//! invariant; a `false` checkbox is a real value and is written as `false`.
//!
//! Parsing is structural: a cell that is not the shape its column names is a
//! problem here, but whether a date exists, an option belongs to the property or
//! a relation target has the right type is [`crate::validate::validate_object`]'s
//! job, so there is exactly one authority for meaning.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::CoreError;
use crate::model::{ObjectDoc, PropertyDef, PropertyFormat, Recurrence, TITLE_KEY, TypeDef, Value};
use crate::schedule::{self, SCHEDULE_KEYS};
use crate::validate::{self, Schema};

/// The body column's header. It cannot collide with a property key, which has
/// to start with a lowercase letter.
const BODY_KEY: &str = "_body";

/// One record as CSV carries it, before an identity or timestamps exist.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CsvRecord {
    /// 1-based data row; the header is row 0.
    pub row: usize,
    pub title: String,
    /// Typed values by property key; an absent key is an empty cell.
    pub properties: BTreeMap<String, Value>,
    pub body: String,
}

/// One reason a CSV file was refused. `row` is 0 for a file/header problem
/// and 1-based for data rows; `field` is the header key or `csv`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CsvProblem {
    pub row: usize,
    pub field: String,
    pub message: String,
}

/// The valid rows and every problem found while parsing the file.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CsvParse {
    /// Data rows read, valid or not; 0 for a header-only file.
    pub rows: usize,
    /// Rows with no problem, in file order; used for a dry-run preview.
    pub records: Vec<CsvRecord>,
    /// Every problem found; empty means the file may be committed.
    pub problems: Vec<CsvProblem>,
}

/// Every live record of `def`, in the grammar of §4.1. The caller supplies
/// `records` already ordered by title then id. The header comes from `def`;
/// each cell comes from the value's own variant, so a hand-edited mismatch
/// cannot make export guess or panic.
pub fn export(def: &TypeDef, records: &[&ObjectDoc]) -> String {
    let columns = header(def);
    let mut bytes = String::from('\u{feff}').into_bytes();
    {
        let mut writer = ::csv::WriterBuilder::new()
            .terminator(::csv::Terminator::CRLF)
            .from_writer(&mut bytes);
        writer
            .write_record(&columns)
            .expect("writing to a Vec cannot fail");
        for record in records {
            let cells: Vec<String> = columns
                .iter()
                .map(|column| match column.as_str() {
                    TITLE_KEY => record.title.clone(),
                    BODY_KEY => record.body.clone(),
                    key => record.properties.get(key).map(cell).unwrap_or_default(),
                })
                .collect();
            writer
                .write_record(&cells)
                .expect("writing to a Vec cannot fail");
        }
        writer.flush().expect("writing to a Vec cannot fail");
    }
    String::from_utf8(bytes).expect("every CSV cell is UTF-8")
}

/// Parses and validates a whole file. It returns every valid row and every
/// problem; the caller commits only when `problems` is empty, so validation is
/// all-or-nothing even though a preview can show the valid rows.
pub fn parse(schema: &Schema, def: &TypeDef, text: &str) -> CsvParse {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut reader = ::csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(text.as_bytes());

    let headers = match reader.headers() {
        Ok(headers) => headers.clone(),
        Err(error) => {
            return CsvParse {
                rows: 0,
                records: Vec::new(),
                problems: vec![CsvProblem {
                    row: 0,
                    field: "csv".to_owned(),
                    message: format!("could not read the header row: {error}"),
                }],
            };
        }
    };

    let header_problems = check_header(schema, def, &headers);
    if !header_problems.is_empty() {
        return CsvParse {
            rows: 0,
            records: Vec::new(),
            problems: header_problems,
        };
    }

    let mut title_column = None;
    let mut body_column = None;
    let mut property_columns = Vec::new();
    for (index, name) in headers.iter().enumerate() {
        match name {
            TITLE_KEY => title_column = Some(index),
            BODY_KEY => body_column = Some(index),
            key => {
                let property = schema
                    .property(key)
                    .expect("the header was checked against the schema");
                property_columns.push((index, property));
            }
        }
    }

    let mut rows = 0;
    let mut records = Vec::new();
    let mut problems = Vec::new();
    for (offset, result) in reader.records().enumerate() {
        let row = offset + 1;
        rows = row;
        let record = match result {
            Ok(record) => record,
            Err(error) => {
                problems.push(CsvProblem {
                    row,
                    field: "csv".to_owned(),
                    message: row_error_message(&error, row),
                });
                continue;
            }
        };

        let title = record
            .get(title_column.expect("the header has a title column"))
            .unwrap_or_default()
            .trim()
            .to_owned();
        let body = record
            .get(body_column.unwrap_or(usize::MAX))
            .unwrap_or_default()
            .to_owned();

        let mut properties = BTreeMap::new();
        let mut row_problems = Vec::new();
        for (index, property) in &property_columns {
            let raw = record.get(*index).unwrap_or_default();
            if raw.is_empty() {
                continue;
            }
            match parse_cell(property, raw) {
                Ok(value) => {
                    properties.insert(property.key.clone(), value);
                }
                Err(message) => row_problems.push(CsvProblem {
                    row,
                    field: property.key.clone(),
                    message,
                }),
            }
        }
        if !row_problems.is_empty() {
            problems.extend(row_problems);
            continue;
        }

        let doc = ObjectDoc {
            id: Uuid::nil(),
            type_key: def.key.clone(),
            title: title.clone(),
            icon: None,
            rev: 1,
            created_at: OffsetDateTime::UNIX_EPOCH,
            updated_at: OffsetDateTime::UNIX_EPOCH,
            created_by: Uuid::nil(),
            updated_by: Uuid::nil(),
            trashed_at: None,
            trashed_from: None,
            properties: properties.clone(),
            body: body.clone(),
        };
        match validate::validate_object(schema, &doc) {
            Ok(()) => records.push(CsvRecord {
                row,
                title,
                properties,
                body,
            }),
            Err(errors) => problems.extend(errors.into_iter().map(|error| rebase(error, row))),
        }
    }

    if rows == 0 {
        problems.push(CsvProblem {
            row: 0,
            field: "csv".to_owned(),
            message: "the file has no records".to_owned(),
        });
    }

    CsvParse {
        rows,
        records,
        problems,
    }
}

/// The exported header: title, declared members in type order, the generated
/// schedule keys while scheduling is on, then the body.
fn header(def: &TypeDef) -> Vec<String> {
    let mut columns = Vec::with_capacity(def.properties.len() + 5);
    columns.push(TITLE_KEY.to_owned());
    columns.extend(def.properties.iter().map(|member| member.key.clone()));
    if def.schedule {
        columns.extend(SCHEDULE_KEYS.iter().map(|key| (*key).to_owned()));
    }
    columns.push(BODY_KEY.to_owned());
    columns
}

/// A value as its CSV cell. The variant decides, not the property, so an object
/// written by hand cannot make export misread or panic.
fn cell(value: &Value) -> String {
    match value {
        Value::Text(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::List(items) if items.is_empty() => String::new(),
        Value::List(items) => {
            serde_json::to_string(items).expect("a list of strings is valid JSON")
        }
        Value::Recurrence(recurrence) => {
            serde_json::to_string(recurrence).expect("a recurrence is valid JSON")
        }
    }
}

/// Header checks that run once: duplicates, unknown names, the required title,
/// and schedule keys on a type that does not schedule.
fn check_header(schema: &Schema, def: &TypeDef, headers: &::csv::StringRecord) -> Vec<CsvProblem> {
    let mut problems = Vec::new();
    let mut seen = BTreeSet::new();
    let mut has_title = false;
    for name in headers {
        if !seen.insert(name) {
            problems.push(file_problem(name, "appears more than once"));
            continue;
        }
        match name {
            TITLE_KEY => has_title = true,
            BODY_KEY => {}
            key if def.has_property(key) && schema.property(key).is_some() => {}
            key if schedule::is_schedule_key(key) => problems.push(file_problem(
                key,
                "is a scheduling column, but the type is not scheduled",
            )),
            key => problems.push(file_problem(
                key,
                format!("is not a property of type {}", def.key),
            )),
        }
    }
    if !has_title {
        problems.push(file_problem(TITLE_KEY, "the header must include title"));
    }
    problems
}

fn file_problem(field: &str, message: impl Into<String>) -> CsvProblem {
    CsvProblem {
        row: 0,
        field: field.to_owned(),
        message: message.into(),
    }
}

/// Converts one non-empty cell to the value its column's format names.
///
/// Only the shape is checked here; a bad date, an unknown option or a relation
/// to a missing object is validation's decision.
fn parse_cell(property: &PropertyDef, raw: &str) -> Result<Value, String> {
    Ok(match property.format {
        PropertyFormat::Text
        | PropertyFormat::Select
        | PropertyFormat::Url
        | PropertyFormat::Email
        | PropertyFormat::Date
        | PropertyFormat::Datetime => Value::Text(raw.to_owned()),
        PropertyFormat::Number => {
            let number: f64 = raw
                .parse()
                .map_err(|_| format!("expected a number, found {raw:?}"))?;
            if !number.is_finite() {
                return Err(format!("expected a finite number, found {raw:?}"));
            }
            Value::Number(number)
        }
        PropertyFormat::Checkbox => match raw {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            _ => return Err(format!("expected true or false, found {raw:?}")),
        },
        PropertyFormat::MultiSelect => Value::List(
            serde_json::from_str::<Vec<String>>(raw)
                .map_err(|error| format!("expected a JSON array of option keys: {error}"))?,
        ),
        PropertyFormat::Relation if property.multi => Value::List(
            serde_json::from_str::<Vec<String>>(raw)
                .map_err(|error| format!("expected a JSON array of object ids: {error}"))?,
        ),
        PropertyFormat::Relation => Value::Text(raw.to_owned()),
        PropertyFormat::Recurrence => Value::Recurrence(
            serde_json::from_str::<Recurrence>(raw)
                .map_err(|error| format!("expected a JSON recurrence object: {error}"))?,
        ),
    })
}

/// Rebases a validation error onto the row that produced it.
fn rebase(error: CoreError, row: usize) -> CsvProblem {
    match error {
        CoreError::ValidationFailed { field, message } => CsvProblem {
            row,
            field,
            message,
        },
        other => CsvProblem {
            row,
            field: "csv".to_owned(),
            message: other.to_string(),
        },
    }
}

/// A reader error as a problem message, carrying the physical line when the
/// reader reports one that the data row number does not already imply.
fn row_error_message(error: &::csv::Error, row: usize) -> String {
    let base = error.to_string();
    match error.position() {
        Some(position)
            if position.line() != row as u64 + 1
                && !base.contains(&format!("line {}", position.line())) =>
        {
            format!("{base} (line {})", position.line())
        }
        _ => base,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::LazyLock;

    use time::OffsetDateTime;
    use uuid::Uuid;

    use super::*;
    use crate::model::{
        Filter, FilterOp, OptionDef, PropertyDef, Recurrence, RecurrenceKind, Sort, TypeProperty,
        UPDATED_AT_KEY, ViewDef, ViewKind,
    };

    static SCHEDULE_PROPERTIES: LazyLock<BTreeMap<String, PropertyDef>> =
        LazyLock::new(schedule::schedule_property_defs);

    struct World {
        types: BTreeMap<String, TypeDef>,
        properties: BTreeMap<String, PropertyDef>,
        objects: BTreeMap<Uuid, ObjectDoc>,
        trash: BTreeMap<Uuid, ObjectDoc>,
    }

    impl World {
        fn schema(&self) -> Schema<'_> {
            Schema {
                types: &self.types,
                properties: &self.properties,
                schedule_properties: &SCHEDULE_PROPERTIES,
                objects: &self.objects,
                trash: &self.trash,
            }
        }

        fn def(&self, key: &str) -> &TypeDef {
            self.types.get(key).expect("a defined type")
        }
    }

    fn option(key: &str) -> OptionDef {
        OptionDef {
            key: key.to_owned(),
            name: key.to_owned(),
            color: "blue".to_owned(),
        }
    }

    fn property(key: &str, format: PropertyFormat, options: &[&str], multi: bool) -> PropertyDef {
        PropertyDef {
            key: key.to_owned(),
            name: key.to_owned(),
            format,
            options: options.iter().map(|key| option(key)).collect(),
            target_type: None,
            multi,
        }
    }

    fn member(key: &str, required: bool) -> TypeProperty {
        TypeProperty {
            key: key.to_owned(),
            required,
            featured: false,
        }
    }

    fn view() -> ViewDef {
        ViewDef {
            key: "all".to_owned(),
            name: "All".to_owned(),
            kind: ViewKind::Table,
            filter: Filter {
                op: FilterOp::And,
                conditions: Vec::new(),
            },
            sorts: vec![Sort {
                property: UPDATED_AT_KEY.to_owned(),
                direction: crate::model::Direction::Desc,
                empty: Default::default(),
            }],
            columns: vec![TITLE_KEY.to_owned()],
            widths: BTreeMap::new(),
            group_by: None,
            cover: None,
            date_property: None,
        }
    }

    fn world() -> World {
        let mut properties = BTreeMap::new();
        for (key, format, options, multi) in [
            ("room", PropertyFormat::Text, &[][..], false),
            ("count", PropertyFormat::Number, &[][..], false),
            ("done", PropertyFormat::Checkbox, &[][..], false),
            ("watered", PropertyFormat::Date, &[][..], false),
            ("seen", PropertyFormat::Datetime, &[][..], false),
            ("link", PropertyFormat::Url, &[][..], false),
            ("mail", PropertyFormat::Email, &[][..], false),
            (
                "status",
                PropertyFormat::Select,
                &["growing", "resting"][..],
                false,
            ),
            (
                "tags",
                PropertyFormat::MultiSelect,
                &["porch", "study"][..],
                false,
            ),
            ("related", PropertyFormat::Relation, &[][..], false),
            ("many", PropertyFormat::Relation, &[][..], true),
            ("repeat", PropertyFormat::Recurrence, &[][..], false),
            ("body", PropertyFormat::Text, &[][..], false),
            ("note", PropertyFormat::Text, &[][..], false),
        ] {
            properties.insert(key.to_owned(), property(key, format, options, multi));
        }
        let mut plain = BTreeMap::new();
        plain.insert(
            "body".to_owned(),
            property("body", PropertyFormat::Text, &[], false),
        );
        plain.insert(
            "note".to_owned(),
            property("note", PropertyFormat::Text, &[], false),
        );

        let plant = TypeDef {
            key: "plant".to_owned(),
            name: "Plant".to_owned(),
            name_plural: "Plants".to_owned(),
            icon: None,
            description: String::new(),
            schedule: true,
            schedule_labels: Default::default(),
            properties: [
                member("room", true),
                member("count", false),
                member("done", false),
                member("watered", false),
                member("seen", false),
                member("link", false),
                member("mail", false),
                member("status", false),
                member("tags", false),
                member("related", false),
                member("many", false),
                member("repeat", false),
                member("body", false),
                member("note", false),
            ]
            .into_iter()
            .collect(),
            views: vec![view()],
            default_view: "all".to_owned(),
        };
        let plain_def = TypeDef {
            key: "note".to_owned(),
            name: "Note".to_owned(),
            name_plural: "Notes".to_owned(),
            icon: None,
            description: String::new(),
            schedule: false,
            schedule_labels: Default::default(),
            properties: [member("body", false), member("note", false)]
                .into_iter()
                .collect(),
            views: vec![view()],
            default_view: "all".to_owned(),
        };

        let target = doc(Uuid::from_u128(101), "plant", "Target");
        let second = doc(Uuid::from_u128(102), "plant", "Second target");
        let objects = [(target.id, target), (second.id, second)]
            .into_iter()
            .collect();

        World {
            types: [("plant".to_owned(), plant), ("note".to_owned(), plain_def)]
                .into_iter()
                .collect(),
            properties: {
                let mut all = plain;
                all.extend(properties);
                all
            },
            objects,
            trash: BTreeMap::new(),
        }
    }

    fn doc(id: Uuid, type_key: &str, title: &str) -> ObjectDoc {
        ObjectDoc {
            id,
            type_key: type_key.to_owned(),
            title: title.to_owned(),
            icon: None,
            rev: 1,
            created_at: OffsetDateTime::UNIX_EPOCH,
            updated_at: OffsetDateTime::UNIX_EPOCH,
            created_by: Uuid::nil(),
            updated_by: Uuid::nil(),
            trashed_at: None,
            trashed_from: None,
            properties: BTreeMap::new(),
            body: String::new(),
        }
    }

    fn full(world: &World, title: &str) -> ObjectDoc {
        let mut object = doc(Uuid::from_u128(9), "plant", title);
        let target = Uuid::from_u128(101).to_string();
        let second = Uuid::from_u128(102).to_string();
        object.properties = [
            ("room", Value::Text("Kitchen".to_owned())),
            ("count", Value::Number(12.5)),
            ("done", Value::Bool(false)),
            ("watered", Value::Text("2026-10-20".to_owned())),
            ("seen", Value::Text("2026-10-20T12:30:00Z".to_owned())),
            (
                "link",
                Value::Text("https://example.com/a,b?q=\"quoted\"".to_owned()),
            ),
            ("mail", Value::Text("fern@example.com".to_owned())),
            ("status", Value::Text("growing".to_owned())),
            (
                "tags",
                Value::List(vec!["porch".to_owned(), "study".to_owned()]),
            ),
            ("related", Value::Text(target.clone())),
            ("many", Value::List(vec![target, second])),
            (
                "repeat",
                Value::Recurrence(Recurrence {
                    kind: RecurrenceKind::Weekly,
                    every: 1,
                    weekday: Some(1),
                    day: None,
                }),
            ),
            ("body", Value::Text("a property called body".to_owned())),
            ("note", Value::Text("  keep my spaces  ".to_owned())),
            ("due_date", Value::Text("2026-10-25".to_owned())),
            (
                "recurrence",
                Value::Recurrence(Recurrence {
                    kind: RecurrenceKind::Weekly,
                    every: 2,
                    weekday: Some(3),
                    day: None,
                }),
            ),
            (
                "last_completed_at",
                Value::Text("2026-10-19T08:00:00Z".to_owned()),
            ),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect();
        object.body = "Line one\nLine \"two\", with comma\nlast".to_owned();
        let _ = world;
        object
    }

    fn parse_for(world: &World, def: &str, text: &str) -> CsvParse {
        parse(&world.schema(), world.def(def), text)
    }

    fn messages(parsed: &CsvParse) -> Vec<String> {
        parsed
            .problems
            .iter()
            .map(|problem| format!("{}:{}:{}", problem.row, problem.field, problem.message))
            .collect()
    }

    #[track_caller]
    fn assert_valid(parsed: &CsvParse) {
        assert!(
            parsed.problems.is_empty(),
            "expected no problems, got {:?}",
            messages(parsed)
        );
    }

    #[test]
    fn round_trips_every_format_and_schedule_key() {
        let world = world();
        let object = full(&world, "Fern");
        let text = export(world.def("plant"), &[&object]);
        assert!(text.starts_with('\u{feff}'));
        assert!(
            text.starts_with(
                "\u{feff}title,room,count,done,watered,seen,link,mail,status,tags,related,many,repeat,body,note,due_date,recurrence,last_completed_at,_body\r\n"
            ),
            "{text}"
        );

        let parsed = parse_for(&world, "plant", &text);
        assert_valid(&parsed);
        assert_eq!(parsed.rows, 1);
        assert_eq!(parsed.records.len(), 1);
        let record = &parsed.records[0];
        assert_eq!(record.row, 1);
        assert_eq!(record.title, "Fern");
        assert_eq!(record.properties, object.properties);
        assert_eq!(record.body, object.body);
        assert_eq!(record.properties.get("done"), Some(&Value::Bool(false)));
        assert_eq!(
            record.properties.get("tags"),
            Some(&Value::List(vec!["porch".to_owned(), "study".to_owned()]))
        );
    }

    #[test]
    fn export_writes_the_whole_shape_even_when_a_record_is_empty() {
        let world = world();
        let mut object = doc(Uuid::from_u128(9), "plant", "Bare");
        object
            .properties
            .insert("room".to_owned(), Value::Text("Hall".to_owned()));
        let text = export(world.def("plant"), &[&object]);

        let mut reader = ::csv::ReaderBuilder::new()
            .has_headers(true)
            .from_reader(text.trim_start_matches('\u{feff}').as_bytes());
        let headers = reader.headers().expect("headers").clone();
        let rows: Vec<::csv::StringRecord> =
            reader.records().map(|row| row.expect("row")).collect();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].len(), headers.len());
        assert_eq!(rows[0].get(2), Some(""));
        assert_eq!(rows[0].get(headers.len() - 1), Some(""));

        let parsed = parse_for(&world, "plant", &text);
        assert_valid(&parsed);
        assert!(!parsed.records[0].properties.contains_key("count"));
        assert!(!parsed.records[0].properties.contains_key("done"));
    }

    #[test]
    fn empty_cells_are_absent_and_false_is_a_value() {
        let world = world();
        let header = "title,room,done,count";
        let parsed = parse_for(&world, "plant", &format!("{header}\nFern,Kitchen,false,"));
        assert_valid(&parsed);
        let record = &parsed.records[0];
        assert_eq!(record.properties.get("done"), Some(&Value::Bool(false)));
        assert!(!record.properties.contains_key("count"));
    }

    #[test]
    fn parses_lf_and_crlf_and_a_bom() {
        let world = world();
        let object = full(&world, "Fern");
        let crlf = export(world.def("plant"), &[&object]);
        assert!(crlf.contains("\r\n"));
        assert_valid(&parse_for(&world, "plant", &crlf));

        let lf = crlf.trim_start_matches('\u{feff}').replace("\r\n", "\n");
        assert_valid(&parse_for(&world, "plant", &lf));
        assert_valid(&parse_for(&world, "plant", &format!("\u{feff}{lf}")));
    }

    #[test]
    fn quotes_a_comma_quote_and_newline_and_reads_it_back() {
        let world = world();
        let mut object = doc(Uuid::from_u128(9), "plant", "Comma, \"quote\"");
        object.properties.insert(
            "room".to_owned(),
            Value::Text("Kitchen, \"south\"\nsecond line".to_owned()),
        );
        object.body = "body, with \"everything\"\nand two lines".to_owned();
        let text = export(world.def("plant"), &[&object]);
        assert!(text.contains("\"Kitchen, \"\"south\"\""));
        let parsed = parse_for(&world, "plant", &text);
        assert_valid(&parsed);
        assert_eq!(
            parsed.records[0].properties.get("room"),
            Some(&Value::Text("Kitchen, \"south\"\nsecond line".to_owned()))
        );
        assert_eq!(parsed.records[0].body, object.body);
        assert_eq!(parsed.records[0].title, "Comma, \"quote\"");
    }

    #[test]
    fn accepts_reordered_headers() {
        let world = world();
        let parsed = parse_for(
            &world,
            "plant",
            "done,title,room,count\nfalse,Fern,Kitchen,2\n",
        );
        assert_valid(&parsed);
        let record = &parsed.records[0];
        assert_eq!(record.title, "Fern");
        assert_eq!(
            record.properties.get("room"),
            Some(&Value::Text("Kitchen".to_owned()))
        );
        assert_eq!(record.properties.get("done"), Some(&Value::Bool(false)));
        assert_eq!(record.properties.get("count"), Some(&Value::Number(2.0)));
    }

    #[test]
    fn refuses_unknown_duplicate_and_missing_headers() {
        let world = world();

        let unknown = parse_for(&world, "plant", "title,mystery\nFern,x\n");
        assert_eq!(unknown.rows, 0);
        assert_eq!(unknown.problems.len(), 1);
        assert_eq!(unknown.problems[0].row, 0);
        assert_eq!(unknown.problems[0].field, "mystery");

        let duplicate = parse_for(&world, "plant", "title,room,room\nFern,A,B\n");
        assert_eq!(duplicate.problems.len(), 1);
        assert_eq!(duplicate.problems[0].row, 0);
        assert_eq!(duplicate.problems[0].field, "room");
        assert!(duplicate.problems[0].message.contains("more than once"));

        let missing = parse_for(&world, "plant", "room\nKitchen\n");
        assert_eq!(missing.problems.len(), 1);
        assert_eq!(missing.problems[0].row, 0);
        assert_eq!(missing.problems[0].field, "title");

        let empty = parse_for(&world, "plant", "");
        assert_eq!(empty.problems.len(), 1);
        assert_eq!(empty.problems[0].field, "title");
    }

    #[test]
    fn refuses_a_schedule_key_on_an_unscheduled_type() {
        let world = world();
        let parsed = parse_for(&world, "note", "title,due_date\nA,2026-10-20\n");
        assert_eq!(parsed.rows, 0);
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(parsed.problems[0].row, 0);
        assert_eq!(parsed.problems[0].field, "due_date");
    }

    #[test]
    fn header_only_file_is_refused() {
        let world = world();
        for text in ["title,room\n", "title,room"] {
            let parsed = parse_for(&world, "plant", text);
            assert_eq!(parsed.rows, 0, "{text:?}");
            assert!(
                parsed
                    .problems
                    .iter()
                    .any(|problem| problem.row == 0 && problem.field == "csv"),
                "{text:?}: {:?}",
                messages(&parsed)
            );
        }
        let empty = parse_for(&world, "plant", "");
        assert_eq!(empty.rows, 0);
        assert_eq!(empty.problems[0].field, "title");
    }

    #[test]
    fn refuses_malformed_csv() {
        let world = world();
        let parsed = parse_for(&world, "plant", "title,room\n\"unterminated\n");
        assert!(
            parsed.problems.iter().any(|problem| problem.field == "csv"),
            "{:?}",
            messages(&parsed)
        );
    }

    #[test]
    fn refuses_bad_numbers_and_booleans_at_the_cell() {
        let world = world();
        let number = parse_for(&world, "plant", "title,count\nFern,abc\n");
        assert_eq!(number.records.len(), 0);
        assert_eq!(number.problems.len(), 1);
        assert_eq!(number.problems[0].row, 1);
        assert_eq!(number.problems[0].field, "count");

        let infinite = parse_for(&world, "plant", "title,count\nFern,inf\n");
        assert_eq!(infinite.problems[0].field, "count");

        let boolean = parse_for(&world, "plant", "title,done\nFern,maybe\n");
        assert_eq!(boolean.problems[0].field, "done");
        assert!(boolean.problems[0].message.contains("true or false"));
    }

    #[test]
    fn leaves_date_url_email_and_select_meaning_to_validation() {
        let world = world();
        let parsed = parse_for(
            &world,
            "plant",
            "title,room,watered,mail,link,status\nFern,Kitchen,2026-13-45,nope,not a url,unknown\n",
        );
        assert_eq!(parsed.records.len(), 0);
        let fields: Vec<&str> = parsed
            .problems
            .iter()
            .map(|problem| problem.field.as_str())
            .collect();
        assert_eq!(fields, vec!["link", "mail", "status", "watered"]);
    }

    #[test]
    fn refuses_a_relation_that_is_not_an_object_id() {
        let world = world();
        let single = parse_for(
            &world,
            "plant",
            "title,room,related\nFern,Kitchen,not-a-uuid\n",
        );
        assert_eq!(single.problems.len(), 1);
        assert_eq!(single.problems[0].field, "related");
        assert!(single.problems[0].message.contains("not an object id"));

        let multi = parse_for(
            &world,
            "plant",
            "title,room,many\nFern,Kitchen,\"[\"\"nope\"\"]\"\n",
        );
        assert_eq!(multi.problems.len(), 1);
        assert_eq!(multi.problems[0].field, "many");
    }

    #[test]
    fn reads_multi_select_and_multi_relation_json() {
        let world = world();
        let parsed = parse_for(
            &world,
            "plant",
            "title,room,tags,many\nFern,Kitchen,\"[\"\"porch\"\",\"\"study\"\"]\",\"[\"\"0199c6c4-1111-7000-8000-000000000001\"\"]\"\n",
        );
        assert_valid(&parsed);
        assert_eq!(
            parsed.records[0].properties.get("tags"),
            Some(&Value::List(vec!["porch".to_owned(), "study".to_owned()]))
        );

        let bad_list = parse_for(
            &world,
            "plant",
            "title,room,tags\nFern,Kitchen,\"[\"\"porch\"\",1]\"\n",
        );
        assert_eq!(bad_list.problems[0].field, "tags");
        let bad_many = parse_for(&world, "plant", "title,room,many\nFern,Kitchen,porch\n");
        assert_eq!(bad_many.problems[0].field, "many");
    }

    #[test]
    fn reads_and_checks_recurrence_json() {
        let world = world();
        let parsed = parse_for(
            &world,
            "plant",
            "title,room,repeat\nFern,Kitchen,\"{\"\"kind\"\":\"\"weekly\"\",\"\"every\"\":1,\"\"weekday\"\":1}\"\n",
        );
        assert_valid(&parsed);
        assert_eq!(
            parsed.records[0].properties.get("repeat"),
            Some(&Value::Recurrence(Recurrence {
                kind: RecurrenceKind::Weekly,
                every: 1,
                weekday: Some(1),
                day: None,
            }))
        );

        let malformed = parse_for(&world, "plant", "title,room,repeat\nFern,Kitchen,{oops}\n");
        assert_eq!(malformed.problems[0].field, "repeat");

        let impossible = parse_for(
            &world,
            "plant",
            "title,room,repeat\nFern,Kitchen,\"{\"\"kind\"\":\"\"weekly\"\",\"\"every\"\":0}\"\n",
        );
        // `validate_recurrence` reports the generated key, so a declared
        // recurrence property is refused at the field validation names.
        assert_eq!(impossible.problems[0].field, "recurrence");
        assert!(
            impossible.problems[0]
                .message
                .contains("between 1 and 1000")
        );
    }

    #[test]
    fn keeps_a_declared_body_property_separate_from_the_body_column() {
        let world = world();
        let mut object = doc(Uuid::from_u128(9), "note", "Fern");
        object
            .properties
            .insert("body".to_owned(), Value::Text("cell".to_owned()));
        object.body = "markdown body".to_owned();
        let text = export(world.def("note"), &[&object]);
        assert!(text.contains("title,body,note,_body\r\n"));

        let parsed = parse_for(&world, "note", &text);
        assert_valid(&parsed);
        assert_eq!(
            parsed.records[0].properties.get("body"),
            Some(&Value::Text("cell".to_owned()))
        );
        assert_eq!(parsed.records[0].body, "markdown body");
    }

    #[test]
    fn export_preserves_order_and_ignores_undeclared_keys() {
        let world = world();
        let mut first = doc(Uuid::from_u128(9), "plant", "B");
        first
            .properties
            .insert("room".to_owned(), Value::Text("Kitchen".to_owned()));
        first
            .properties
            .insert("mystery".to_owned(), Value::Text("hidden".to_owned()));
        let mut second = doc(Uuid::from_u128(10), "plant", "A");
        second
            .properties
            .insert("room".to_owned(), Value::Text("Hall".to_owned()));

        let text = export(world.def("plant"), &[&first, &second]);
        assert!(!text.contains("mystery"));
        assert!(!text.contains("hidden"));
        let rows: Vec<&str> = text
            .trim_start_matches('\u{feff}')
            .split("\r\n")
            .filter(|line| !line.is_empty())
            .collect();
        assert_eq!(rows[1].split(',').next(), Some("B"));
        assert_eq!(rows[2].split(',').next(), Some("A"));
    }

    #[test]
    fn dry_run_keeps_valid_rows_and_reports_every_problem() {
        let world = world();
        let parsed = parse_for(
            &world,
            "plant",
            "title,room,count,done\nGood,Kitchen,2,true\nBadNumber,Kitchen,abc,true\nBadBoolean,Hall,2,maybe\n",
        );
        assert_eq!(parsed.rows, 3);
        assert_eq!(parsed.records.len(), 1);
        assert_eq!(parsed.records[0].title, "Good");
        let problems: Vec<(usize, &str)> = parsed
            .problems
            .iter()
            .map(|problem| (problem.row, problem.field.as_str()))
            .collect();
        assert_eq!(problems, vec![(2, "count"), (3, "done")]);
    }

    #[test]
    fn refuses_a_missing_required_property() {
        let world = world();
        let parsed = parse_for(&world, "plant", "title\nFern\n");
        assert_eq!(parsed.records.len(), 0);
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(parsed.problems[0].row, 1);
        assert_eq!(parsed.problems[0].field, "room");
        assert!(parsed.problems[0].message.contains("required"));
    }
}
