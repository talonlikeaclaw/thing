//! Computed properties: definition checks, per-type checks and evaluation.
//!
//! A computed value is materialized on every read and never stored. The
//! evaluator is request-scoped: it resolves one `today` in the space's zone,
//! compiles each formula once, and reads only the computed keys a caller names.
//! There is no invalidation graph and no cache in the index — every write
//! already invalidates the whole space, and every read derives its columns.

use std::collections::{BTreeMap, BTreeSet};

use jiff::civil::Date;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::CoreError;
use crate::formula::{self, EvalContext, Expr, Reference, TypeContext, ValueType};
use crate::index::SpaceIndex;
use crate::model::{
    Aggregate, ComputeDef, ComputeKind, ObjectDoc, ObjectSummary, OptionDef, PropertyDef,
    PropertyFormat, TITLE_KEY, TypeDef, Value,
};
use crate::schedule::{self, TimeZone};
use crate::validate::Schema;
use crate::value;

/// One definition or membership problem, positioned where a client can show it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputedProblem {
    pub property_key: String,
    /// Empty for a definition problem not tied to one type.
    pub type_key: String,
    pub field: String,
    pub message: String,
}

fn invalid(field: &str, message: impl Into<String>) -> CoreError {
    CoreError::ValidationFailed {
        field: field.to_owned(),
        message: message.into(),
    }
}

/// The formats a formula may declare: the five types the language infers.
fn formula_format(format: PropertyFormat) -> bool {
    matches!(
        format,
        PropertyFormat::Text
            | PropertyFormat::Number
            | PropertyFormat::Checkbox
            | PropertyFormat::Date
            | PropertyFormat::Datetime
    )
}

/// Whether an aggregate and a declared result format are a legal pair,
/// independent of the target type.
fn aggregate_format(aggregate: Aggregate, format: PropertyFormat) -> bool {
    match aggregate {
        Aggregate::Count | Aggregate::Sum => format == PropertyFormat::Number,
        Aggregate::Min | Aggregate::Max => matches!(
            format,
            PropertyFormat::Number | PropertyFormat::Date | PropertyFormat::Datetime
        ),
        Aggregate::List => format == PropertyFormat::List,
    }
}

/// The format an aggregate produces, for an error message.
fn aggregate_format_name(aggregate: Aggregate) -> &'static str {
    match aggregate {
        Aggregate::Count | Aggregate::Sum => "a number",
        Aggregate::Min | Aggregate::Max => "a number, date or date and time",
        Aggregate::List => "a list",
    }
}

/// Checks one property's `compute` block on its own: the fields that belong to
/// the chosen kind, the expression's syntax, and aggregate/format pairs.
pub fn validate_definition(def: &PropertyDef) -> Vec<CoreError> {
    let Some(compute) = &def.compute else {
        if def.format == PropertyFormat::List {
            return vec![invalid(
                "format",
                "a list is calculated and cannot be stored",
            )];
        }
        return Vec::new();
    };
    let mut errors = Vec::new();
    match compute.kind {
        ComputeKind::Formula => {
            if compute.relation.is_some() {
                errors.push(invalid("compute.relation", "a formula takes no relation"));
            }
            if compute.property.is_some() {
                errors.push(invalid(
                    "compute.property",
                    "a formula takes no target property",
                ));
            }
            if compute.aggregate.is_some() {
                errors.push(invalid("compute.aggregate", "a formula takes no aggregate"));
            }
            match &compute.expression {
                None => errors.push(invalid(
                    "compute.expression",
                    "a formula requires an expression",
                )),
                Some(expression) => {
                    if let Err(error) = formula::parse(expression) {
                        errors.push(error);
                    }
                }
            }
            if !formula_format(def.format) {
                errors.push(invalid(
                    "format",
                    "a formula can produce text, a number, a checkbox, a date or a date and time",
                ));
            }
        }
        ComputeKind::Rollup => {
            if compute.expression.is_some() {
                errors.push(invalid(
                    "compute.expression",
                    "a rollup takes no expression",
                ));
            }
            if compute.relation.is_none() {
                errors.push(invalid("compute.relation", "a rollup requires a relation"));
            }
            match compute.aggregate {
                None => errors.push(invalid(
                    "compute.aggregate",
                    "a rollup requires an aggregate",
                )),
                Some(aggregate) => {
                    match aggregate {
                        Aggregate::Count => {
                            if compute.property.is_some() {
                                errors.push(invalid(
                                    "compute.property",
                                    "count takes no target property",
                                ));
                            }
                        }
                        Aggregate::Sum | Aggregate::Min | Aggregate::Max | Aggregate::List => {
                            if compute.property.is_none() {
                                errors.push(invalid(
                                    "compute.property",
                                    "this aggregate requires a target property",
                                ));
                            }
                        }
                    }
                    if !aggregate_format(aggregate, def.format) {
                        errors.push(invalid(
                            "format",
                            format!(
                                "a {} rollup produces {}",
                                aggregate_name(aggregate),
                                aggregate_format_name(aggregate)
                            ),
                        ));
                    }
                }
            }
        }
    }
    errors
}

fn aggregate_name(aggregate: Aggregate) -> &'static str {
    match aggregate {
        Aggregate::Count => "count",
        Aggregate::Sum => "sum",
        Aggregate::Min => "min",
        Aggregate::Max => "max",
        Aggregate::List => "list",
    }
}

/// The referenceable properties of one type: its stored single-value members
/// and, while scheduled, the generated schedule keys.
fn references_for_type(schema: &Schema, def: &TypeDef) -> BTreeMap<String, Reference> {
    let mut references = BTreeMap::new();
    for member in &def.properties {
        let Some(property) = schema.property(&member.key) else {
            continue;
        };
        if property.is_computed() {
            continue;
        }
        references.insert(member.key.clone(), Reference::of(property));
    }
    if def.schedule {
        for (key, property) in schema.schedule_properties {
            references.insert(key.clone(), Reference::of(property));
        }
    }
    references
}

fn value_type(format: PropertyFormat) -> Option<ValueType> {
    match format {
        PropertyFormat::Text
        | PropertyFormat::Select
        | PropertyFormat::Url
        | PropertyFormat::Email
        | PropertyFormat::File
        | PropertyFormat::Image => Some(ValueType::Text),
        PropertyFormat::Number => Some(ValueType::Number),
        PropertyFormat::Checkbox => Some(ValueType::Checkbox),
        PropertyFormat::Date => Some(ValueType::Date),
        PropertyFormat::Datetime => Some(ValueType::DateTime),
        PropertyFormat::MultiSelect
        | PropertyFormat::Relation
        | PropertyFormat::Recurrence
        | PropertyFormat::Attachments
        | PropertyFormat::List => None,
    }
}

fn format_name(format: PropertyFormat) -> &'static str {
    match format {
        PropertyFormat::Text => "text",
        PropertyFormat::Number => "a number",
        PropertyFormat::Checkbox => "a checkbox",
        PropertyFormat::Date => "a date",
        PropertyFormat::Datetime => "a date and time",
        PropertyFormat::Select => "a select",
        PropertyFormat::MultiSelect => "a multi-select",
        PropertyFormat::Url => "a URL",
        PropertyFormat::Email => "an email",
        PropertyFormat::Relation => "a relation",
        PropertyFormat::Recurrence => "a recurrence",
        PropertyFormat::File => "a file",
        PropertyFormat::Image => "an image",
        PropertyFormat::Attachments => "attachments",
        PropertyFormat::List => "a list",
    }
}

/// Checks one computed property against the type that carries it: every formula
/// reference must resolve to a stored single-value member (or `title`), the
/// inferred type must equal the declared format, and a rollup's relation, target
/// type and target property must all agree.
pub fn validate_for_type(schema: &Schema, def: &TypeDef, property: &PropertyDef) -> Vec<CoreError> {
    let Some(compute) = &property.compute else {
        return Vec::new();
    };
    match compute.kind {
        ComputeKind::Formula => validate_formula_for_type(schema, def, property, compute),
        ComputeKind::Rollup => validate_rollup_for_type(schema, def, compute, property),
    }
}

fn validate_formula_for_type(
    schema: &Schema,
    def: &TypeDef,
    property: &PropertyDef,
    compute: &ComputeDef,
) -> Vec<CoreError> {
    let Some(source) = &compute.expression else {
        return Vec::new();
    };
    let expr = match formula::parse(source) {
        Ok(expr) => expr,
        Err(error) => return vec![error],
    };
    let references = references_for_type(schema, def);
    let context = TypeContext::new(&references);
    let inferred = match formula::infer(&expr, &context) {
        Ok(inferred) => inferred,
        Err(error) => return vec![error],
    };
    match value_type(property.format) {
        Some(expected) if inferred != expected => vec![invalid(
            "format",
            format!(
                "the expression evaluates to {}, but the property is {}",
                inferred.name(),
                format_name(property.format)
            ),
        )],
        _ => Vec::new(),
    }
}

fn validate_rollup_for_type(
    schema: &Schema,
    def: &TypeDef,
    compute: &ComputeDef,
    property: &PropertyDef,
) -> Vec<CoreError> {
    let Some(relation_key) = &compute.relation else {
        return Vec::new();
    };
    let Some(relation) = schema.property(relation_key) else {
        return vec![invalid(
            "compute.relation",
            format!("unknown relation property `{relation_key}`"),
        )];
    };
    if !def.has_property(relation_key)
        || relation.format != PropertyFormat::Relation
        || relation.is_computed()
    {
        return vec![invalid(
            "compute.relation",
            format!(
                "`{relation_key}` is not a stored relation of type {}",
                def.key
            ),
        )];
    }
    let aggregate = compute.aggregate.unwrap_or(Aggregate::Count);
    if aggregate == Aggregate::Count || compute.property.is_none() {
        return Vec::new();
    }
    let property_key = compute.property.as_deref().expect("checked above");
    let target_type = relation.target_type.as_deref();
    if target_type.is_none() && aggregate != Aggregate::List {
        return vec![invalid(
            "compute.relation",
            format!(
                "a {} rollup needs a relation with a target type",
                aggregate_name(aggregate)
            ),
        )];
    }
    let Some(target_type) = target_type else {
        // A list over an untyped relation checks each resolved target's own
        // type at evaluation; there is no single format to compare against.
        return Vec::new();
    };
    let Some(target_def) = schema.type_def(target_type) else {
        return vec![invalid(
            "compute.relation",
            format!("target type `{target_type}` is not in this space"),
        )];
    };
    if property_key == TITLE_KEY {
        if aggregate != Aggregate::List {
            return vec![invalid(
                "compute.property",
                format!(
                    "a {} rollup needs a number, date or date-time property",
                    aggregate_name(aggregate)
                ),
            )];
        }
        return Vec::new();
    }
    if !target_def.has_property(property_key) {
        return vec![invalid(
            "compute.property",
            format!("`{property_key}` is not a property of type {target_type}"),
        )];
    }
    let Some(target_property) = schema.property(property_key) else {
        return vec![invalid(
            "compute.property",
            format!("unknown property `{property_key}`"),
        )];
    };
    if target_property.is_computed() {
        return vec![invalid(
            "compute.property",
            format!("`{property_key}` is calculated and cannot be rolled up"),
        )];
    }
    match aggregate {
        Aggregate::Sum => {
            if target_property.format != PropertyFormat::Number {
                return vec![invalid(
                    "compute.property",
                    format!(
                        "sum needs a number, but `{property_key}` is {}",
                        format_name(target_property.format)
                    ),
                )];
            }
        }
        Aggregate::Min | Aggregate::Max => {
            if !matches!(
                target_property.format,
                PropertyFormat::Number | PropertyFormat::Date | PropertyFormat::Datetime
            ) {
                return vec![invalid(
                    "compute.property",
                    format!(
                        "{} needs a number, date or date-time, but `{property_key}` is {}",
                        aggregate_name(aggregate),
                        format_name(target_property.format)
                    ),
                )];
            }
            if property.format != target_property.format {
                return vec![invalid(
                    "format",
                    format!(
                        "{} of a {} must produce {}, not {}",
                        aggregate_name(aggregate),
                        format_name(target_property.format),
                        format_name(target_property.format),
                        format_name(property.format)
                    ),
                )];
            }
        }
        Aggregate::List => {
            if matches!(
                target_property.format,
                PropertyFormat::MultiSelect
                    | PropertyFormat::Attachments
                    | PropertyFormat::Recurrence
                    | PropertyFormat::List
            ) {
                return vec![invalid(
                    "compute.property",
                    format!(
                        "list cannot read {}, because one target would not produce one label",
                        format_name(target_property.format)
                    ),
                )];
            }
        }
        Aggregate::Count => {}
    }
    Vec::new()
}

/// Every property key a computed definition references: a formula's operands
/// and a rollup's relation and target property. `title` is not a property key.
pub fn referenced_keys<'a>(
    properties: impl IntoIterator<Item = &'a PropertyDef>,
) -> BTreeSet<String> {
    let mut keys = BTreeSet::new();
    for property in properties {
        let Some(compute) = &property.compute else {
            continue;
        };
        if let Some(source) = &compute.expression
            && let Ok(expr) = formula::parse(source)
        {
            for key in formula::references(&expr) {
                if key != TITLE_KEY {
                    keys.insert(key.to_owned());
                }
            }
        }
        if let Some(relation) = &compute.relation {
            keys.insert(relation.clone());
        }
        if let Some(target) = &compute.property
            && target != TITLE_KEY
        {
            keys.insert(target.clone());
        }
    }
    keys
}

/// Whether one computed definition names `key`: a formula operand, a rollup's
/// relation or a rollup's target property. `title` is not a property key, so a
/// rollup reading `title` never holds anything.
pub fn references(def: &PropertyDef, key: &str) -> bool {
    if key == TITLE_KEY {
        return false;
    }
    referenced_keys(std::iter::once(def)).contains(key)
}

/// Rewrites every reference to `old` in one computed definition to `new`,
/// preserving the expression's other tokens. Returns whether anything changed;
/// a definition that is not computed, or does not name `old`, is left alone.
pub fn rename_reference(def: &mut PropertyDef, old: &str, new: &str) -> bool {
    if old == new {
        return false;
    }
    let Some(compute) = def.compute.as_mut() else {
        return false;
    };
    let mut changed = false;
    if let Some(expression) = &compute.expression
        && let Some(rewritten) = formula::rewrite(expression, old, new)
    {
        compute.expression = Some(rewritten);
        changed = true;
    }
    if compute.relation.as_deref() == Some(old) {
        compute.relation = Some(new.to_owned());
        changed = true;
    }
    if compute.property.as_deref() == Some(old) {
        compute.property = Some(new.to_owned());
        changed = true;
    }
    changed
}

/// Every rollup whose relation targets `target_type`.
pub fn rollup_targets<'a>(
    schema: &Schema,
    properties: impl IntoIterator<Item = &'a PropertyDef>,
    target_type: &str,
) -> Vec<&'a PropertyDef> {
    properties
        .into_iter()
        .filter(|property| {
            let Some(compute) = &property.compute else {
                return false;
            };
            if compute.kind != ComputeKind::Rollup {
                return false;
            }
            compute
                .relation
                .as_deref()
                .and_then(|relation| schema.property(relation))
                .and_then(|relation| relation.target_type.as_deref())
                .is_some_and(|target| target == target_type)
        })
        .collect()
}

/// One request's evaluator. It owns the space's zone and the request's single
/// `today`, and compiles every valid formula once when it is built.
pub struct Evaluator<'a> {
    index: &'a SpaceIndex,
    today: Date,
    timezone: TimeZone,
    formulas: BTreeMap<String, Option<Expr>>,
    formats: BTreeMap<String, BTreeMap<String, PropertyFormat>>,
}

impl<'a> Evaluator<'a> {
    pub fn new(index: &'a SpaceIndex, timezone: TimeZone, now: OffsetDateTime) -> Self {
        let today = schedule::today_in(&timezone, now);
        let mut formulas = BTreeMap::new();
        for property in index.properties() {
            let Some(compute) = &property.compute else {
                continue;
            };
            if compute.kind != ComputeKind::Formula {
                continue;
            }
            let compiled = compute
                .expression
                .as_deref()
                .and_then(|source| formula::parse(source).ok());
            formulas.insert(property.key.clone(), compiled);
        }
        let formats = index
            .types()
            .map(|def| (def.key.clone(), formats_for_type(index, def)))
            .collect();
        Self {
            index,
            today,
            timezone,
            formulas,
            formats,
        }
    }

    /// The request's calendar day in the space's zone.
    pub fn today(&self) -> Date {
        self.today
    }

    /// One computed value for one record, or `None` when it is empty, invalid
    /// or not computed at all.
    pub fn value(&self, doc: &ObjectDoc, def: &PropertyDef) -> Option<Value> {
        self.evaluate(&doc.type_key, &doc.title, &doc.properties, def)
    }

    /// Every non-empty computed member of one record's type.
    pub fn values(&self, doc: &ObjectDoc) -> BTreeMap<String, Value> {
        let Some(def) = self.index.type_def(&doc.type_key) else {
            return BTreeMap::new();
        };
        let mut values = BTreeMap::new();
        for member in &def.properties {
            let Some(property) = self.index.property_def(&member.key) else {
                continue;
            };
            if !property.is_computed() {
                continue;
            }
            if let Some(value) = self.value(doc, property)
                && !value::is_empty(&value)
            {
                values.insert(member.key.clone(), value);
            }
        }
        values
    }

    /// Rows of one type with only the named computed keys materialized.
    ///
    /// A stored value under a named computed key is always removed: the computed
    /// value wins, including when it is empty. Every other stored key is left
    /// exactly as the record holds it.
    pub fn summaries(&self, type_key: &str, needed: &BTreeSet<&str>) -> Vec<ObjectSummary> {
        let Some(def) = self.index.type_def(type_key) else {
            return Vec::new();
        };
        let computed: Vec<&PropertyDef> = needed
            .iter()
            .filter_map(|key| {
                let property = self.index.property_def(key)?;
                (property.is_computed() && def.has_property(key)).then_some(property)
            })
            .collect();
        self.index
            .summaries(type_key)
            .iter()
            .map(|row| {
                let mut row = row.clone();
                for property in &computed {
                    row.properties.remove(&property.key);
                    if let Some(value) =
                        self.evaluate(type_key, &row.title, &row.properties, property)
                        && !value::is_empty(&value)
                    {
                        row.properties.insert(property.key.clone(), value);
                    }
                }
                row
            })
            .collect()
    }

    fn evaluate(
        &self,
        type_key: &str,
        title: &str,
        properties: &BTreeMap<String, Value>,
        def: &PropertyDef,
    ) -> Option<Value> {
        let compute = def.compute.as_ref()?;
        match compute.kind {
            ComputeKind::Formula => {
                let expr = self.formulas.get(&def.key)?.as_ref()?;
                let formats = self.formats.get(type_key)?;
                formula::eval(
                    expr,
                    &EvalContext {
                        properties,
                        formats,
                        title,
                        today: self.today,
                        timezone: &self.timezone,
                    },
                )
            }
            ComputeKind::Rollup => self.rollup(properties, compute),
        }
    }

    fn rollup(&self, properties: &BTreeMap<String, Value>, compute: &ComputeDef) -> Option<Value> {
        let relation_key = compute.relation.as_deref()?;
        let relation = self.index.property_def(relation_key)?;
        if relation.format != PropertyFormat::Relation {
            return None;
        }
        let aggregate = compute.aggregate?;
        let Some(value) = properties.get(relation_key) else {
            return (aggregate == Aggregate::Count).then_some(Value::Number(0.0));
        };
        let targets = self.targets(value);
        if aggregate == Aggregate::Count {
            return Some(Value::Number(targets.len() as f64));
        }
        let property_key = compute.property.as_deref()?;
        let mut labels: Vec<String> = Vec::new();
        let mut seen_labels: BTreeSet<String> = BTreeSet::new();
        let mut numbers: Vec<f64> = Vec::new();
        let mut best: Option<Value> = None;
        for target in targets {
            if property_key == TITLE_KEY {
                if aggregate == Aggregate::List {
                    let label = target.title.clone();
                    if seen_labels.insert(label.clone()) {
                        labels.push(label);
                    }
                }
                continue;
            }
            let Some(target_def) = self.index.type_def(&target.type_key) else {
                continue;
            };
            if !target_def.has_property(property_key) {
                continue;
            }
            let Some(property) = self.index.property_def(property_key) else {
                continue;
            };
            if property.is_computed() {
                continue;
            }
            let Some(value) = target.properties.get(property_key) else {
                continue;
            };
            match aggregate {
                Aggregate::List => {
                    if let Some(label) = self.label(property, value)
                        && seen_labels.insert(label.clone())
                    {
                        labels.push(label);
                    }
                }
                Aggregate::Sum => {
                    if let Value::Number(number) = value {
                        numbers.push(*number);
                    }
                }
                Aggregate::Min | Aggregate::Max => {
                    let usable = match property.format {
                        PropertyFormat::Number => matches!(value, Value::Number(_)),
                        PropertyFormat::Date => {
                            matches!(value, Value::Text(text) if value::parse_date(text).is_some())
                        }
                        PropertyFormat::Datetime => {
                            matches!(value, Value::Text(text) if value::parse_datetime(text).is_some())
                        }
                        _ => false,
                    };
                    if !usable {
                        continue;
                    }
                    let replace = match &best {
                        None => true,
                        Some(current) => {
                            let ordering = value::compare(property.format, value, current);
                            if aggregate == Aggregate::Min {
                                ordering == std::cmp::Ordering::Less
                            } else {
                                ordering == std::cmp::Ordering::Greater
                            }
                        }
                    };
                    if replace {
                        best = Some(value.clone());
                    }
                }
                Aggregate::Count => {}
            }
        }
        match aggregate {
            Aggregate::List => (!labels.is_empty()).then_some(Value::List(labels)),
            Aggregate::Sum if !numbers.is_empty() => {
                let total: f64 = numbers.iter().sum();
                total.is_finite().then_some(Value::Number(total))
            }
            Aggregate::Min | Aggregate::Max => best,
            Aggregate::Count | Aggregate::Sum => None,
        }
    }

    /// Resolved relation targets, de-duplicated by id in relation order.
    /// Trashed records resolve; purged or malformed ids are skipped.
    fn targets(&self, value: &Value) -> Vec<&'a ObjectDoc> {
        let ids: Vec<&str> = match value {
            Value::Text(id) => vec![id.as_str()],
            Value::List(ids) => ids.iter().map(String::as_str).collect(),
            _ => Vec::new(),
        };
        let mut seen = BTreeSet::new();
        ids.into_iter()
            .filter_map(|id| Uuid::parse_str(id).ok())
            .filter(|id| seen.insert(*id))
            .filter_map(|id| self.index.object(id).or_else(|| self.index.trashed(id)))
            .collect()
    }

    /// The display label a list rollup emits for one target value.
    fn label(&self, property: &PropertyDef, value: &Value) -> Option<String> {
        match (property.format, value) {
            (
                PropertyFormat::Text
                | PropertyFormat::Date
                | PropertyFormat::Datetime
                | PropertyFormat::Url
                | PropertyFormat::Email,
                Value::Text(text),
            ) => Some(text.clone()),
            (PropertyFormat::Select, Value::Text(option)) => {
                Some(option_label(&property.options, option))
            }
            (PropertyFormat::File | PropertyFormat::Image, Value::Text(path)) => {
                Some(attachment_label(path))
            }
            (PropertyFormat::Number, Value::Number(number)) => Some(value::number_label(*number)),
            (PropertyFormat::Checkbox, Value::Bool(flag)) => Some(flag.to_string()),
            (PropertyFormat::Relation, value) => self.relation_label(value),
            _ => None,
        }
    }

    fn relation_label(&self, value: &Value) -> Option<String> {
        let ids: Vec<&str> = match value {
            Value::Text(id) => vec![id.as_str()],
            Value::List(ids) => ids.iter().map(String::as_str).collect(),
            _ => return None,
        };
        let labels: Vec<String> = ids
            .into_iter()
            .map(|id| {
                match Uuid::parse_str(id)
                    .ok()
                    .and_then(|id| self.index.object(id).or_else(|| self.index.trashed(id)))
                {
                    Some(target) => target.title.clone(),
                    None => id.to_owned(),
                }
            })
            .collect();
        (!labels.is_empty()).then(|| labels.join(", "))
    }
}

fn formats_for_type(index: &SpaceIndex, def: &TypeDef) -> BTreeMap<String, PropertyFormat> {
    let mut formats = BTreeMap::new();
    for member in &def.properties {
        let Some(property) = index.property_def(&member.key) else {
            continue;
        };
        if property.is_computed() {
            continue;
        }
        formats.insert(member.key.clone(), property.format);
    }
    if def.schedule {
        for (key, property) in schedule::schedule_property_defs() {
            formats.insert(key, property.format);
        }
    }
    formats
}

fn option_label(options: &[OptionDef], option: &str) -> String {
    options
        .iter()
        .find(|known| known.key == option)
        .map_or_else(|| option.to_owned(), |known| known.name.clone())
}

fn attachment_label(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use tempfile::TempDir;

    use super::*;
    use crate::model::{Member, OptionDef, Role, SpaceMeta, TypeProperty, initial_view};
    use crate::store::SpaceStore;
    use crate::store::fs::FsSpaceStore;

    fn at() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_760_000_000).expect("valid timestamp")
    }

    fn now() -> OffsetDateTime {
        OffsetDateTime::parse(
            "2026-11-10T12:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("a request clock")
    }

    fn zone() -> TimeZone {
        TimeZone::get("UTC").expect("a time zone")
    }

    struct Fixture {
        dir: TempDir,
        store: FsSpaceStore,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = TempDir::new().expect("a temporary space");
            let meta = SpaceMeta {
                id: Uuid::from_u128(1),
                name: "Garden".to_owned(),
                icon: None,
                accent: None,
                timezone: "UTC".to_owned(),
                created_at: at(),
                members: vec![Member {
                    user: Uuid::from_u128(2),
                    role: Role::Owner,
                }],
            };
            let store = FsSpaceStore::create(dir.path(), &meta).expect("create space");
            Self { dir, store }
        }

        fn save_property(&self, def: &PropertyDef) {
            self.store.save_property(def, None).expect("save property");
        }

        fn save_type(&self, def: &TypeDef) {
            self.store.save_type(def, None).expect("save type");
        }

        fn save_object(&self, path: &str, doc: &ObjectDoc) {
            self.store
                .save_object(std::path::Path::new(path), doc, None)
                .expect("save object");
        }

        fn index(&self) -> SpaceIndex {
            SpaceIndex::rebuild_from_disk(&self.store).expect("rebuild")
        }

        fn path(&self, relative: &str) -> std::path::PathBuf {
            self.dir.path().join(relative)
        }
    }

    fn property(key: &str, format: PropertyFormat) -> PropertyDef {
        PropertyDef {
            key: key.to_owned(),
            name: key.to_owned(),
            format,
            options: Vec::new(),
            target_type: None,
            multi: false,
            compute: None,
            display: None,
        }
    }

    fn formula(key: &str, format: PropertyFormat, expression: &str) -> PropertyDef {
        let mut def = property(key, format);
        def.compute = Some(ComputeDef {
            kind: ComputeKind::Formula,
            expression: Some(expression.to_owned()),
            relation: None,
            property: None,
            aggregate: None,
        });
        def
    }

    fn rollup(
        key: &str,
        format: PropertyFormat,
        relation: &str,
        property_key: Option<&str>,
        aggregate: Aggregate,
    ) -> PropertyDef {
        let mut def = property(key, format);
        def.compute = Some(ComputeDef {
            kind: ComputeKind::Rollup,
            expression: None,
            relation: Some(relation.to_owned()),
            property: property_key.map(str::to_owned),
            aggregate: Some(aggregate),
        });
        def
    }

    fn member(key: &str) -> TypeProperty {
        TypeProperty {
            key: key.to_owned(),
            required: false,
            featured: false,
        }
    }

    fn type_def(key: &str, properties: &[PropertyDef]) -> TypeDef {
        TypeDef {
            key: key.to_owned(),
            name: key.to_owned(),
            name_plural: key.to_owned(),
            icon: None,
            description: String::new(),
            schedule: false,
            schedule_labels: Default::default(),
            properties: properties.iter().map(|def| member(&def.key)).collect(),
            views: vec![initial_view()],
            default_view: "all".to_owned(),
        }
    }

    fn doc(id: u128, type_key: &str, title: &str, properties: &[(&str, Value)]) -> ObjectDoc {
        ObjectDoc {
            id: Uuid::from_u128(id),
            type_key: type_key.to_owned(),
            title: title.to_owned(),
            icon: None,
            cover: None,
            cover_position: None,
            rev: 1,
            created_at: at(),
            updated_at: at(),
            created_by: Uuid::from_u128(2),
            updated_by: Uuid::from_u128(2),
            trashed_at: None,
            trashed_from: None,
            properties: properties
                .iter()
                .map(|(key, value)| ((*key).to_owned(), value.clone()))
                .collect(),
            body: String::new(),
        }
    }

    fn uuid(n: u128) -> Value {
        Value::Text(Uuid::from_u128(n).to_string())
    }

    fn file(name: &str) -> Value {
        Value::Text(format!("files/{}/{name}", "a".repeat(64)))
    }

    /// A self-relating plant type with every aggregate and a stored/typed mix.
    struct World {
        fixture: Fixture,
        ids: BTreeMap<&'static str, Uuid>,
    }

    impl World {
        fn build() -> Self {
            let fixture = Fixture::new();
            let mut status = property("status", PropertyFormat::Select);
            status.options = vec![
                OptionDef {
                    key: "todo".to_owned(),
                    name: "To do".to_owned(),
                    color: "amber".to_owned(),
                },
                OptionDef {
                    key: "done".to_owned(),
                    name: "Done".to_owned(),
                    color: "green".to_owned(),
                },
            ];
            let mut links = property("links", PropertyFormat::Relation);
            links.target_type = Some("plant".to_owned());
            links.multi = true;
            let mut single = property("single", PropertyFormat::Relation);
            single.target_type = Some("plant".to_owned());
            let mut loose = property("loose", PropertyFormat::Relation);
            loose.target_type = None;
            loose.multi = true;

            let base = [
                property("room", PropertyFormat::Text),
                links.clone(),
                single,
                loose,
                property("height", PropertyFormat::Number),
                property("born", PropertyFormat::Date),
                status,
                property("guide", PropertyFormat::File),
            ];
            let computed = [
                rollup(
                    "link_count",
                    PropertyFormat::Number,
                    "links",
                    None,
                    Aggregate::Count,
                ),
                rollup(
                    "height_total",
                    PropertyFormat::Number,
                    "links",
                    Some("height"),
                    Aggregate::Sum,
                ),
                rollup(
                    "height_min",
                    PropertyFormat::Number,
                    "links",
                    Some("height"),
                    Aggregate::Min,
                ),
                rollup(
                    "born_latest",
                    PropertyFormat::Date,
                    "links",
                    Some("born"),
                    Aggregate::Max,
                ),
                rollup(
                    "linked_titles",
                    PropertyFormat::List,
                    "links",
                    Some(TITLE_KEY),
                    Aggregate::List,
                ),
                rollup(
                    "linked_status",
                    PropertyFormat::List,
                    "links",
                    Some("status"),
                    Aggregate::List,
                ),
                rollup(
                    "linked_guides",
                    PropertyFormat::List,
                    "links",
                    Some("guide"),
                    Aggregate::List,
                ),
                rollup(
                    "single_count",
                    PropertyFormat::Number,
                    "single",
                    None,
                    Aggregate::Count,
                ),
                rollup(
                    "loose_titles",
                    PropertyFormat::List,
                    "loose",
                    Some(TITLE_KEY),
                    Aggregate::List,
                ),
                rollup(
                    "loose_status",
                    PropertyFormat::List,
                    "loose",
                    Some("status"),
                    Aggregate::List,
                ),
                formula("label", PropertyFormat::Text, r#"title + " / " + room"#),
            ];
            let properties: Vec<PropertyDef> =
                base.iter().chain(computed.iter()).cloned().collect();
            let plant = type_def("plant", &properties);
            let tree = type_def("tree", &[]);
            for def in &properties {
                fixture.save_property(def);
            }
            fixture.save_type(&plant);
            fixture.save_type(&tree);

            let root = doc(
                10,
                "plant",
                "Root",
                &[
                    ("room", Value::Text("Kitchen".to_owned())),
                    (
                        "links",
                        Value::List(vec![
                            Uuid::from_u128(20).to_string(),
                            Uuid::from_u128(21).to_string(),
                            Uuid::from_u128(20).to_string(),
                            Uuid::from_u128(22).to_string(),
                            Uuid::from_u128(99).to_string(),
                        ]),
                    ),
                    ("single", uuid(21)),
                    (
                        "loose",
                        Value::List(vec![
                            Uuid::from_u128(20).to_string(),
                            Uuid::from_u128(30).to_string(),
                        ]),
                    ),
                ],
            );
            let second = doc(
                20,
                "plant",
                "Monstera",
                &[
                    ("room", Value::Text("Hall".to_owned())),
                    ("height", Value::Number(5.0)),
                    ("born", Value::Text("2026-01-01".to_owned())),
                    ("status", Value::Text("todo".to_owned())),
                    ("guide", file("guide.pdf")),
                ],
            );
            let third = doc(
                21,
                "plant",
                "Fern",
                &[
                    ("room", Value::Text("Bath".to_owned())),
                    ("height", Value::Number(2.5)),
                    ("born", Value::Text("2026-05-01".to_owned())),
                    ("status", Value::Text("done".to_owned())),
                ],
            );
            let mut trashed = doc(
                22,
                "plant",
                "Old fern",
                &[
                    ("room", Value::Text("Attic".to_owned())),
                    ("height", Value::Number(10.0)),
                    ("born", Value::Text("2024-01-01".to_owned())),
                    ("status", Value::Text("todo".to_owned())),
                ],
            );
            trashed.trashed_at = Some(at());
            trashed.trashed_from = Some("objects/plant/old-fern.md".to_owned());
            let tree_doc = doc(30, "tree", "Oak", &[]);
            let empty = doc(23, "plant", "Empty", &[]);

            fixture.save_object("objects/plant/root.md", &root);
            fixture.save_object("objects/plant/monstera.md", &second);
            fixture.save_object("objects/plant/fern.md", &third);
            fixture.save_object("trash/22.md", &trashed);
            fixture.save_object("objects/tree/oak.md", &tree_doc);
            fixture.save_object("objects/plant/empty.md", &empty);

            Self {
                fixture,
                ids: BTreeMap::from([
                    ("root", Uuid::from_u128(10)),
                    ("monstera", Uuid::from_u128(20)),
                    ("fern", Uuid::from_u128(21)),
                    ("trashed", Uuid::from_u128(22)),
                    ("empty", Uuid::from_u128(23)),
                ]),
            }
        }

        fn index(&self) -> SpaceIndex {
            self.fixture.index()
        }
    }

    fn field(error: &CoreError) -> &str {
        match error {
            CoreError::ValidationFailed { field, .. } => field,
            _ => "",
        }
    }

    fn value_of(index: &SpaceIndex, id: Uuid, key: &str) -> Option<Value> {
        let evaluator = Evaluator::new(index, zone(), now());
        evaluator.value(
            index.object(id).expect("object"),
            index.property_def(key).expect("property"),
        )
    }

    #[test]
    fn rollups_aggregate_resolved_targets_in_relation_order() {
        let world = World::build();
        let index = world.index();
        let root = world.ids["root"];
        for (key, expected) in [
            ("link_count", Value::Number(3.0)),
            ("height_total", Value::Number(17.5)),
            ("height_min", Value::Number(2.5)),
            ("born_latest", Value::Text("2026-05-01".to_owned())),
            (
                "linked_titles",
                Value::List(vec![
                    "Monstera".to_owned(),
                    "Fern".to_owned(),
                    "Old fern".to_owned(),
                ]),
            ),
            (
                "linked_status",
                Value::List(vec!["To do".to_owned(), "Done".to_owned()]),
            ),
            ("linked_guides", Value::List(vec!["guide.pdf".to_owned()])),
            ("single_count", Value::Number(1.0)),
            (
                "loose_titles",
                Value::List(vec!["Monstera".to_owned(), "Oak".to_owned()]),
            ),
            ("loose_status", Value::List(vec!["To do".to_owned()])),
            ("label", Value::Text("Root / Kitchen".to_owned())),
        ] {
            assert_eq!(value_of(&index, root, key), Some(expected), "{key}");
        }
        assert_eq!(
            value_of(&index, world.ids["empty"], "link_count"),
            Some(Value::Number(0.0)),
            "count of no targets is zero"
        );
        for key in ["height_total", "height_min", "linked_titles"] {
            assert_eq!(
                value_of(&index, world.ids["empty"], key),
                None,
                "{key} of no targets is empty"
            );
        }
        assert!(world.fixture.path("objects/plant/root.md").exists());
        assert_eq!(index.problems().computed_problems, Vec::new());

        let evaluator = Evaluator::new(&index, zone(), now());
        let values = evaluator.values(index.object(root).expect("root"));
        assert_eq!(values.get("link_count"), Some(&Value::Number(3.0)));
        assert_eq!(
            values.get("label"),
            Some(&Value::Text("Root / Kitchen".to_owned()))
        );
        let empty = evaluator.values(index.object(world.ids["empty"]).expect("empty"));
        assert_eq!(
            empty.get("link_count"),
            Some(&Value::Number(0.0)),
            "a zero count is a present value"
        );
        assert!(!empty.contains_key("linked_titles"));
    }

    #[test]
    fn a_formula_reads_schedule_keys_and_today() {
        let fixture = Fixture::new();
        let age = formula("age", PropertyFormat::Number, "days(due_date, today())");
        let mut chore = type_def("chore", std::slice::from_ref(&age));
        chore.schedule = true;
        fixture.save_property(&age);
        fixture.save_type(&chore);
        let due = doc(
            40,
            "chore",
            "Water",
            &[("due_date", Value::Text("2026-11-08".to_owned()))],
        );
        fixture.save_object("objects/chore/water.md", &due);
        let index = fixture.index();
        assert_eq!(
            value_of(&index, Uuid::from_u128(40), "age"),
            Some(Value::Number(2.0))
        );
    }

    #[test]
    fn summaries_evaluate_only_the_named_keys_and_drop_their_stored_values() {
        let fixture = Fixture::new();
        let links = {
            let mut def = property("links", PropertyFormat::Relation);
            def.target_type = Some("plant".to_owned());
            def.multi = true;
            def
        };
        let count = rollup(
            "link_count",
            PropertyFormat::Number,
            "links",
            None,
            Aggregate::Count,
        );
        let titles = rollup(
            "linked_titles",
            PropertyFormat::List,
            "links",
            Some(TITLE_KEY),
            Aggregate::List,
        );
        let plant = type_def("plant", &[links.clone(), count.clone(), titles.clone()]);
        for def in [&links, &count, &titles] {
            fixture.save_property(def);
        }
        fixture.save_type(&plant);
        let root = doc(
            10,
            "plant",
            "Root",
            &[
                ("links", uuid(20)),
                ("link_count", Value::Number(99.0)),
                ("linked_titles", Value::List(vec!["bogus".to_owned()])),
            ],
        );
        let target = doc(20, "plant", "Monstera", &[]);
        fixture.save_object("objects/plant/root.md", &root);
        fixture.save_object("objects/plant/monstera.md", &target);
        let index = fixture.index();
        let evaluator = Evaluator::new(&index, zone(), now());

        let rows = evaluator.summaries("plant", &BTreeSet::from(["link_count"]));
        let row = rows
            .iter()
            .find(|row| row.id == Uuid::from_u128(10))
            .expect("root row");
        assert_eq!(row.properties.get("link_count"), Some(&Value::Number(1.0)));
        assert_eq!(
            row.properties.get("linked_titles"),
            Some(&Value::List(vec!["bogus".to_owned()])),
            "a computed key that was not requested is left alone"
        );

        let rows = evaluator.summaries("plant", &BTreeSet::from(["linked_titles"]));
        let row = rows
            .iter()
            .find(|row| row.id == Uuid::from_u128(10))
            .expect("root row");
        assert_eq!(
            row.properties.get("linked_titles"),
            Some(&Value::List(vec!["Monstera".to_owned()]))
        );

        // An empty computed value removes the stored key rather than reviving it.
        let rows = evaluator.summaries("plant", &BTreeSet::from(["linked_titles"]));
        let empty = rows
            .iter()
            .find(|row| row.id == Uuid::from_u128(20))
            .expect("target row");
        assert!(!empty.properties.contains_key("linked_titles"));
    }

    #[test]
    fn problems_report_a_bad_definition_without_taking_the_space_offline() {
        let fixture = Fixture::new();
        let room = property("room", PropertyFormat::Text);
        let broken = formula("broken", PropertyFormat::Number, "missing + 1");
        let bad = rollup(
            "bad",
            PropertyFormat::Number,
            "room",
            None,
            Aggregate::Count,
        );
        let plant = type_def("plant", &[room.clone(), broken.clone(), bad.clone()]);
        for def in [&room, &broken, &bad] {
            fixture.save_property(def);
        }
        fixture.save_type(&plant);
        fixture.save_object("objects/plant/root.md", &doc(10, "plant", "Root", &[]));
        let index = fixture.index();
        assert_eq!(index.summaries("plant").len(), 1, "the space still opens");
        let problems = index.problems().computed_problems;
        assert!(
            problems
                .iter()
                .any(|problem| problem.property_key == "broken"
                    && problem.type_key == "plant"
                    && problem.message.contains("unknown property `missing`")),
            "{problems:?}"
        );
        assert!(
            problems.iter().any(|problem| problem.property_key == "bad"
                && problem.field == "compute.relation"),
            "{problems:?}"
        );
    }

    #[test]
    fn definitions_are_checked_before_any_type() {
        let stored_list = property("titles", PropertyFormat::List);
        assert_eq!(
            validate_definition(&stored_list)
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec!["invalid format: a list is calculated and cannot be stored"]
        );

        let mut with_relation = formula("x", PropertyFormat::Number, "1");
        with_relation.compute.as_mut().unwrap().relation = Some("room".to_owned());
        assert!(
            validate_definition(&with_relation)
                .iter()
                .any(|error| error.to_string().contains("formula takes no relation"))
        );

        let bad_result = formula("x", PropertyFormat::Select, "1");
        assert!(
            validate_definition(&bad_result)
                .iter()
                .any(|error| error.to_string().contains("formula can produce"))
        );

        let syntax = formula("x", PropertyFormat::Number, "1 +");
        assert!(
            validate_definition(&syntax)
                .iter()
                .any(|error| error.to_string().contains("at character"))
        );

        let mut count_with_property = rollup(
            "x",
            PropertyFormat::Number,
            "links",
            Some("height"),
            Aggregate::Count,
        );
        count_with_property.compute.as_mut().unwrap().aggregate = Some(Aggregate::Count);
        assert!(
            validate_definition(&count_with_property)
                .iter()
                .any(|error| error.to_string().contains("count takes no target property"))
        );

        let no_aggregate = {
            let mut def = rollup("x", PropertyFormat::Number, "links", None, Aggregate::Count);
            def.compute.as_mut().unwrap().aggregate = None;
            def
        };
        assert!(
            validate_definition(&no_aggregate)
                .iter()
                .any(|error| error.to_string().contains("requires an aggregate"))
        );

        let wrong_min = rollup(
            "x",
            PropertyFormat::Text,
            "links",
            Some("born"),
            Aggregate::Min,
        );
        assert!(
            validate_definition(&wrong_min)
                .iter()
                .any(|error| error.to_string().contains("a min rollup produces"))
        );

        assert!(
            validate_definition(&rollup(
                "x",
                PropertyFormat::List,
                "links",
                Some(TITLE_KEY),
                Aggregate::List
            ))
            .is_empty()
        );
    }

    #[test]
    fn a_formula_must_resolve_to_stored_single_values() {
        let fixture = Fixture::new();
        let room = property("room", PropertyFormat::Text);
        let mut tags = property("tags", PropertyFormat::MultiSelect);
        tags.options = vec![OptionDef {
            key: "a".to_owned(),
            name: "A".to_owned(),
            color: "grey".to_owned(),
        }];
        let unknown = formula("bad_unknown", PropertyFormat::Number, "missing + 1");
        let list_ref = formula("bad_list", PropertyFormat::Number, "tags = 1");
        let wrong = formula("bad_wrong", PropertyFormat::Text, "1 + 1");
        let plant = type_def(
            "plant",
            &[
                room.clone(),
                tags.clone(),
                unknown.clone(),
                list_ref.clone(),
                wrong.clone(),
            ],
        );
        for def in [&room, &tags, &unknown, &list_ref, &wrong] {
            fixture.save_property(def);
        }
        fixture.save_type(&plant);
        let index = fixture.index();
        let schema = index.schema();
        let def = index.type_def("plant").expect("plant");

        assert!(
            validate_for_type(
                &schema,
                def,
                index.property_def("bad_unknown").expect("property")
            )
            .iter()
            .any(|error| error.to_string().contains("unknown property `missing`"))
        );
        assert!(
            validate_for_type(
                &schema,
                def,
                index.property_def("bad_list").expect("property")
            )
            .iter()
            .any(|error| error.to_string().contains("multi-value"))
        );
        assert!(
            validate_for_type(
                &schema,
                def,
                index.property_def("bad_wrong").expect("property")
            )
            .iter()
            .any(|error| field(error) == "format")
        );
    }

    #[test]
    fn a_rollup_must_name_its_relation_target_and_result_types() {
        let fixture = Fixture::new();
        let room = property("room", PropertyFormat::Text);
        let mut links = property("links", PropertyFormat::Relation);
        links.target_type = Some("plant".to_owned());
        links.multi = true;
        let mut untyped = property("loose", PropertyFormat::Relation);
        untyped.multi = true;
        let height = property("height", PropertyFormat::Number);
        let status = property("status", PropertyFormat::Text);
        let plant = type_def(
            "plant",
            &[
                room.clone(),
                links.clone(),
                untyped.clone(),
                height.clone(),
                status.clone(),
            ],
        );
        for def in [&room, &links, &height, &status] {
            fixture.save_property(def);
        }
        fixture.save_property(&untyped);
        fixture.save_type(&plant);
        let index = fixture.index();
        let schema = index.schema();
        let def = index.type_def("plant").expect("plant");

        let not_relation = rollup(
            "bad",
            PropertyFormat::Number,
            "room",
            None,
            Aggregate::Count,
        );
        assert!(
            validate_for_type(&schema, def, &not_relation)
                .iter()
                .any(|error| error.to_string().contains("is not a stored relation"))
        );

        let missing = rollup(
            "bad",
            PropertyFormat::Number,
            "links",
            Some("ghost"),
            Aggregate::Sum,
        );
        assert!(
            validate_for_type(&schema, def, &missing)
                .iter()
                .any(|error| error.to_string().contains("not a property of type"))
        );

        let wrong_sum = rollup(
            "bad",
            PropertyFormat::Number,
            "links",
            Some("status"),
            Aggregate::Sum,
        );
        assert!(
            validate_for_type(&schema, def, &wrong_sum)
                .iter()
                .any(|error| error.to_string().contains("sum needs a number"))
        );

        let untyped_sum = rollup(
            "bad",
            PropertyFormat::Number,
            "loose",
            Some("height"),
            Aggregate::Sum,
        );
        assert!(
            validate_for_type(&schema, def, &untyped_sum)
                .iter()
                .any(|error| error.to_string().contains("target type"))
        );

        let min_wrong_result = rollup(
            "bad",
            PropertyFormat::Date,
            "links",
            Some("height"),
            Aggregate::Min,
        );
        assert!(
            validate_for_type(&schema, def, &min_wrong_result)
                .iter()
                .any(|error| field(error) == "format")
        );

        let fine = rollup(
            "fine",
            PropertyFormat::Number,
            "links",
            Some("height"),
            Aggregate::Sum,
        );
        assert!(validate_for_type(&schema, def, &fine).is_empty());
    }

    #[test]
    fn rollup_targets_and_referenced_keys_are_scannable() {
        let mut links = property("links", PropertyFormat::Relation);
        links.target_type = Some("plant".to_owned());
        let label = formula("label", PropertyFormat::Text, "title + room");
        let count = rollup(
            "count",
            PropertyFormat::Number,
            "links",
            None,
            Aggregate::Count,
        );
        let mut property_map = BTreeMap::new();
        let mut type_map = BTreeMap::new();
        let mut plant = type_def("plant", &[links.clone(), label.clone(), count.clone()]);
        plant.properties = vec![member("links"), member("label"), member("count")];
        for def in [links.clone(), label, count] {
            property_map.insert(def.key.clone(), def);
        }
        type_map.insert(plant.key.clone(), plant);
        let empty_schedule = BTreeMap::new();
        let empty_objects = BTreeMap::new();
        let empty_trash = BTreeMap::new();
        let schema = Schema {
            types: &type_map,
            properties: &property_map,
            schedule_properties: &empty_schedule,
            objects: &empty_objects,
            trash: &empty_trash,
        };
        let target = rollup_targets(&schema, schema.properties.values(), "plant");
        assert_eq!(target.len(), 1);
        assert_eq!(target[0].key, "count");
        let keys = referenced_keys(schema.properties.values());
        assert!(keys.contains("room"));
        assert!(keys.contains("links"));
        assert!(!keys.contains(TITLE_KEY));
    }
}
