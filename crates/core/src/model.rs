//! The domain model: every type the rest of the crate is typed against.
//!
//! Field names are the JSON field names and the frontmatter keys.

use std::collections::BTreeMap;
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::CoreError;

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
    Recurrence,
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

/// Display names for a scheduled type's generated vocabulary.
///
/// The keys on disk never move: this only changes what the interface calls
/// them, so a plant type can say "Last watered" while the record still stores
/// `last_completed_at`. Empty fields mean the default name.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduleLabels {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_completed: Option<String>,
    /// The button that records a completion, for example "Water".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub complete: Option<String>,
}

impl ScheduleLabels {
    /// The label for one generated key; `None` means the built-in name.
    pub fn for_key(&self, key: &str) -> Option<&str> {
        match key {
            crate::schedule::DUE_DATE_KEY => self.due.as_deref(),
            crate::schedule::RECURRENCE_KEY => self.recurrence.as_deref(),
            crate::schedule::LAST_COMPLETED_KEY => self.last_completed.as_deref(),
            _ => None,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.due.is_none()
            && self.recurrence.is_none()
            && self.last_completed.is_none()
            && self.complete.is_none()
    }
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
    /// Whether this type carries the three generated schedule properties.
    #[serde(default, skip_serializing_if = "is_false")]
    pub schedule: bool,
    /// Display names for the generated schedule properties; empty means default.
    #[serde(default, skip_serializing_if = "ScheduleLabels::is_empty")]
    pub schedule_labels: ScheduleLabels,
    #[serde(default)]
    pub properties: Vec<TypeProperty>,
    pub views: Vec<ViewDef>,
    /// The `key` of the view the type opens with; always one of `views`.
    pub default_view: String,
}

impl TypeDef {
    /// Whether `key` is usable on this type: a declared member, or one of the
    /// generated schedule properties while scheduling is on.
    pub fn has_property(&self, key: &str) -> bool {
        self.properties.iter().any(|member| member.key == key)
            || (self.schedule && crate::schedule::is_schedule_key(key))
    }

    /// The view with this key, if the type defines one.
    pub fn view(&self, key: &str) -> Option<&ViewDef> {
        self.views.iter().find(|view| view.key == key)
    }

    /// The view `default_view` names; `None` only for an in-memory definition
    /// that has not been through parsing or validation.
    pub fn default_view(&self) -> Option<&ViewDef> {
        self.view(&self.default_view)
    }
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

/// The most views one type may carry.
pub const MAX_VIEWS: usize = 50;

/// The longest view name, in characters.
pub const MAX_VIEW_NAME_LEN: usize = 80;

/// The narrowest table column, in CSS pixels.
pub const MIN_COLUMN_WIDTH: u16 = 80;

/// The widest table column, in CSS pixels.
pub const MAX_COLUMN_WIDTH: u16 = 800;

/// How a saved view lays its records out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewKind {
    Table,
    Board,
    Gallery,
    Calendar,
}

/// One named saved view of a type.
///
/// A flat shape rather than four nested configs: `columns` means visible
/// columns for a table and card fields for a board or gallery; the validator
/// enforces which optional fields belong to which kind.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewDef {
    pub key: String,
    pub name: String,
    pub kind: ViewKind,
    pub filter: Filter,
    pub sorts: Vec<Sort>,
    /// `title` plus any property key, in display order; empty for a calendar.
    pub columns: Vec<String>,
    /// Table column widths in CSS pixels; absent means the renderer's default.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub widths: BTreeMap<String, u16>,
    /// A `select` property; board views only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_by: Option<String>,
    /// The property whose label becomes a gallery cover; gallery views only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    /// A `date` property; calendar views only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_property: Option<String>,
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

/// How a scheduled record repeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceKind {
    Days,
    Weekly,
    Monthly,
}

/// A recurrence value: one mapping in frontmatter, one object in JSON.
///
/// `weekday` is `0`=Sunday through `6`=Saturday and belongs only to `Weekly`;
/// `day` is `1..=31` and belongs only to `Monthly`. The structural rules are
/// enforced by [`crate::schedule::validate_recurrence`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recurrence {
    pub kind: RecurrenceKind,
    /// Days, weeks or months between occurrences, depending on `kind`.
    pub every: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekday: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day: Option<u8>,
}

/// A property value; the property's format decides which variant is legal.
/// `Select` is `Text`; `MultiSelect` is `List`; `Recurrence` is a mapping.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    Text(String),
    Number(f64),
    Bool(bool),
    List(Vec<String>),
    Recurrence(Recurrence),
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

impl Role {
    /// Whether this role may do what `required` requires; the order is
    /// `owner` > `editor` > `viewer`, so an owner passes every check.
    pub fn allows(self, required: Self) -> bool {
        self.rank() >= required.rank()
    }

    /// The spelling used in `space.yml` and in the API, matching serde's
    /// `snake_case` rename (pinned by a test).
    pub const fn text(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Editor => "editor",
            Self::Viewer => "viewer",
        }
    }

    fn rank(self) -> u8 {
        match self {
            Self::Owner => 3,
            Self::Editor => 2,
            Self::Viewer => 1,
        }
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.text())
    }
}

impl FromStr for Role {
    type Err = CoreError;

    fn from_str(text: &str) -> Result<Self, CoreError> {
        match text {
            "owner" => Ok(Self::Owner),
            "editor" => Ok(Self::Editor),
            "viewer" => Ok(Self::Viewer),
            other => Err(CoreError::ValidationFailed {
                field: "role".to_owned(),
                message: format!("unknown role {other}"),
            }),
        }
    }
}

impl SpaceMeta {
    /// The role this user holds, or `None` when they are not a member.
    pub fn role_of(&self, user: Uuid) -> Option<Role> {
        self.members
            .iter()
            .find(|member| member.user == user)
            .map(|member| member.role)
    }

    /// Adds this user, or changes the role of one already a member.
    pub fn set_member(&mut self, user: Uuid, role: Role) {
        match self.members.iter_mut().find(|member| member.user == user) {
            Some(existing) => existing.role = role,
            None => self.members.push(Member { user, role }),
        }
    }

    /// Removes this user; reports whether they were a member.
    pub fn remove_member(&mut self, user: Uuid) -> bool {
        let before = self.members.len();
        self.members.retain(|member| member.user != user);
        self.members.len() != before
    }

    /// Whether this user is the only owner, so demoting or removing them would
    /// leave the space unowned.
    pub fn is_last_owner(&self, user: Uuid) -> bool {
        self.role_of(user) == Some(Role::Owner)
            && self
                .members
                .iter()
                .filter(|member| member.role == Role::Owner)
                .count()
                == 1
    }
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
    Complete,
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

impl From<&ObjectDoc> for ObjectSummary {
    fn from(doc: &ObjectDoc) -> Self {
        Self {
            id: doc.id,
            type_key: doc.type_key.clone(),
            title: doc.title.clone(),
            rev: doc.rev,
            updated_at: doc.updated_at,
            properties: doc.properties.clone(),
        }
    }
}

/// An object plus the ids of relation targets that no longer exist.
#[derive(Debug, Clone, PartialEq)]
pub struct ObjectDetail {
    pub object: ObjectDoc,
    pub missing_relations: Vec<Uuid>,
}

/// The property key that names an object's title in views, filters and sorts.
pub const TITLE_KEY: &str = "title";

/// The frontmatter key an object's last-write time is stored under. It is a
/// sort column like `title`, but not a filter column: a filter names a property
/// or the title.
pub const UPDATED_AT_KEY: &str = "updated_at";

/// Frontmatter keys no property may be named after: each one is written by the
/// object format itself, so a property with the same key would have two writers.
pub const RESERVED_KEYS: &[&str] = &[
    "schema",
    "id",
    "type",
    "title",
    "rev",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "properties",
    "trashed_at",
    "trashed_from",
];

/// Whether a fixed frontmatter key is spelled `key`.
pub fn is_reserved_key(key: &str) -> bool {
    RESERVED_KEYS.contains(&key)
}

/// Whether a property may be keyed `key`: not a frontmatter key, and not one
/// of the generated schedule keys, which every space reserves.
pub fn is_reserved_property_key(key: &str) -> bool {
    is_reserved_key(key) || crate::schedule::is_schedule_key(key)
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod tests {
    use super::*;

    fn space() -> SpaceMeta {
        SpaceMeta {
            id: Uuid::now_v7(),
            name: "Garden".to_owned(),
            icon: None,
            timezone: "UTC".to_owned(),
            created_at: OffsetDateTime::UNIX_EPOCH,
            members: Vec::new(),
        }
    }

    #[test]
    fn schedule_keys_are_reserved_property_keys_in_every_space() {
        for key in crate::schedule::SCHEDULE_KEYS {
            assert!(is_reserved_property_key(key));
            assert!(!is_reserved_key(key));
        }
        assert!(is_reserved_property_key("title"));
        assert!(!is_reserved_property_key("due"));
    }

    #[test]
    fn empty_placement_defaults_to_end() {
        assert_eq!(EmptyPlacement::default(), EmptyPlacement::End);
    }

    #[test]
    fn the_wire_spelling_is_the_rendered_one() {
        for role in [Role::Owner, Role::Editor, Role::Viewer] {
            let yaml = serde_yaml_ng::to_string(&role).expect("serializes");
            assert_eq!(yaml.trim(), role.to_string());
            assert_eq!(role.to_string().parse::<Role>().expect("parses back"), role);
        }
        assert!(matches!(
            "admin".parse::<Role>(),
            Err(CoreError::ValidationFailed { .. })
        ));
    }

    #[test]
    fn a_higher_role_allows_everything_a_lower_one_does() {
        assert!(Role::Owner.allows(Role::Owner));
        assert!(Role::Owner.allows(Role::Editor));
        assert!(Role::Owner.allows(Role::Viewer));
        assert!(Role::Editor.allows(Role::Editor));
        assert!(Role::Editor.allows(Role::Viewer));
        assert!(Role::Viewer.allows(Role::Viewer));
        assert!(!Role::Editor.allows(Role::Owner));
        assert!(!Role::Viewer.allows(Role::Editor));
        assert!(!Role::Viewer.allows(Role::Owner));
    }

    #[test]
    fn set_member_adds_once_and_then_changes_the_role() {
        let mut meta = space();
        let user = Uuid::now_v7();
        meta.set_member(user, Role::Viewer);
        meta.set_member(user, Role::Editor);
        assert_eq!(meta.members.len(), 1);
        assert_eq!(meta.role_of(user), Some(Role::Editor));
        assert_eq!(meta.role_of(Uuid::now_v7()), None);
    }

    #[test]
    fn remove_member_reports_whether_anyone_was_removed() {
        let mut meta = space();
        let user = Uuid::now_v7();
        meta.set_member(user, Role::Owner);
        assert!(meta.remove_member(user));
        assert!(!meta.remove_member(user));
        assert!(meta.members.is_empty());
    }

    #[test]
    fn schedule_labels_round_trip_without_moving_the_generated_keys() {
        let yaml = r#"
key: plant
name: Plant
name_plural: Plants
description: ''
schedule: true
schedule_labels:
  last_completed: Last watered
  complete: Water
properties: []
views:
- key: all
  name: All
  kind: table
  sorts: []
  filter: {op: and, conditions: []}
  columns: [title]
default_view: all
"#;
        let def: TypeDef = serde_yaml_ng::from_str(yaml).expect("a type");
        assert_eq!(
            def.schedule_labels.for_key("last_completed_at"),
            Some("Last watered")
        );
        assert_eq!(def.schedule_labels.complete.as_deref(), Some("Water"));
        assert_eq!(def.schedule_labels.for_key("due_date"), None);

        let written = serde_yaml_ng::to_string(&def).expect("yaml");
        assert!(written.contains("last_completed: Last watered"));
        assert!(written.contains("complete: Water"));
        assert!(!written.contains("due:"), "an unset label is omitted");
    }

    #[test]
    fn the_last_owner_is_the_only_one_that_blocks_a_demotion() {
        let mut meta = space();
        let first = Uuid::now_v7();
        let second = Uuid::now_v7();
        meta.set_member(first, Role::Owner);
        assert!(meta.is_last_owner(first));
        meta.set_member(second, Role::Owner);
        assert!(!meta.is_last_owner(first));
        meta.set_member(second, Role::Viewer);
        assert!(meta.is_last_owner(first));
        assert!(!meta.is_last_owner(second));
    }
}
