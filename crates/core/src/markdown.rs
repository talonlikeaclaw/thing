//! The on-disk format: object frontmatter, type and property YAML, history lines.
//!
//! Every reader strips `schema`, refuses an unsupported version and refuses a
//! key the model does not know, so a file this crate did not write fails loudly
//! instead of losing data.

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_yaml_ng::{Mapping, Value as Yaml};

use crate::FORMAT_VERSION;
use crate::error::CoreError;
use crate::model::{ObjectDoc, PropertyDef, Revision, SpaceMeta, TypeDef};

/// Reads `objects/<type-key>/<slug>.md`.
pub fn parse_object(text: &str) -> Result<ObjectDoc, CoreError> {
    let (source, body) = split_frontmatter(text)?;
    let mut doc: ObjectDoc = read_document(source, "frontmatter")?;
    doc.body = body.to_owned();
    Ok(doc)
}

/// Writes `objects/<type-key>/<slug>.md`, body verbatim.
pub fn serialize_object(doc: &ObjectDoc) -> String {
    let mut text = String::from("---\n");
    text.push_str(&write_document(doc).expect("ObjectDoc serializes to YAML"));
    text.push_str("---\n");
    text.push_str(&doc.body);
    text
}

/// Reads `space.yml`.
pub fn parse_space(text: &str) -> Result<SpaceMeta, CoreError> {
    read_document(text, "space")
}

/// Writes `space.yml`.
pub fn serialize_space(meta: &SpaceMeta) -> String {
    write_document(meta).expect("SpaceMeta serializes to YAML")
}

/// Reads `types/<key>.yml`.
pub fn parse_type(text: &str) -> Result<TypeDef, CoreError> {
    read_document(text, "type")
}

/// Writes `types/<key>.yml`.
pub fn serialize_type(def: &TypeDef) -> String {
    write_document(def).expect("TypeDef serializes to YAML")
}

/// Reads `properties/<key>.yml`.
pub fn parse_property(text: &str) -> Result<PropertyDef, CoreError> {
    read_document(text, "property")
}

/// Writes `properties/<key>.yml`.
pub fn serialize_property(def: &PropertyDef) -> String {
    write_document(def).expect("PropertyDef serializes to YAML")
}

/// Reads one line of `history/<object-uuid>.ndjson`.
pub fn parse_revision(line: &str) -> Result<Revision, CoreError> {
    serde_json::from_str(line).map_err(|err| malformed("revision", &err.to_string()))
}

/// Writes one line of `history/<object-uuid>.ndjson`, without the newline.
pub fn serialize_revision(revision: &Revision) -> String {
    serde_json::to_string(revision).expect("Revision serializes to JSON")
}

/// Splits `---\n<yaml>---\n<body>` into the YAML source and the body verbatim.
fn split_frontmatter(text: &str) -> Result<(&str, &str), CoreError> {
    let rest = text
        .strip_prefix("---\n")
        .ok_or_else(|| malformed("frontmatter", "file must begin with a --- line"))?;
    if let Some(at) = rest.find("\n---\n") {
        return Ok((&rest[..at], &rest[at + 5..]));
    }
    match rest.strip_suffix("\n---") {
        Some(source) => Ok((source, "")),
        None => Err(malformed(
            "frontmatter",
            "frontmatter is not closed by a --- line",
        )),
    }
}

/// Parses a whole YAML document after checking its `schema`.
fn read_document<T: DeserializeOwned>(source: &str, what: &str) -> Result<T, CoreError> {
    let mut mapping = match serde_yaml_ng::from_str::<Yaml>(source) {
        Ok(Yaml::Mapping(mapping)) => mapping,
        Ok(_) => return Err(malformed(what, "expected a mapping")),
        Err(err) => return Err(malformed(what, &err.to_string())),
    };
    check_schema(&mut mapping)?;
    serde_yaml_ng::from_value(Yaml::Mapping(mapping))
        .map_err(|err| malformed(what, &err.to_string()))
}

/// Removes `schema` and refuses anything but the version this crate writes.
fn check_schema(mapping: &mut Mapping) -> Result<(), CoreError> {
    match mapping.remove("schema") {
        Some(Yaml::Number(version)) => match version.as_u64() {
            Some(found) if found == u64::from(FORMAT_VERSION) => Ok(()),
            Some(found) => Err(CoreError::UnsupportedFormat(found as u32)),
            None => Err(malformed("schema", "expected a whole number")),
        },
        Some(_) => Err(malformed("schema", "expected a number")),
        None => Err(malformed("schema", "missing")),
    }
}

/// Writes a YAML document, `schema` first.
fn write_document<T: Serialize>(value: &T) -> Result<String, CoreError> {
    let fields = match serde_yaml_ng::to_value(value) {
        Ok(Yaml::Mapping(fields)) => fields,
        Ok(_) => return Err(malformed("document", "expected a mapping")),
        Err(err) => return Err(malformed("document", &err.to_string())),
    };
    let mut mapping = Mapping::new();
    mapping.insert(
        Yaml::String("schema".to_owned()),
        Yaml::Number(FORMAT_VERSION.into()),
    );
    for (key, value) in fields {
        mapping.insert(key, value);
    }
    serde_yaml_ng::to_string(&Yaml::Mapping(mapping))
        .map_err(|err| malformed("document", &err.to_string()))
}

fn malformed(field: &str, message: &str) -> CoreError {
    CoreError::ValidationFailed {
        field: field.to_owned(),
        message: message.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use time::OffsetDateTime;
    use uuid::Uuid;

    use super::*;
    use crate::model::*;

    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn at() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_760_000_000).expect("valid timestamp")
    }

    fn doc() -> ObjectDoc {
        ObjectDoc {
            id: id(1),
            type_key: "plant".to_owned(),
            title: "Monstera — étude 🪴".to_owned(),
            rev: 3,
            created_at: at(),
            updated_at: at(),
            created_by: id(2),
            updated_by: id(3),
            trashed_at: None,
            trashed_from: None,
            properties: BTreeMap::from([
                (
                    "watered_on".to_owned(),
                    Value::Text("2026-10-15".to_owned()),
                ),
                ("days".to_owned(), Value::Number(7.0)),
                ("alive".to_owned(), Value::Bool(true)),
                ("tags".to_owned(), Value::List(vec!["easy".to_owned()])),
            ]),
            body: "\nWatered today.\n".to_owned(),
        }
    }

    #[test]
    fn object_round_trips() {
        let original = doc();
        let text = serialize_object(&original);
        assert_eq!(parse_object(&text).expect("parses back"), original);
    }

    #[test]
    fn object_uses_the_frontmatter_keys_the_format_documents() {
        let text = serialize_object(&doc());
        assert!(text.starts_with("---\nschema: 1\n"), "{text}");
        assert!(text.contains("\ntype: plant\n"), "{text}");
        assert!(
            text.contains("\ncreated_at: 2025-10-09T08:53:20Z\n"),
            "{text}"
        );
        assert!(text.ends_with("---\n\nWatered today.\n"), "{text}");
        assert!(!text.contains("type_key"), "{text}");
        assert!(!text.contains("trashed_"), "{text}");
        assert!(!text.contains("\nbody:"), "{text}");
    }

    #[test]
    fn body_is_kept_verbatim_including_dashes() {
        let mut original = doc();
        original.body = "intro\n---\nstill the body\n".to_owned();
        let text = serialize_object(&original);
        let parsed = parse_object(&text).expect("parses back");
        assert_eq!(parsed.body, original.body);
        assert_eq!(parsed.title, original.title);
    }

    #[test]
    fn empty_body_round_trips() {
        let mut original = doc();
        original.body = String::new();
        let text = serialize_object(&original);
        assert!(text.ends_with("---\n"), "{text}");
        assert_eq!(parse_object(&text).expect("parses back").body, "");
    }

    #[test]
    fn trashed_object_round_trips() {
        let mut original = doc();
        original.trashed_at = Some(at());
        original.trashed_from = Some("objects/plant/monstera.md".to_owned());
        let text = serialize_object(&original);
        assert!(
            text.contains("\ntrashed_from: objects/plant/monstera.md\n"),
            "{text}"
        );
        assert_eq!(parse_object(&text).expect("parses back"), original);
    }

    #[test]
    fn absent_values_stay_absent() {
        let text = serialize_object(&doc());
        assert!(!text.contains("null"), "{text}");
        let parsed = parse_object(&text).expect("parses back");
        assert!(!parsed.properties.contains_key("missing"));
    }

    #[test]
    fn refuses_missing_frontmatter() {
        for text in ["", "id: 1\n", "---", "title: x\n---\nbody"] {
            let err = parse_object(text).expect_err(text);
            assert!(matches!(err, CoreError::ValidationFailed { .. }), "{text}");
        }
    }

    #[test]
    fn refuses_unclosed_frontmatter() {
        let err = parse_object("---\nschema: 1\n").expect_err("unclosed");
        assert_eq!(
            err.to_string(),
            "invalid frontmatter: frontmatter is not closed by a --- line"
        );
    }

    #[test]
    fn refuses_missing_or_unsupported_schema() {
        let missing = parse_object("---\ntitle: x\n---\n").expect_err("no schema");
        assert_eq!(missing.to_string(), "invalid schema: missing");

        let future = parse_object("---\nschema: 2\ntitle: x\n---\n").expect_err("future");
        assert_eq!(future.to_string(), "unsupported format version 2");

        let not_a_number = parse_object("---\nschema: \"1\"\ntitle: x\n---\n").expect_err("string");
        assert_eq!(
            not_a_number.to_string(),
            "invalid schema: expected a number"
        );
    }

    #[test]
    fn refuses_unknown_frontmatter_keys() {
        let text = serialize_object(&doc()).replace("\ntitle: ", "\nschedule: true\ntitle: ");
        let err = parse_object(&text).expect_err("unknown key");
        assert!(err.to_string().contains("schedule"), "{err}");
    }

    #[test]
    fn reads_an_object_written_by_hand() {
        let text = "\
---
schema: 1
id: 0199f2c1-8f3a-7c2e-9b1d-2a4f6e8c0a1b
type: plant
title: Monstera
rev: 1
created_at: 2026-10-17T12:00:00Z
updated_at: 2026-10-17T12:00:00Z
created_by: 0199f2c1-1111-7c2e-9b1d-2a4f6e8c0a1b
updated_by: 0199f2c1-1111-7c2e-9b1d-2a4f6e8c0a1b
properties:
  room: kitchen
---

Watered today.
";
        let doc = parse_object(text).expect("hand-written file parses");
        assert_eq!(doc.title, "Monstera");
        assert_eq!(doc.properties.len(), 1);
        assert_eq!(doc.body, "\nWatered today.\n");
    }

    #[test]
    fn space_round_trips_and_uses_documented_keys() {
        let meta = SpaceMeta {
            id: id(1),
            name: "Garden".to_owned(),
            icon: Some("🪴".to_owned()),
            timezone: "Europe/Berlin".to_owned(),
            created_at: at(),
            members: vec![
                Member {
                    user: id(2),
                    role: Role::Owner,
                },
                Member {
                    user: id(3),
                    role: Role::Editor,
                },
            ],
        };
        let text = serialize_space(&meta);
        assert!(text.starts_with("schema: 1\nid: "), "{text}");
        assert!(text.contains("\ntimezone: Europe/Berlin\n"), "{text}");
        assert!(text.contains("\n  role: owner\n"), "{text}");
        assert_eq!(parse_space(&text).expect("parses back"), meta);
    }

    #[test]
    fn space_without_an_icon_omits_the_key() {
        let meta = SpaceMeta {
            id: id(1),
            name: "Garden".to_owned(),
            icon: None,
            timezone: "UTC".to_owned(),
            created_at: at(),
            members: vec![Member {
                user: id(2),
                role: Role::Viewer,
            }],
        };
        let text = serialize_space(&meta);
        assert!(!text.contains("icon"), "{text}");
        assert_eq!(parse_space(&text).expect("parses back"), meta);
    }

    #[test]
    fn type_round_trips_and_uses_documented_keys() {
        let def = TypeDef {
            key: "plant".to_owned(),
            name: "Plant".to_owned(),
            name_plural: "Plants".to_owned(),
            icon: Some("🪴".to_owned()),
            description: String::new(),
            properties: vec![
                TypeProperty {
                    key: "room".to_owned(),
                    required: false,
                    featured: true,
                },
                TypeProperty {
                    key: "watered_on".to_owned(),
                    required: false,
                    featured: false,
                },
            ],
            view: ViewDef {
                sorts: vec![Sort {
                    property: "updated_at".to_owned(),
                    direction: Direction::Desc,
                    empty: EmptyPlacement::End,
                }],
                filter: Filter {
                    op: FilterOp::And,
                    conditions: vec![Condition {
                        property: "room".to_owned(),
                        condition: CondOp::IsNotEmpty,
                        value: None,
                    }],
                },
                columns: vec!["title".to_owned(), "room".to_owned()],
            },
        };
        let text = serialize_type(&def);
        assert!(
            text.starts_with("schema: 1\nkey: plant\nname: Plant\nname_plural: Plants\n"),
            "{text}"
        );
        assert!(text.contains("\n    direction: desc\n"), "{text}");
        assert!(text.contains("\n      condition: is_not_empty\n"), "{text}");
        assert!(!text.contains("empty:"), "{text}");
        assert_eq!(parse_type(&text).expect("parses back"), def);
    }

    #[test]
    fn property_round_trips_for_every_format() {
        let formats = [
            PropertyFormat::Text,
            PropertyFormat::Number,
            PropertyFormat::Checkbox,
            PropertyFormat::Date,
            PropertyFormat::Datetime,
            PropertyFormat::Select,
            PropertyFormat::MultiSelect,
            PropertyFormat::Url,
            PropertyFormat::Email,
            PropertyFormat::Relation,
        ];
        for format in formats {
            let def = PropertyDef {
                key: "field".to_owned(),
                name: "Field".to_owned(),
                format,
                options: if format == PropertyFormat::Select {
                    vec![OptionDef {
                        key: "todo".to_owned(),
                        name: "To do".to_owned(),
                        color: "amber".to_owned(),
                    }]
                } else {
                    Vec::new()
                },
                target_type: if format == PropertyFormat::Relation {
                    Some("plant".to_owned())
                } else {
                    None
                },
                multi: format == PropertyFormat::Relation,
            };
            let text = serialize_property(&def);
            assert_eq!(parse_property(&text).expect("parses back"), def, "{text}");
        }
    }

    #[test]
    fn property_omits_keys_that_do_not_apply() {
        let text = serialize_property(&PropertyDef {
            key: "room".to_owned(),
            name: "Room".to_owned(),
            format: PropertyFormat::Text,
            options: Vec::new(),
            target_type: None,
            multi: false,
        });
        assert_eq!(text, "schema: 1\nkey: room\nname: Room\nformat: text\n");
    }

    #[test]
    fn revision_line_matches_the_documented_shape() {
        let revision = Revision {
            rev: 1,
            at: at(),
            by: id(2),
            action: RevisionAction::Create,
            snapshot: Snapshot {
                title: "Monstera".to_owned(),
                properties: BTreeMap::from([(
                    "room".to_owned(),
                    Value::Text("kitchen".to_owned()),
                )]),
            },
            body: Some("Watered today.".to_owned()),
        };
        let line = serialize_revision(&revision);
        assert_eq!(
            line,
            format!(
                "{{\"rev\":1,\"at\":\"2025-10-09T08:53:20Z\",\"by\":\"{by}\",\"action\":\"create\",\
                 \"snapshot\":{{\"title\":\"Monstera\",\"properties\":{{\"room\":\"kitchen\"}}}},\
                 \"body\":\"Watered today.\"}}",
                by = id(2)
            )
        );
        assert_eq!(parse_revision(&line).expect("parses back"), revision);
    }

    #[test]
    fn revision_omits_body_when_unchanged() {
        let revision = Revision {
            rev: 2,
            at: at(),
            by: id(2),
            action: RevisionAction::Update,
            snapshot: Snapshot {
                title: "Monstera".to_owned(),
                properties: BTreeMap::from([("days".to_owned(), Value::Number(7.0))]),
            },
            body: None,
        };
        let line = serialize_revision(&revision);
        assert!(!line.contains("body"), "{line}");
        assert_eq!(parse_revision(&line).expect("parses back"), revision);
    }

    #[test]
    fn revision_refuses_bad_input() {
        assert!(parse_revision("not json").is_err());
        assert!(parse_revision(r#"{"rev":1}"#).is_err());
        let unknown = serialize_revision(&Revision {
            rev: 1,
            at: at(),
            by: id(2),
            action: RevisionAction::Delete,
            snapshot: Snapshot {
                title: "T".to_owned(),
                properties: BTreeMap::new(),
            },
            body: None,
        })
        .replace("\"rev\":1", "\"rev\":1,\"author\":\"x\"");
        assert!(parse_revision(&unknown).is_err());
    }
}
