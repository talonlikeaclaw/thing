//! What a valid object, filter and sort are.
//!
//! Validation is structural and schema-aware: a value's variant has to match the
//! property's format, the property has to belong to the type, and a required
//! property has to hold something. A relation whose target no longer exists is
//! deliberately *not* an error — a purged or copied target must not make an
//! unrelated edit impossible — so it is reported through [`dangling_relations`]
//! and the index's `problems()` instead.

use std::collections::{BTreeMap, BTreeSet};

use uuid::Uuid;

use crate::error::CoreError;
use crate::model::{
    CondOp, Condition, Filter, MAX_COLUMN_WIDTH, MAX_VIEW_NAME_LEN, MAX_VIEWS, MIN_COLUMN_WIDTH,
    ObjectDoc, PropertyDef, PropertyFormat, Sort, TITLE_KEY, TypeDef, TypeProperty, UPDATED_AT_KEY,
    Value, ViewDef, ViewKind, is_reserved_key,
};
use crate::value;

/// Longest object title, in characters.
pub const MAX_TITLE_LEN: usize = 200;

/// The definitions every validation and query runs against.
///
/// Borrowed from the index, so checking a document never copies the schema.
#[derive(Debug, Clone, Copy)]
pub struct Schema<'a> {
    pub types: &'a BTreeMap<String, TypeDef>,
    pub properties: &'a BTreeMap<String, PropertyDef>,
    /// The generated `due_date` / `recurrence` / `last_completed_at`
    /// definitions. Declared properties resolve first, so a hand-edited
    /// conflict stays visible.
    pub schedule_properties: &'a BTreeMap<String, PropertyDef>,
    /// Live objects, so relation targets can be checked.
    pub objects: &'a BTreeMap<Uuid, ObjectDoc>,
    /// Trashed objects still count as existing, so trashing a relation's
    /// target does not make the relation missing.
    pub trash: &'a BTreeMap<Uuid, ObjectDoc>,
}

impl<'a> Schema<'a> {
    /// The type with this key, if the space defines it.
    pub fn type_def(&self, key: &str) -> Option<&'a TypeDef> {
        self.types.get(key)
    }

    /// The property with this key: a declared one first, then a generated
    /// schedule property.
    pub fn property(&self, key: &str) -> Option<&'a PropertyDef> {
        self.properties
            .get(key)
            .or_else(|| self.schedule_properties.get(key))
    }

    /// The object with this id, live or trashed.
    pub fn object(&self, id: Uuid) -> Option<&'a ObjectDoc> {
        self.objects.get(&id).or_else(|| self.trash.get(&id))
    }

    /// Whether any object in the space has this id, live or trashed.
    pub fn knows_object(&self, id: Uuid) -> bool {
        self.object(id).is_some()
    }
}

/// A filter or sort column: the virtual `title`, or a property of the type.
#[derive(Debug, Clone, Copy)]
struct Column<'a> {
    pub key: &'a str,
    pub format: PropertyFormat,
    /// `None` for the title, which is not a property.
    pub property: Option<&'a PropertyDef>,
}

/// Every rule an object must satisfy, all of them collected so a form can show
/// each error at once.
pub fn validate_object(schema: &Schema, doc: &ObjectDoc) -> Result<(), Vec<CoreError>> {
    let Some(def) = schema.type_def(&doc.type_key) else {
        return Err(vec![invalid(
            "type",
            format!("unknown type {}", doc.type_key),
        )]);
    };

    let mut errors = Vec::new();
    if doc.title.trim().is_empty() {
        errors.push(invalid("title", "must not be empty"));
    } else if doc.title.chars().count() > MAX_TITLE_LEN {
        errors.push(invalid(
            "title",
            format!("keep it under {MAX_TITLE_LEN} characters"),
        ));
    }
    for (key, value) in &doc.properties {
        if is_reserved_key(key) {
            errors.push(invalid(key, "is a reserved frontmatter key"));
            continue;
        }
        let Some(property) = schema.property(key) else {
            errors.push(invalid(key, "unknown property"));
            continue;
        };
        if !def.has_property(key) {
            errors.push(invalid(
                key,
                format!("is not a property of type {}", def.key),
            ));
            continue;
        }
        if let Err(err) = validate_value(schema, property, value) {
            errors.push(err);
        }
    }
    for member in &def.properties {
        if !member.required {
            continue;
        }
        match doc.properties.get(&member.key) {
            Some(value) if !value::is_empty(value) => {}
            _ => errors.push(invalid(&member.key, "is required")),
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Checks a type's declared member list: every key is a legal, defined
/// property, listed once, and never one of the generated schedule properties.
///
/// The schedule keys are members implicitly while `schedule` is on; naming one
/// in `properties` would give it a second definition.
pub fn validate_members(schema: &Schema, members: &[TypeProperty]) -> Result<(), Vec<CoreError>> {
    let mut errors = Vec::new();
    let mut seen: Vec<&str> = Vec::with_capacity(members.len());
    for member in members {
        let key = member.key.as_str();
        if !crate::slug::is_valid_key(key) {
            errors.push(invalid(
                key,
                "is not a key: lowercase letters, digits and underscores, starting with a letter",
            ));
        } else if is_reserved_key(key) {
            errors.push(invalid(key, "is a reserved frontmatter key"));
        } else if crate::schedule::is_schedule_key(key) {
            errors.push(invalid(
                key,
                "is generated by scheduling and is not listed in properties",
            ));
        } else if schema.property(key).is_none() {
            errors.push(invalid(key, "is not a property of this space"));
        }
        if seen.contains(&key) {
            errors.push(invalid(key, "is listed twice"));
        }
        seen.push(key);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Checks a client-supplied or saved filter against a type.
pub fn validate_filter(
    schema: &Schema,
    def: &TypeDef,
    filter: &Filter,
) -> Result<(), Vec<CoreError>> {
    let errors: Vec<CoreError> = filter
        .conditions
        .iter()
        .filter_map(|condition| validate_condition(schema, def, condition).err())
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Checks sort keys against a type.
///
/// `updated_at` is accepted as well: it is the column every type's default view
/// sorts by, and the one the total order breaks ties on.
pub fn validate_sorts(
    schema: &Schema,
    def: &TypeDef,
    sorts: &[Sort],
) -> Result<(), Vec<CoreError>> {
    let errors: Vec<CoreError> = sorts
        .iter()
        .filter_map(|sort| match column(schema, def, &sort.property) {
            Some(_) => None,
            None if sort.property == UPDATED_AT_KEY => None,
            None => Some(not_on_type(def, &sort.property)),
        })
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Every problem with every view of a type: keys, names, the default, the
/// per-kind fields, and the filter/sorts/columns those views name.
///
/// Field paths are `views.<key>.<field>` (or `default_view` for the one
/// type-level key), so a client can point at the part to fix and the index can
/// name the view a problem belongs to.
pub fn validate_views(schema: &Schema, def: &TypeDef) -> Vec<CoreError> {
    let mut errors = Vec::new();
    if def.views.is_empty() || def.views.len() > MAX_VIEWS {
        errors.push(invalid(
            "views",
            format!("must hold between 1 and {MAX_VIEWS} views"),
        ));
    }
    let mut keys: BTreeSet<&str> = BTreeSet::new();
    let mut names: BTreeSet<String> = BTreeSet::new();
    for view in &def.views {
        if !crate::slug::is_valid_key(&view.key) {
            errors.push(invalid(
                &view_field(view, "key"),
                "must be a lowercase slug starting with a letter",
            ));
        } else if !keys.insert(&view.key) {
            errors.push(invalid(
                &view_field(view, "key"),
                "is used by more than one view",
            ));
        }
        let name = view.name.trim();
        if name.is_empty() || name.chars().count() > MAX_VIEW_NAME_LEN {
            errors.push(invalid(
                &view_field(view, "name"),
                format!("must be 1 to {MAX_VIEW_NAME_LEN} characters"),
            ));
        } else if !names.insert(name.to_lowercase()) {
            errors.push(invalid(
                &view_field(view, "name"),
                "is used by more than one view",
            ));
        }
        validate_view(schema, def, view, &mut errors);
    }
    if !keys.contains(def.default_view.as_str()) {
        errors.push(invalid(
            "default_view",
            format!("names no view: {}", def.default_view),
        ));
    }
    errors
}

/// Views that structurally depend on `property`: a board's `group_by` or a
/// calendar's `date_property`.
///
/// A gallery `cover` is optional, so it is cleared by a removal rather than
/// treated as a reason to refuse one.
pub fn dependent_views<'a>(def: &'a TypeDef, property: &str) -> Vec<&'a ViewDef> {
    def.views
        .iter()
        .filter(|view| {
            view.group_by.as_deref() == Some(property)
                || view.date_property.as_deref() == Some(property)
        })
        .collect()
}

fn validate_view(schema: &Schema, def: &TypeDef, view: &ViewDef, errors: &mut Vec<CoreError>) {
    match view.kind {
        ViewKind::Calendar => {
            if !view.columns.is_empty() {
                errors.push(invalid(
                    &view_field(view, "columns"),
                    "must be empty for a calendar",
                ));
            }
        }
        ViewKind::Table | ViewKind::Board | ViewKind::Gallery => {
            if view.columns.first().map(String::as_str) != Some(TITLE_KEY) {
                errors.push(invalid(
                    &view_field(view, "columns"),
                    "must start with title",
                ));
            }
        }
    }
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    for key in &view.columns {
        if !seen.insert(key) {
            errors.push(invalid(
                &view_field(view, "columns"),
                format!("lists {key} more than once"),
            ));
        }
        if column(schema, def, key).is_none() {
            errors.push(invalid(
                &view_field(view, "columns"),
                format!("names no member: {key}"),
            ));
        }
    }

    if view.kind != ViewKind::Table && !view.widths.is_empty() {
        errors.push(invalid(
            &view_field(view, "widths"),
            "belongs to table views only",
        ));
    }
    for (key, width) in &view.widths {
        if !view.columns.iter().any(|column| column == key) {
            errors.push(invalid(
                &view_field(view, &format!("widths.{key}")),
                "is not a column of this view",
            ));
        }
        if !(MIN_COLUMN_WIDTH..=MAX_COLUMN_WIDTH).contains(width) {
            errors.push(invalid(
                &view_field(view, &format!("widths.{key}")),
                format!("must be {MIN_COLUMN_WIDTH} to {MAX_COLUMN_WIDTH} pixels"),
            ));
        }
    }

    match (&view.group_by, view.kind) {
        (Some(key), ViewKind::Board) => match column(schema, def, key) {
            Some(found) if found.format == PropertyFormat::Select => {}
            Some(_) => errors.push(invalid(
                &view_field(view, "group_by"),
                "must name a select property",
            )),
            None => errors.push(invalid(
                &view_field(view, "group_by"),
                format!("names no member: {key}"),
            )),
        },
        (Some(_), _) => errors.push(invalid(
            &view_field(view, "group_by"),
            "belongs to board views only",
        )),
        (None, ViewKind::Board) => errors.push(invalid(
            &view_field(view, "group_by"),
            "is required for a board",
        )),
        (None, _) => {}
    }

    match (&view.cover, view.kind) {
        (Some(key), ViewKind::Gallery) => match column(schema, def, key) {
            Some(found) if found.property.is_some() => {}
            Some(_) => errors.push(invalid(
                &view_field(view, "cover"),
                "must name a property, not title",
            )),
            None => errors.push(invalid(
                &view_field(view, "cover"),
                format!("names no member: {key}"),
            )),
        },
        (Some(_), _) => errors.push(invalid(
            &view_field(view, "cover"),
            "belongs to gallery views only",
        )),
        (None, _) => {}
    }

    match (&view.date_property, view.kind) {
        (Some(key), ViewKind::Calendar) => match column(schema, def, key) {
            Some(found) if found.format == PropertyFormat::Date => {}
            Some(found) if found.format == PropertyFormat::Datetime => errors.push(invalid(
                &view_field(view, "date_property"),
                "must name a date property, not a datetime",
            )),
            Some(_) => errors.push(invalid(
                &view_field(view, "date_property"),
                "must name a date property",
            )),
            None => errors.push(invalid(
                &view_field(view, "date_property"),
                format!("names no member: {key}"),
            )),
        },
        (Some(_), _) => errors.push(invalid(
            &view_field(view, "date_property"),
            "belongs to calendar views only",
        )),
        (None, ViewKind::Calendar) => errors.push(invalid(
            &view_field(view, "date_property"),
            "is required for a calendar",
        )),
        (None, _) => {}
    }

    if let Err(found) = validate_filter(schema, def, &view.filter) {
        let at = view_field(view, "filter");
        errors.extend(found.into_iter().map(|error| rebase(error, &at)));
    }
    if let Err(found) = validate_sorts(schema, def, &view.sorts) {
        let at = view_field(view, "sorts");
        errors.extend(found.into_iter().map(|error| rebase(error, &at)));
    }
}

fn view_field(view: &ViewDef, field: &str) -> String {
    format!("views.{}.{field}", view.key)
}

/// Rewrites a filter or sort error's field under the path that carries it.
fn rebase(error: CoreError, at: &str) -> CoreError {
    match error {
        CoreError::ValidationFailed { field, message } => {
            invalid(&format!("{at}.{field}"), message)
        }
        other => other,
    }
}

/// Every relation value whose target is not in the space, as `(property, target)`.
pub fn dangling_relations<'a>(schema: &Schema, doc: &'a ObjectDoc) -> Vec<(&'a str, Uuid)> {
    let mut dangling = Vec::new();
    for (key, value) in &doc.properties {
        if schema.property(key).map(|def| def.format) != Some(PropertyFormat::Relation) {
            continue;
        }
        for text in relation_ids(value) {
            match Uuid::parse_str(text) {
                Ok(target) if !schema.knows_object(target) => dangling.push((key.as_str(), target)),
                _ => {}
            }
        }
    }
    dangling
}

/// The distinct ids of relation targets that are not in the space, sorted.
pub fn missing_relations(schema: &Schema, doc: &ObjectDoc) -> Vec<Uuid> {
    let mut missing: Vec<Uuid> = dangling_relations(schema, doc)
        .into_iter()
        .map(|(_, target)| target)
        .collect();
    missing.sort_unstable();
    missing.dedup();
    missing
}

fn validate_value(schema: &Schema, property: &PropertyDef, value: &Value) -> Result<(), CoreError> {
    let key = property.key.as_str();
    if !variant_matches(property, value) {
        return Err(invalid(
            key,
            format!(
                "expected {}, found {}",
                value::expected(property.format),
                value_kind(value)
            ),
        ));
    }
    match (property.format, value) {
        (PropertyFormat::Date, Value::Text(text)) if value::parse_date(text).is_none() => {
            Err(invalid(key, "expected a YYYY-MM-DD date"))
        }
        (PropertyFormat::Datetime, Value::Text(text)) if value::parse_datetime(text).is_none() => {
            Err(invalid(key, "expected an RFC 3339 datetime"))
        }
        (PropertyFormat::Url, Value::Text(text)) if !looks_like_url(text) => {
            Err(invalid(key, "expected a URL"))
        }
        (PropertyFormat::Email, Value::Text(text)) if !looks_like_email(text) => {
            Err(invalid(key, "expected an email address"))
        }
        (PropertyFormat::Select, Value::Text(option)) => {
            check_options(property, std::iter::once(option.as_str()))
        }
        (PropertyFormat::MultiSelect, Value::List(options)) => {
            check_options(property, options.iter().map(String::as_str))
        }
        (PropertyFormat::Relation, _) => validate_relation(schema, property, value),
        (PropertyFormat::Recurrence, Value::Recurrence(recurrence)) => {
            crate::schedule::validate_recurrence(recurrence)
        }
        _ => Ok(()),
    }
}

fn validate_condition(
    schema: &Schema,
    def: &TypeDef,
    condition: &Condition,
) -> Result<(), CoreError> {
    let Some(column) = column(schema, def, &condition.property) else {
        return Err(not_on_type(def, &condition.property));
    };
    let key = column.key;
    match condition.condition {
        CondOp::IsEmpty | CondOp::IsNotEmpty => match condition.value {
            None => Ok(()),
            Some(_) => Err(invalid(key, "takes no value")),
        },
        CondOp::In | CondOp::NotIn | CondOp::AllIn => match &condition.value {
            Some(Value::List(_)) => check_condition_options(column, condition.value.as_ref()),
            _ => Err(invalid(key, "expects a list of values")),
        },
        _ => match &condition.value {
            Some(value) => {
                if !value_is_scalar(value, takes_lists(column)) {
                    return Err(invalid(
                        key,
                        format!(
                            "expects a single {}, found {}",
                            value::expected(column.format),
                            value_kind(value)
                        ),
                    ));
                }
                check_condition_options(column, condition.value.as_ref())
            }
            None => Err(invalid(key, "expects a value")),
        },
    }
}

/// Whether a filter value for this column may be a list: a multi-value column
/// takes one, a single-value column does not.
fn takes_lists(column: Column<'_>) -> bool {
    match column.property {
        Some(property) => match property.format {
            PropertyFormat::MultiSelect => true,
            PropertyFormat::Relation => property.multi,
            _ => false,
        },
        None => false,
    }
}

fn check_condition_options(column: Column<'_>, value: Option<&Value>) -> Result<(), CoreError> {
    let Some(property) = column.property else {
        return Ok(());
    };
    if !matches!(
        property.format,
        PropertyFormat::Select | PropertyFormat::MultiSelect
    ) {
        return Ok(());
    }
    match value {
        Some(Value::Text(option)) => check_options(property, std::iter::once(option.as_str())),
        Some(Value::List(options)) => check_options(property, options.iter().map(String::as_str)),
        _ => Ok(()),
    }
}

/// The column a filter or sort names, if the type has it.
fn column<'a>(schema: &Schema<'a>, def: &'a TypeDef, key: &'a str) -> Option<Column<'a>> {
    if key == TITLE_KEY {
        return Some(Column {
            key,
            format: PropertyFormat::Text,
            property: None,
        });
    }
    if !def.has_property(key) {
        return None;
    }
    let property = schema.property(key)?;
    Some(Column {
        key,
        format: property.format,
        property: Some(property),
    })
}

fn not_on_type(def: &TypeDef, key: &str) -> CoreError {
    invalid(key, format!("is not a property of type {}", def.key))
}

fn variant_matches(property: &PropertyDef, value: &Value) -> bool {
    match property.format {
        PropertyFormat::Text
        | PropertyFormat::Select
        | PropertyFormat::Url
        | PropertyFormat::Email
        | PropertyFormat::Date
        | PropertyFormat::Datetime => matches!(value, Value::Text(_)),
        PropertyFormat::Number => matches!(value, Value::Number(_)),
        PropertyFormat::Checkbox => matches!(value, Value::Bool(_)),
        PropertyFormat::MultiSelect => matches!(value, Value::List(_)),
        PropertyFormat::Relation if property.multi => matches!(value, Value::List(_)),
        PropertyFormat::Relation => matches!(value, Value::Text(_)),
        PropertyFormat::Recurrence => matches!(value, Value::Recurrence(_)),
    }
}

fn value_is_scalar(value: &Value, list_allowed: bool) -> bool {
    match value {
        Value::List(_) => list_allowed,
        Value::Text(_) | Value::Number(_) | Value::Bool(_) | Value::Recurrence(_) => true,
    }
}

fn check_options<'a>(
    property: &PropertyDef,
    values: impl Iterator<Item = &'a str>,
) -> Result<(), CoreError> {
    for value in values {
        if !property.options.iter().any(|option| option.key == value) {
            return Err(invalid(&property.key, format!("unknown option {value}")));
        }
    }
    Ok(())
}

fn validate_relation(
    schema: &Schema,
    property: &PropertyDef,
    value: &Value,
) -> Result<(), CoreError> {
    for text in relation_ids(value) {
        let Ok(target) = Uuid::parse_str(text) else {
            return Err(invalid(
                &property.key,
                format!("{text:?} is not an object id"),
            ));
        };
        let Some(object) = schema.object(target) else {
            continue;
        };
        if let Some(wanted) = &property.target_type
            && object.type_key != *wanted
        {
            return Err(invalid(
                &property.key,
                format!("target {target} is a {}, not a {wanted}", object.type_key),
            ));
        }
    }
    Ok(())
}

/// The strings a relation value holds, for a single or a multi relation.
fn relation_ids(value: &Value) -> impl Iterator<Item = &str> {
    let texts: &[String] = match value {
        Value::Text(text) => std::slice::from_ref(text),
        Value::List(items) => items,
        Value::Number(_) | Value::Bool(_) | Value::Recurrence(_) => &[],
    };
    texts.iter().map(String::as_str)
}

/// Deliberately shallow: a scheme and no whitespace.
fn looks_like_url(text: &str) -> bool {
    let Some((scheme, rest)) = text.split_once("://") else {
        return false;
    };
    !scheme.is_empty()
        && !rest.is_empty()
        && scheme
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
        && !text.chars().any(char::is_whitespace)
}

/// Deliberately shallow: one `@`, both halves non-empty, a dot in the domain.
fn looks_like_email(text: &str) -> bool {
    let mut parts = text.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !text.chars().any(char::is_whitespace)
}

fn value_kind(value: &Value) -> &'static str {
    match value {
        Value::Text(_) => "text",
        Value::Number(_) => "a number",
        Value::Bool(_) => "a boolean",
        Value::List(_) => "a list",
        Value::Recurrence(_) => "a recurrence",
    }
}

fn invalid(field: &str, message: impl Into<String>) -> CoreError {
    CoreError::ValidationFailed {
        field: field.to_owned(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    static SCHEDULE_PROPERTIES: std::sync::LazyLock<BTreeMap<String, PropertyDef>> =
        std::sync::LazyLock::new(crate::schedule::schedule_property_defs);

    use time::OffsetDateTime;

    use super::*;
    use crate::model::{
        Direction, EmptyPlacement, FilterOp, OptionDef, Recurrence, RecurrenceKind, TypeProperty,
        Value, ViewDef, ViewKind,
    };

    fn at() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_760_000_000).expect("valid timestamp")
    }

    fn me() -> Uuid {
        Uuid::from_u128(1)
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

    fn option(key: &str) -> OptionDef {
        OptionDef {
            key: key.to_owned(),
            name: key.to_owned(),
            color: "grey".to_owned(),
        }
    }

    /// A type whose properties cover every format, a second type to point a
    /// mismatched relation at, and one object of each.
    struct Fixture {
        types: BTreeMap<String, TypeDef>,
        properties: BTreeMap<String, PropertyDef>,
        objects: BTreeMap<Uuid, ObjectDoc>,
        trash: BTreeMap<Uuid, ObjectDoc>,
    }

    impl Fixture {
        fn new() -> Self {
            let mut select = property("status", PropertyFormat::Select);
            select.options = vec![option("todo"), option("done")];
            let mut tags = property("tags", PropertyFormat::MultiSelect);
            tags.options = vec![option("a"), option("b")];
            let mut related = property("related", PropertyFormat::Relation);
            related.target_type = Some("plant".to_owned());
            let mut many = property("many", PropertyFormat::Relation);
            many.target_type = Some("plant".to_owned());
            many.multi = true;

            let properties: BTreeMap<String, PropertyDef> = [
                property("room", PropertyFormat::Text),
                property("count", PropertyFormat::Number),
                property("done", PropertyFormat::Checkbox),
                property("watered", PropertyFormat::Date),
                property("seen", PropertyFormat::Datetime),
                property("link", PropertyFormat::Url),
                property("mail", PropertyFormat::Email),
                property("off_type", PropertyFormat::Text),
                select,
                tags,
                related,
                many,
                property("repeat", PropertyFormat::Recurrence),
            ]
            .into_iter()
            .map(|def| (def.key.clone(), def))
            .collect();

            let listed = [
                "room", "count", "done", "watered", "seen", "link", "mail", "status", "tags",
                "related", "many", "repeat",
            ];
            let def = TypeDef {
                key: "plant".to_owned(),
                name: "Plant".to_owned(),
                name_plural: "Plants".to_owned(),
                icon: None,
                description: String::new(),
                schedule: false,
                schedule_labels: Default::default(),
                properties: listed
                    .into_iter()
                    .map(|key| TypeProperty {
                        key: key.to_owned(),
                        required: key == "room",
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
            let mut tree = def.clone();
            tree.key = "tree".to_owned();
            tree.properties.clear();

            let types = [(def.key.clone(), def), (tree.key.clone(), tree)]
                .into_iter()
                .collect();

            let objects = [
                (doc(2, "plant", "Monstera"), Uuid::from_u128(2)),
                (doc(3, "tree", "Oak"), Uuid::from_u128(3)),
            ]
            .into_iter()
            .map(|(doc, id)| (id, doc))
            .collect();
            Self {
                types,
                properties,
                objects,
                trash: BTreeMap::new(),
            }
        }

        fn schema(&self) -> Schema<'_> {
            Schema {
                types: &self.types,
                properties: &self.properties,
                schedule_properties: &SCHEDULE_PROPERTIES,
                objects: &self.objects,
                trash: &self.trash,
            }
        }
    }

    fn doc(id: u128, type_key: &str, title: &str) -> ObjectDoc {
        ObjectDoc {
            id: Uuid::from_u128(id),
            type_key: type_key.to_owned(),
            title: title.to_owned(),
            icon: None,
            rev: 1,
            created_at: at(),
            updated_at: at(),
            created_by: me(),
            updated_by: me(),
            trashed_at: None,
            trashed_from: None,
            properties: BTreeMap::new(),
            body: String::new(),
        }
    }

    fn with(values: &[(&str, Value)]) -> ObjectDoc {
        let mut object = doc(9, "plant", "Fern");
        object.properties = values
            .iter()
            .map(|(key, value)| ((*key).to_owned(), value.clone()))
            .collect();
        object
    }

    fn text(s: &str) -> Value {
        Value::Text(s.to_owned())
    }

    fn list(items: &[&str]) -> Value {
        Value::List(items.iter().map(|item| (*item).to_owned()).collect())
    }

    fn problems(result: Result<(), Vec<CoreError>>) -> Vec<String> {
        let errors = result.expect_err("expected a validation failure");
        errors.iter().map(ToString::to_string).collect()
    }

    #[track_caller]
    fn valid(result: Result<(), Vec<CoreError>>) {
        if let Err(errors) = result {
            let messages: Vec<String> = errors.iter().map(ToString::to_string).collect();
            panic!("expected valid, got {messages:?}");
        }
    }

    fn condition(property: &str, condition: CondOp, value: Option<Value>) -> Condition {
        Condition {
            property: property.to_owned(),
            condition,
            value,
        }
    }

    #[test]
    fn a_well_formed_object_passes() {
        let fixture = Fixture::new();
        let monster = Uuid::from_u128(2).to_string();
        valid(validate_object(
            &fixture.schema(),
            &with(&[
                ("room", text("Kitchen")),
                ("count", Value::Number(3.0)),
                ("done", Value::Bool(true)),
                ("watered", text("2026-10-17")),
                ("seen", text("2026-10-17T12:00:00Z")),
                ("link", text("https://example.test/monstera")),
                ("mail", text("fern@example.test")),
                ("status", text("todo")),
                ("tags", list(&["a", "b"])),
                ("related", text(monster.as_str())),
                ("many", list(&[monster.as_str()])),
            ]),
        ));
    }

    #[test]
    fn an_unknown_type_stops_at_the_type() {
        let fixture = Fixture::new();
        let mut object = doc(9, "fern", "Fern");
        object.properties.insert("ghost".to_owned(), text("x"));
        assert_eq!(
            problems(validate_object(&fixture.schema(), &object)),
            vec!["invalid type: unknown type fern"]
        );
    }

    #[test]
    fn a_title_must_not_be_empty_or_longer_than_the_limit() {
        let fixture = Fixture::new();
        let mut long = doc(9, "plant", &"a".repeat(MAX_TITLE_LEN + 1));
        long.properties.insert("room".to_owned(), text("Kitchen"));
        assert_eq!(
            problems(validate_object(&fixture.schema(), &long)),
            vec!["invalid title: keep it under 200 characters"]
        );

        let mut blank = doc(9, "plant", "   ");
        blank.properties.insert("room".to_owned(), text("Kitchen"));
        assert_eq!(
            problems(validate_object(&fixture.schema(), &blank)),
            vec!["invalid title: must not be empty"]
        );

        let mut exact = doc(9, "plant", &"a".repeat(MAX_TITLE_LEN));
        exact.properties.insert("room".to_owned(), text("Kitchen"));
        valid(validate_object(&fixture.schema(), &exact));
    }

    #[test]
    fn a_property_named_after_reserved_frontmatter_is_refused() {
        let fixture = Fixture::new();
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[("room", text("Kitchen")), ("updated_at", text("x"))])
            )),
            vec!["invalid updated_at: is a reserved frontmatter key"]
        );
    }

    #[test]
    fn a_property_the_type_does_not_list_is_refused() {
        let fixture = Fixture::new();
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[("room", text("Kitchen")), ("off_type", text("x"))])
            )),
            vec!["invalid off_type: is not a property of type plant"]
        );
    }

    #[test]
    fn an_unknown_property_is_refused() {
        let fixture = Fixture::new();
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[("room", text("Kitchen")), ("ghost", text("x"))])
            )),
            vec!["invalid ghost: unknown property"]
        );
    }

    #[test]
    fn a_value_of_the_wrong_variant_is_refused() {
        let fixture = Fixture::new();
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[
                    ("count", text("three")),
                    ("room", text("Kitchen")),
                    ("tags", text("a")),
                ])
            )),
            vec![
                "invalid count: expected a number, found text",
                "invalid tags: expected a list of option keys, found text",
            ]
        );
    }

    #[test]
    fn a_malformed_recurrence_is_refused() {
        let fixture = Fixture::new();
        let bad = Value::Recurrence(Recurrence {
            kind: RecurrenceKind::Days,
            every: 0,
            weekday: None,
            day: None,
        });
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[("room", text("Kitchen")), ("repeat", bad)])
            )),
            vec!["invalid recurrence: the interval must be between 1 and 1000"]
        );

        let good = Value::Recurrence(Recurrence {
            kind: RecurrenceKind::Weekly,
            every: 2,
            weekday: Some(1),
            day: None,
        });
        valid(validate_object(
            &fixture.schema(),
            &with(&[("room", text("Kitchen")), ("repeat", good)]),
        ));
    }

    #[test]
    fn unparseable_dates_urls_and_emails_are_refused() {
        let fixture = Fixture::new();
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[
                    ("room", text("Kitchen")),
                    ("watered", text("2026-13-45")),
                    ("seen", text("yesterday")),
                    ("link", text("example.test")),
                    ("mail", text("fern at example")),
                ])
            )),
            vec![
                "invalid link: expected a URL",
                "invalid mail: expected an email address",
                "invalid seen: expected an RFC 3339 datetime",
                "invalid watered: expected a YYYY-MM-DD date",
            ]
        );
    }

    #[test]
    fn an_unknown_option_is_refused() {
        let fixture = Fixture::new();
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[
                    ("room", text("Kitchen")),
                    ("status", text("later")),
                    ("tags", list(&["a", "z"])),
                ])
            )),
            vec![
                "invalid status: unknown option later",
                "invalid tags: unknown option z",
            ]
        );
    }

    #[test]
    fn a_multi_relation_must_hold_a_list_and_a_single_one_a_string() {
        let fixture = Fixture::new();
        let monster = Uuid::from_u128(2).to_string();
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[
                    ("room", text("Kitchen")),
                    ("many", text(monster.as_str())),
                    ("related", list(&[monster.as_str()])),
                ])
            )),
            vec![
                "invalid many: expected an object id or a list of them, found text",
                "invalid related: expected an object id or a list of them, found a list",
            ]
        );
    }

    #[test]
    fn a_relation_string_must_be_an_object_id() {
        let fixture = Fixture::new();
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[("room", text("Kitchen")), ("related", text("fern"))])
            )),
            vec!["invalid related: \"fern\" is not an object id"]
        );
    }

    #[test]
    fn a_relation_to_a_missing_object_is_reported_not_refused() {
        // A purged or copied target must not make an unrelated edit impossible.
        let fixture = Fixture::new();
        let target = Uuid::from_u128(99);
        let object = with(&[
            ("room", text("Kitchen")),
            ("related", text(&target.to_string())),
        ]);
        valid(validate_object(&fixture.schema(), &object));
        assert_eq!(missing_relations(&fixture.schema(), &object), vec![target]);
    }

    #[test]
    fn a_trashed_target_is_not_dangling() {
        let mut fixture = Fixture::new();
        let mut gone = doc(4, "plant", "Ficus");
        gone.trashed_at = Some(at());
        gone.trashed_from = Some("objects/plant/ficus.md".to_owned());
        fixture.trash.insert(gone.id, gone);

        let object = with(&[
            ("room", text("Kitchen")),
            ("related", text(&Uuid::from_u128(4).to_string())),
        ]);
        assert!(dangling_relations(&fixture.schema(), &object).is_empty());
        assert!(missing_relations(&fixture.schema(), &object).is_empty());
    }

    #[test]
    fn a_relation_to_the_wrong_type_is_refused() {
        let fixture = Fixture::new();
        let oak = Uuid::from_u128(3);
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[
                    ("room", text("Kitchen")),
                    ("related", text(&oak.to_string()))
                ])
            )),
            vec![format!(
                "invalid related: target {oak} is a tree, not a plant"
            )]
        );
    }

    #[test]
    fn required_must_hold_something() {
        let fixture = Fixture::new();
        assert_eq!(
            problems(validate_object(&fixture.schema(), &with(&[]))),
            vec!["invalid room: is required"]
        );
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[("room", text("  "))])
            )),
            vec!["invalid room: is required"]
        );
    }

    #[test]
    fn an_empty_title_is_refused() {
        let fixture = Fixture::new();
        let mut object = with(&[("room", text("Kitchen"))]);
        object.title = " ".to_owned();
        assert_eq!(
            problems(validate_object(&fixture.schema(), &object)),
            vec!["invalid title: must not be empty"]
        );
    }

    #[test]
    fn every_error_is_reported_at_once() {
        let fixture = Fixture::new();
        assert_eq!(
            problems(validate_object(
                &fixture.schema(),
                &with(&[
                    ("count", text("three")),
                    ("ghost", text("x")),
                    ("status", text("later")),
                ])
            )),
            vec![
                "invalid count: expected a number, found text",
                "invalid ghost: unknown property",
                "invalid status: unknown option later",
                "invalid room: is required",
            ]
        );
    }

    fn plant(fixture: &Fixture) -> &TypeDef {
        fixture.types.get("plant").expect("plant type")
    }

    fn view(key: &str, name: &str, kind: ViewKind) -> ViewDef {
        ViewDef {
            key: key.to_owned(),
            name: name.to_owned(),
            kind,
            filter: filter(Vec::new()),
            sorts: Vec::new(),
            columns: vec![TITLE_KEY.to_owned()],
            widths: BTreeMap::new(),
            group_by: None,
            cover: None,
            date_property: None,
        }
    }

    /// The fixture's type with a different view list.
    fn type_with(fixture: &Fixture, views: Vec<ViewDef>) -> TypeDef {
        TypeDef {
            default_view: views.first().expect("at least one view").key.clone(),
            views,
            ..plant(fixture).clone()
        }
    }

    fn view_errors(fixture: &Fixture, def: &TypeDef) -> Vec<String> {
        validate_views(&fixture.schema(), def)
            .iter()
            .map(ToString::to_string)
            .collect()
    }

    #[track_caller]
    fn views_valid(fixture: &Fixture, def: &TypeDef) {
        let errors = view_errors(fixture, def);
        assert!(errors.is_empty(), "expected valid views, got {errors:?}");
    }

    #[test]
    fn a_valid_view_of_each_kind_passes() {
        let fixture = Fixture::new();
        let mut table = view("table", "Table", ViewKind::Table);
        table.columns = vec![TITLE_KEY.to_owned(), "room".to_owned()];
        table.widths.insert(TITLE_KEY.to_owned(), 280);
        let mut board = view("board", "Board", ViewKind::Board);
        board.group_by = Some("status".to_owned());
        let mut gallery = view("gallery", "Gallery", ViewKind::Gallery);
        gallery.cover = Some("room".to_owned());
        let mut calendar = view("calendar", "Calendar", ViewKind::Calendar);
        calendar.columns.clear();
        calendar.date_property = Some("watered".to_owned());

        views_valid(
            &fixture,
            &type_with(&fixture, vec![table, board, gallery, calendar]),
        );
    }

    #[test]
    fn view_keys_and_names_are_unique() {
        let fixture = Fixture::new();
        let duplicate_keys = type_with(
            &fixture,
            vec![
                view("all", "All", ViewKind::Table),
                view("all", "Everything", ViewKind::Table),
            ],
        );
        assert!(
            view_errors(&fixture, &duplicate_keys)
                .contains(&"invalid views.all.key: is used by more than one view".to_owned())
        );

        let duplicate_names = type_with(
            &fixture,
            vec![
                view("all", "All", ViewKind::Table),
                view("everything", "ALL", ViewKind::Table),
            ],
        );
        assert!(
            view_errors(&fixture, &duplicate_names).contains(
                &"invalid views.everything.name: is used by more than one view".to_owned()
            )
        );
    }

    #[test]
    fn a_type_has_a_default_a_count_and_nonempty_names() {
        let fixture = Fixture::new();
        let mut missing_default = type_with(&fixture, vec![view("all", "All", ViewKind::Table)]);
        missing_default.default_view = "todo".to_owned();
        assert!(
            view_errors(&fixture, &missing_default)
                .contains(&"invalid default_view: names no view: todo".to_owned())
        );

        let many: Vec<ViewDef> = (0..=MAX_VIEWS)
            .map(|n| view(&format!("view_{n}"), &format!("View {n}"), ViewKind::Table))
            .collect();
        assert!(
            view_errors(&fixture, &type_with(&fixture, many)).contains(&format!(
                "invalid views: must hold between 1 and {MAX_VIEWS} views"
            ))
        );

        let blank_name = type_with(&fixture, vec![view("all", "   ", ViewKind::Table)]);
        assert!(
            view_errors(&fixture, &blank_name)
                .contains(&"invalid views.all.name: must be 1 to 80 characters".to_owned())
        );
    }

    #[test]
    fn columns_start_with_title_and_list_members_once() {
        let fixture = Fixture::new();
        let mut empty = view("all", "All", ViewKind::Table);
        empty.columns.clear();
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![empty]))
                .contains(&"invalid views.all.columns: must start with title".to_owned())
        );

        let mut duplicate = view("all", "All", ViewKind::Table);
        duplicate.columns = vec![TITLE_KEY.to_owned(), "room".to_owned(), "room".to_owned()];
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![duplicate]))
                .contains(&"invalid views.all.columns: lists room more than once".to_owned())
        );

        let mut ghost = view("all", "All", ViewKind::Table);
        ghost.columns = vec![TITLE_KEY.to_owned(), "ghost".to_owned()];
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![ghost]))
                .contains(&"invalid views.all.columns: names no member: ghost".to_owned())
        );
    }

    #[test]
    fn widths_belong_to_visible_columns_and_stay_in_range() {
        let fixture = Fixture::new();
        let mut hidden = view("all", "All", ViewKind::Table);
        hidden.widths.insert("room".to_owned(), 200);
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![hidden])).contains(
                &"invalid views.all.widths.room: is not a column of this view".to_owned()
            )
        );

        for width in [MIN_COLUMN_WIDTH - 1, MAX_COLUMN_WIDTH + 1] {
            let mut out_of_range = view("all", "All", ViewKind::Table);
            out_of_range.widths.insert(TITLE_KEY.to_owned(), width);
            assert!(view_errors(&fixture, &type_with(&fixture, vec![out_of_range])).contains(&format!(
                "invalid views.all.widths.title: must be {MIN_COLUMN_WIDTH} to {MAX_COLUMN_WIDTH} pixels"
            )));
        }

        let mut board = view("board", "Board", ViewKind::Board);
        board.group_by = Some("status".to_owned());
        board.widths.insert(TITLE_KEY.to_owned(), 200);
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![board]))
                .contains(&"invalid views.board.widths: belongs to table views only".to_owned())
        );
    }

    #[test]
    fn each_kind_requires_its_own_field_and_ignores_no_other() {
        let fixture = Fixture::new();

        let board = view("board", "Board", ViewKind::Board);
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![board]))
                .contains(&"invalid views.board.group_by: is required for a board".to_owned())
        );

        let mut text_group = view("board", "Board", ViewKind::Board);
        text_group.group_by = Some("room".to_owned());
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![text_group]))
                .contains(&"invalid views.board.group_by: must name a select property".to_owned())
        );

        let mut gallery_title = view("gallery", "Gallery", ViewKind::Gallery);
        gallery_title.cover = Some(TITLE_KEY.to_owned());
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![gallery_title])).contains(
                &"invalid views.gallery.cover: must name a property, not title".to_owned()
            )
        );

        let mut table_group = view("table", "Table", ViewKind::Table);
        table_group.group_by = Some("status".to_owned());
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![table_group]))
                .contains(&"invalid views.table.group_by: belongs to board views only".to_owned())
        );

        let calendar = view("calendar", "Calendar", ViewKind::Calendar);
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![calendar])).contains(
                &"invalid views.calendar.date_property: is required for a calendar".to_owned()
            )
        );

        let mut datetime = view("calendar", "Calendar", ViewKind::Calendar);
        datetime.columns.clear();
        datetime.date_property = Some("seen".to_owned());
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![datetime])).contains(
                &"invalid views.calendar.date_property: must name a date property, not a datetime"
                    .to_owned()
            )
        );

        let mut with_columns = view("calendar", "Calendar", ViewKind::Calendar);
        with_columns.date_property = Some("watered".to_owned());
        assert!(
            view_errors(&fixture, &type_with(&fixture, vec![with_columns])).contains(
                &"invalid views.calendar.columns: must be empty for a calendar".to_owned()
            )
        );
    }

    #[test]
    fn filters_and_sorts_are_checked_under_their_view() {
        let fixture = Fixture::new();
        let mut def = type_with(&fixture, vec![view("all", "All", ViewKind::Table)]);
        def.views[0]
            .filter
            .conditions
            .push(condition("ghost", CondOp::Equal, Some(text("x"))));
        def.views[0].sorts.push(Sort {
            property: "ghost".to_owned(),
            direction: Direction::Asc,
            empty: EmptyPlacement::End,
        });
        let errors = view_errors(&fixture, &def);
        assert!(
            errors.contains(
                &"invalid views.all.filter.ghost: is not a property of type plant".to_owned()
            ),
            "{errors:?}"
        );
        assert!(
            errors.contains(
                &"invalid views.all.sorts.ghost: is not a property of type plant".to_owned()
            ),
            "{errors:?}"
        );
    }

    #[test]
    fn dependent_views_name_the_structural_fields() {
        let fixture = Fixture::new();
        let mut board = view("board", "Board", ViewKind::Board);
        board.group_by = Some("room".to_owned());
        let mut calendar = view("calendar", "Calendar", ViewKind::Calendar);
        calendar.columns.clear();
        calendar.date_property = Some("watered".to_owned());
        let def = type_with(
            &fixture,
            vec![view("all", "All", ViewKind::Table), board, calendar],
        );

        assert_eq!(
            dependent_views(&def, "room")
                .iter()
                .map(|view| view.key.as_str())
                .collect::<Vec<_>>(),
            vec!["board"]
        );
        assert_eq!(
            dependent_views(&def, "watered")
                .iter()
                .map(|view| view.key.as_str())
                .collect::<Vec<_>>(),
            vec!["calendar"]
        );
        assert!(dependent_views(&def, "status").is_empty());
        // A cover is optional, so it never blocks a removal.
        let mut gallery = view("gallery", "Gallery", ViewKind::Gallery);
        gallery.cover = Some("room".to_owned());
        let with_cover = type_with(&fixture, vec![gallery]);
        assert!(dependent_views(&with_cover, "room").is_empty());
    }

    fn filter(conditions: Vec<Condition>) -> Filter {
        Filter {
            op: FilterOp::And,
            conditions,
        }
    }

    #[test]
    fn a_valid_filter_passes() {
        let fixture = Fixture::new();
        valid(validate_filter(
            &fixture.schema(),
            plant(&fixture),
            &filter(vec![
                condition(TITLE_KEY, CondOp::Contains, Some(text("fern"))),
                condition("room", CondOp::Equal, Some(text("Kitchen"))),
                condition("status", CondOp::In, Some(list(&["todo"]))),
                condition("count", CondOp::IsEmpty, None),
            ]),
        ));
    }

    #[test]
    fn a_filter_on_an_unknown_or_foreign_property_is_refused() {
        let fixture = Fixture::new();
        assert_eq!(
            problems(validate_filter(
                &fixture.schema(),
                plant(&fixture),
                &filter(vec![
                    condition("ghost", CondOp::Equal, Some(text("x"))),
                    condition("off_type", CondOp::Equal, Some(text("x"))),
                ])
            )),
            vec![
                "invalid ghost: is not a property of type plant",
                "invalid off_type: is not a property of type plant",
            ]
        );
    }

    #[test]
    fn a_condition_needs_the_right_value_shape() {
        let fixture = Fixture::new();
        let errors = validate_filter(
            &fixture.schema(),
            plant(&fixture),
            &filter(vec![
                condition("room", CondOp::In, Some(text("Kitchen"))),
                condition("room", CondOp::Equal, None),
                condition("room", CondOp::IsEmpty, Some(text("x"))),
                condition("room", CondOp::Equal, Some(list(&["a"]))),
            ]),
        )
        .expect_err("all four are invalid");
        assert_eq!(
            errors.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec![
                "invalid room: expects a list of values",
                "invalid room: expects a value",
                "invalid room: takes no value",
                "invalid room: expects a single text, found a list",
            ]
        );
    }

    #[test]
    fn a_filter_option_must_exist() {
        let fixture = Fixture::new();
        let errors = validate_filter(
            &fixture.schema(),
            plant(&fixture),
            &filter(vec![
                condition("status", CondOp::Equal, Some(text("later"))),
                condition("tags", CondOp::AllIn, Some(list(&["a", "z"]))),
            ]),
        )
        .expect_err("unknown options are invalid");
        assert_eq!(
            errors.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec![
                "invalid status: unknown option later",
                "invalid tags: unknown option z",
            ]
        );
    }

    #[test]
    fn a_multi_select_filter_accepts_one_option_or_a_list() {
        let fixture = Fixture::new();
        valid(validate_filter(
            &fixture.schema(),
            plant(&fixture),
            &filter(vec![
                condition("tags", CondOp::Contains, Some(text("a"))),
                condition("tags", CondOp::In, Some(list(&["a", "b"]))),
            ]),
        ));
    }

    #[test]
    fn sort_keys_must_be_columns_of_the_type() {
        let fixture = Fixture::new();
        let sort = |property: &str| Sort {
            property: property.to_owned(),
            direction: Direction::Asc,
            empty: EmptyPlacement::End,
        };
        valid(validate_sorts(
            &fixture.schema(),
            plant(&fixture),
            &[sort(TITLE_KEY), sort("count")],
        ));
        assert_eq!(
            problems(validate_sorts(
                &fixture.schema(),
                plant(&fixture),
                &[sort("ghost")]
            )),
            vec!["invalid ghost: is not a property of type plant"]
        );
    }
}
