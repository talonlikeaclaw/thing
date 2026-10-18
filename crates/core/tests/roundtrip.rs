//! Byte-for-byte round trips over the hand-written fixtures in `tests/fixtures/`.
//!
//! `serialize ∘ parse` must reproduce each fixture exactly; that is what makes
//! the files on disk stable under a read-modify-write cycle.

use std::fs;
use std::path::{Path, PathBuf};

use thing_core::markdown::{
    parse_object, parse_property, parse_revision, parse_space, parse_type, serialize_object,
    serialize_property, serialize_revision, serialize_space, serialize_type,
};
use thing_core::model::ObjectDoc;
use thing_core::slug::slugify;

/// Reads `tests/fixtures/<name>` as UTF-8.
fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    fs::read_to_string(&path).unwrap_or_else(|err| panic!("reading {}: {err}", path.display()))
}

/// Every non-directory fixture directly under `tests/fixtures`.
fn fixture_names() -> Vec<String> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let mut names: Vec<String> = fs::read_dir(&dir)
        .unwrap_or_else(|err| panic!("reading {}: {err}", dir.display()))
        .map(|entry| entry.expect("readable dir entry").file_name())
        .map(|name| name.to_str().expect("utf-8 fixture name").to_owned())
        .collect();
    names.sort();
    names
}

fn with_prefix(prefix: &str) -> Vec<String> {
    fixture_names()
        .into_iter()
        .filter(|name| name.starts_with(prefix))
        .collect()
}

#[test]
fn object_fixtures_round_trip_byte_for_byte() {
    let names = with_prefix("object_");
    assert_eq!(names.len(), 4, "expected 4 object fixtures, got {names:?}");
    for name in names {
        let text = fixture(&name);
        let doc: ObjectDoc = parse_object(&text).unwrap_or_else(|err| panic!("{name}: {err}"));
        assert_eq!(
            serialize_object(&doc),
            text,
            "{name} is not reproduced byte for byte"
        );
        assert_eq!(
            parse_object(&serialize_object(&doc)).expect("second parse"),
            doc,
            "{name} does not survive a second parse"
        );
    }
}

#[test]
fn type_and_property_fixtures_round_trip_byte_for_byte() {
    let types = with_prefix("type_");
    assert_eq!(types.len(), 1, "expected 1 type fixture, got {types:?}");
    for name in types {
        let text = fixture(&name);
        let def = parse_type(&text).unwrap_or_else(|err| panic!("{name}: {err}"));
        assert_eq!(
            serialize_type(&def),
            text,
            "{name} is not reproduced byte for byte"
        );
    }

    let properties = with_prefix("property_");
    assert_eq!(
        properties.len(),
        2,
        "expected 2 property fixtures, got {properties:?}"
    );
    for name in properties {
        let text = fixture(&name);
        let def = parse_property(&text).unwrap_or_else(|err| panic!("{name}: {err}"));
        assert_eq!(
            serialize_property(&def),
            text,
            "{name} is not reproduced byte for byte"
        );
    }
}

#[test]
fn space_fixture_round_trips_byte_for_byte() {
    let names = with_prefix("space_");
    assert_eq!(names.len(), 1, "expected 1 space fixture, got {names:?}");
    for name in names {
        let text = fixture(&name);
        let meta = parse_space(&text).unwrap_or_else(|err| panic!("{name}: {err}"));
        assert_eq!(
            serialize_space(&meta),
            text,
            "{name} is not reproduced byte for byte"
        );
    }
}

#[test]
fn history_fixtures_round_trip_line_by_line() {
    let names = with_prefix("history_");
    assert_eq!(names.len(), 1, "expected 1 history fixture, got {names:?}");
    for name in names {
        let text = fixture(&name);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 4, "{name} line count");
        for line in lines {
            let revision = parse_revision(line).unwrap_or_else(|err| panic!("{name}: {err}"));
            assert_eq!(
                serialize_revision(&revision),
                line,
                "{name} line is not reproduced"
            );
        }
    }
}

#[test]
fn invalid_fixtures_are_refused() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/invalid");
    let mut names: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|err| panic!("reading {}: {err}", dir.display()))
        .map(|entry| entry.expect("readable dir entry").path())
        .collect();
    names.sort();
    assert_eq!(names.len(), 3, "expected 3 invalid fixtures, got {names:?}");

    let mut messages = Vec::new();
    for path in names {
        let text = fs::read_to_string(&path).expect("readable fixture");
        let err = parse_object(&text).expect_err("fixture must be refused");
        messages.push(err.to_string());
    }
    assert_eq!(
        messages[0],
        "invalid frontmatter: file must begin with a --- line"
    );
    assert_eq!(messages[1], "unsupported format version 2");
    assert!(
        messages[2].contains("unknown field `watered`"),
        "{messages:?}"
    );
}

#[test]
fn unicode_title_survives_and_still_slugs() {
    let doc = parse_object(&fixture("object_unicode.md")).expect("unicode fixture parses");
    assert_eq!(doc.title, "Étude — 日本語 notes 🪴");
    assert!(
        doc.properties.is_empty(),
        "no properties means no keys at all"
    );
    assert_eq!(doc.body, "");
    // §3's grammar is `[a-z0-9]`, so `É` is a separator and `日本語` collapses to one dash:
    // an accented leading letter is dropped, not transliterated.
    assert_eq!(slugify(&doc.title), "tude-notes");
}

#[test]
fn values_keep_their_formats() {
    use thing_core::model::Value;

    let doc = parse_object(&fixture("object_all_formats.md")).expect("formats fixture parses");
    assert_eq!(doc.properties["alive"], Value::Bool(true));
    assert_eq!(doc.properties["days"], Value::Number(7.0));
    assert_eq!(
        doc.properties["born_on"],
        Value::Text("2026-01-02".to_owned())
    );
    assert_eq!(doc.properties["status"], Value::Text("todo".to_owned()));
    assert_eq!(
        doc.properties["homepage"],
        Value::Text("https://example.com/plant".to_owned())
    );
    assert_eq!(
        doc.properties["related"],
        Value::List(vec![
            "0199f2c1-3333-7c2e-9b1d-2a4f6e8c0a1b".to_owned(),
            "0199f2c1-4444-7c2e-9b1d-2a4f6e8c0a1b".to_owned(),
        ])
    );

    let trashed = parse_object(&fixture("object_trashed.md")).expect("trashed fixture parses");
    assert!(trashed.trashed_from.as_deref() == Some("objects/plant/old-fern.md"));
    assert!(trashed.trashed_at.is_some());
    assert!(doc.trashed_at.is_none());
}
