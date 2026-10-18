//! The domain model: every type the rest of the crate is typed against.
//!
//! Field names are the JSON field names and the frontmatter keys.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// The format of a property's value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropertyFormat {
    Text,
    Number,
    Checkbox,
    Date,
    Datetime,
    Select,
    MultiSelect,
    Url,
    Email,
    Relation,
}

/// A property definition (`properties/<key>.yml`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PropertyDef {
    pub key: String,
    pub name: String,
    pub format: PropertyFormat,
    /// Present only for `Select` and `MultiSelect`; empty otherwise.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<OptionDef>,
    /// Present only for `Relation`; `None` means any type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_type: Option<String>,
    /// `Relation` only: the value is a list of target ids instead of one id.
    #[serde(default, skip_serializing_if = "is_false")]
    pub multi: bool,
}

/// One option of a `Select` / `MultiSelect` property.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OptionDef {
    pub key: String,
    pub name: String,
    pub color: String,
}

/// A type definition (`types/<key>.yml`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypeDef {
    pub key: String,
    pub name: String,
    pub name_plural: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub properties: Vec<TypeProperty>,
    pub view: ViewDef,
}

/// A property's membership in a type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypeProperty {
    pub key: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub featured: bool,
}

/// The type's single saved table view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewDef {
    pub sorts: Vec<Sort>,
    pub filter: Filter,
    /// `title` plus any property key, in display order.
    pub columns: Vec<String>,
}

/// A boolean combination of conditions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Filter {
    pub op: FilterOp,
    pub conditions: Vec<Condition>,
}

/// How a `Filter`'s conditions combine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterOp {
    And,
    Or,
}

/// One filter condition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Condition {
    pub property: String,
    pub condition: CondOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

/// The comparison a `Condition` applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CondOp {
    Equal,
    NotEqual,
    Greater,
    Less,
    GreaterOrEqual,
    LessOrEqual,
    Contains,
    NotContains,
    In,
    NotIn,
    AllIn,
    IsEmpty,
    IsNotEmpty,
}

/// One sort instruction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sort {
    pub property: String,
    pub direction: Direction,
    #[serde(default, skip_serializing_if = "EmptyPlacement::is_end")]
    pub empty: EmptyPlacement,
}

/// Sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Asc,
    Desc,
}

/// Where empty values sort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmptyPlacement {
    Start,
    #[default]
    End,
}

impl EmptyPlacement {
    fn is_end(&self) -> bool {
        matches!(self, EmptyPlacement::End)
    }
}

/// A property value; the property's format decides which variant is legal.
/// `Select` is `Text`; `MultiSelect` is `List`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    Text(String),
    Number(f64),
    Bool(bool),
    List(Vec<String>),
}

/// One object's frontmatter and body (`objects/<type-key>/<slug>.md`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObjectDoc {
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
    /// Set only while the file lives in `trash/`; `trashed_from` is its path in `objects/`.
    #[serde(
        default,
        with = "time::serde::rfc3339::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub trashed_at: Option<OffsetDateTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trashed_from: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, Value>,
    /// The markdown after the frontmatter; never part of the YAML document.
    #[serde(skip)]
    pub body: String,
}

/// A space's metadata (`space.yml`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpaceMeta {
    pub id: Uuid,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub timezone: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub members: Vec<Member>,
}

/// A space member and their role.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Member {
    pub user: Uuid,
    pub role: Role,
}

/// What a member may do in a space.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Owner,
    Editor,
    Viewer,
}

/// One history entry (`history/<object-uuid>.ndjson`, one JSON object per line).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Revision {
    pub rev: u64,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    pub by: Uuid,
    pub action: RevisionAction,
    pub snapshot: Snapshot,
    /// Only on `Create`, or when the body changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// The title and full property map after a write.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub title: String,
    pub properties: BTreeMap<String, Value>,
}

/// The kind of write a revision records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionAction {
    Create,
    Update,
    Delete,
    Restore,
}

/// An object without its body, for lists and queries.
#[derive(Debug, Clone, PartialEq)]
pub struct ObjectSummary {
    pub id: Uuid,
    pub type_key: String,
    pub title: String,
    pub rev: u64,
    pub updated_at: OffsetDateTime,
    pub properties: BTreeMap<String, Value>,
}

/// An object plus the ids of relation targets that no longer exist.
#[derive(Debug, Clone, PartialEq)]
pub struct ObjectDetail {
    pub object: ObjectDoc,
    pub missing_relations: Vec<Uuid>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_placement_defaults_to_end() {
        assert_eq!(EmptyPlacement::default(), EmptyPlacement::End);
    }
}
