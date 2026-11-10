//! Turning a text, select or multi-select column into a relation.
//!
//! The migration is planned before anything is written: [`plan`] reads the live
//! and trashed records, derives one target record per distinct value, and names
//! every view and filter the change would touch. [`targets`] then yields the
//! target type and the records still missing, so a retry reuses what already
//! exists instead of minting a second type or a duplicate record.
//!
//! Nothing here touches the filesystem. The server writes the type and records
//! the plan describes; the later stages that create the temporary relation and
//! finish the rename extend this module.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::CoreError;
use crate::index::SpaceIndex;
use crate::model::{
    CondOp, Condition, ObjectDoc, PropertyDef, PropertyFormat, TypeDef, TypeProperty, Value,
    initial_view, is_reserved_key,
};
use crate::schedule::is_schedule_key;
use crate::slug::{MAX_KEY_LEN, key_from_name};
use crate::validate::MAX_TITLE_LEN;
use crate::value;

/// The most distinct values one promotion may create.
pub const MAX_PROMOTE_VALUES: usize = 500;
/// The most source records one promotion may read.
pub const MAX_PROMOTE_RECORDS: usize = 5000;

/// What the caller asked the new relation and its type to be.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PromoteOptions {
    pub target_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_name_plural: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_icon: Option<String>,
    pub relation_name: String,
    /// Whether the relation holds several targets per record.
    pub multi: bool,
    /// A text delimiter that turns one cell into several values; text only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split: Option<String>,
}

/// The column being promoted, as the preview reads it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PromoteSource {
    /// The type that carries the column.
    pub type_key: String,
    pub key: String,
    pub name: String,
    pub format: PropertyFormat,
    /// The text delimiter the links stage applies, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split: Option<String>,
    /// Live and trashed records of the owning type.
    pub records: usize,
    pub distinct: usize,
    pub empty: usize,
}

/// One distinct value and how many source records hold it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PromoteValue {
    pub title: String,
    pub records: usize,
    /// A live target record with this title already exists.
    pub exists: bool,
}

/// The type the relation points at.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PromoteTarget {
    pub key: String,
    pub name: String,
    pub name_plural: String,
    pub icon: Option<String>,
    /// The type does not exist yet and the run will create it.
    pub create: bool,
    pub values: Vec<PromoteValue>,
    /// Target records the run still has to create.
    pub create_records: usize,
}

/// The temporary relation the links stage writes.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PromoteRelation {
    pub key: String,
    pub name: String,
    pub multi: bool,
}

/// One view whose column, sort or filter the promotion rewrites.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PromoteView {
    pub key: String,
    pub name: String,
    pub columns: bool,
    pub sorts: usize,
    pub filters_moved: usize,
    pub filters_dropped: usize,
}

/// Everything the preview shows before the first write.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PromotePlan {
    pub source: PromoteSource,
    pub target: PromoteTarget,
    pub relation: PromoteRelation,
    /// Relation values the links stage writes, one per record-value pair.
    pub links: usize,
    pub views: Vec<PromoteView>,
    pub warnings: Vec<String>,
    /// Non-empty means the run must not start.
    pub blocking: Vec<String>,
}

/// One row of the type-definition and record list [`targets`] yields.
#[derive(Debug, Clone, PartialEq)]
pub struct PromoteRecord {
    pub id: Uuid,
    pub title: String,
    /// The row is already in the target type; the server leaves it alone.
    pub exists: bool,
}

/// What a `targets` run must write, after reusing everything that exists.
#[derive(Debug, Clone, PartialEq)]
pub struct PromoteTargets {
    pub type_def: TypeDef,
    pub create_type: bool,
    pub records: Vec<PromoteRecord>,
}

/// The relation key the links stage writes before the finish stage renames it
/// back. The `_ref` suffix survives the 40-character key limit.
pub fn temporary_key(source: &str) -> String {
    const SUFFIX: &str = "_ref";
    let keep = MAX_KEY_LEN - SUFFIX.len();
    let mut base = source;
    if base.len() > keep {
        base = &base[..keep];
    }
    let base = base.trim_end_matches('_');
    if base.is_empty() {
        format!("value{SUFFIX}")
    } else {
        format!("{base}{SUFFIX}")
    }
}

/// The spelling a title is deduplicated under: trimmed, whitespace collapsed
/// and case-folded. The first spelling of a title is the one kept.
fn fold_title(title: &str) -> String {
    title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// One value as a title, or `None` for a missing or empty one.
fn display_value(property: &PropertyDef, value: &Value) -> Option<String> {
    match property.format {
        PropertyFormat::Text => match value {
            Value::Text(text) => {
                let text = text.trim();
                (!text.is_empty()).then(|| text.to_owned())
            }
            _ => None,
        },
        PropertyFormat::Select => match value {
            Value::Text(key) => {
                let key = key.trim();
                if key.is_empty() {
                    return None;
                }
                Some(
                    property
                        .options
                        .iter()
                        .find(|option| option.key == key)
                        .map(|option| option.name.trim().to_owned())
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| key.to_owned()),
                )
            }
            _ => None,
        },
        PropertyFormat::MultiSelect => match value {
            Value::List(keys) => {
                let names: Vec<String> = keys
                    .iter()
                    .filter_map(|key| {
                        let key = key.trim();
                        if key.is_empty() {
                            return None;
                        }
                        Some(
                            property
                                .options
                                .iter()
                                .find(|option| option.key == key)
                                .map(|option| option.name.trim().to_owned())
                                .filter(|name| !name.is_empty())
                                .unwrap_or_else(|| key.to_owned()),
                        )
                    })
                    .collect();
                (!names.is_empty()).then(|| names.join("\u{0}"))
            }
            _ => None,
        },
        _ => None,
    }
}

/// The titles one record contributes, deduplicated within the record.
fn record_titles(
    property: &PropertyDef,
    value: &Value,
    split: Option<&str>,
    warnings: &mut BTreeSet<String>,
) -> Vec<String> {
    let raw = match display_value(property, value) {
        Some(raw) => raw,
        None => return Vec::new(),
    };
    let parts: Vec<String> = if property.format == PropertyFormat::Text {
        match split {
            Some(delimiter) => raw
                .split(delimiter)
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(str::to_owned)
                .collect(),
            None => vec![raw],
        }
    } else if property.format == PropertyFormat::MultiSelect {
        raw.split('\u{0}').map(str::to_owned).collect()
    } else {
        vec![raw]
    };

    // A select value whose key has no option uses its key; say so once.
    if matches!(
        property.format,
        PropertyFormat::Select | PropertyFormat::MultiSelect
    ) {
        let keys: Vec<&str> = match value {
            Value::Text(key) => vec![key.trim()],
            Value::List(keys) => keys.iter().map(|key| key.trim()).collect(),
            _ => Vec::new(),
        };
        for key in keys {
            let known = property
                .options
                .iter()
                .any(|option| option.key == key && !option.name.trim().is_empty());
            if !key.is_empty() && !known {
                warnings.insert(format!(
                    "option {key} has no display name; its key becomes the title"
                ));
            }
        }
    }

    let mut seen = BTreeSet::new();
    let mut titles = Vec::new();
    for part in parts {
        let folded = fold_title(&part);
        if !folded.is_empty() && seen.insert(folded) {
            titles.push(part);
        }
    }
    titles
}

/// The plan for turning `source_key` on `type_key` into a relation.
///
/// `target_type` names a target type that already exists; the server passes it
/// on a retry so the plan reports what remains instead of refusing the key.
pub fn plan(
    index: &SpaceIndex,
    type_key: &str,
    source_key: &str,
    options: &PromoteOptions,
    target_type: Option<&str>,
) -> PromotePlan {
    let mut blocking: Vec<String> = Vec::new();
    let mut warnings: BTreeSet<String> = BTreeSet::new();

    let declared = index
        .properties()
        .find(|property| property.key == source_key)
        .cloned();
    let owner = index.type_def(type_key);
    if owner.is_none() {
        blocking.push(format!("type {type_key} does not exist"));
    }
    let source_property = declared.clone().unwrap_or_else(|| PropertyDef {
        key: source_key.to_owned(),
        name: source_key.to_owned(),
        format: PropertyFormat::Text,
        options: Vec::new(),
        target_type: None,
        multi: false,
        compute: None,
    });
    if declared.is_none() {
        blocking.push(format!(
            "property {source_key} is not declared in this space"
        ));
    }
    if !matches!(
        source_property.format,
        PropertyFormat::Text | PropertyFormat::Select | PropertyFormat::MultiSelect
    ) {
        blocking.push(format!(
            "{} is {}; only text, select and multi-select columns can become a relation",
            source_property.name,
            format_name(source_property.format)
        ));
    }
    let source_key_reserved =
        source_key == "title" || source_key == "updated_at" || is_schedule_key(source_key);
    if source_key_reserved {
        blocking.push(format!(
            "{source_key} is reserved by the object format or the schedule"
        ));
    }

    let owners: Vec<&TypeDef> = index
        .types()
        .filter(|def| def.properties.iter().any(|member| member.key == source_key))
        .collect();
    if owners.is_empty() {
        blocking.push(format!(
            "{source_key} is not carried by any type; nothing would become a relation"
        ));
    } else if owners.len() > 1 {
        blocking.push(format!(
            "{source_key} is carried by {} types; promote a property only one type owns",
            owners.len()
        ));
    }
    if let Some(owner) = owner
        && !owner
            .properties
            .iter()
            .any(|member| member.key == source_key)
    {
        blocking.push(format!(
            "{source_key} is not part of the {} type",
            owner.name
        ));
    }
    for def in &owners {
        for view in &def.views {
            for (field, value) in [
                ("group by", view.group_by.as_deref()),
                ("date property", view.date_property.as_deref()),
                ("cover", view.cover.as_deref()),
            ] {
                if value == Some(source_key) {
                    blocking.push(format!(
                        "{}.{} uses {source_key} as its {field}; change that view first",
                        def.key, view.key
                    ));
                }
            }
        }
    }

    let derived_key = key_from_name(&options.target_name);
    if options.target_name.trim().is_empty() {
        blocking.push("the target type needs a name".to_owned());
    }
    if is_reserved_key(&derived_key) {
        blocking.push(format!(
            "{} derives the reserved key {derived_key}; rename the target",
            options.target_name
        ));
    }
    let (target_key, create_target) = match target_type {
        Some(key) => {
            if key != derived_key {
                blocking.push(format!(
                    "target type {key} does not match the target name's key {derived_key}"
                ));
            }
            if index.type_def(key).is_none() {
                blocking.push(format!("target type {key} does not exist"));
            }
            (key.to_owned(), false)
        }
        None => {
            if index.type_def(&derived_key).is_some() {
                blocking.push(format!("type key {derived_key} is already taken"));
            }
            (derived_key.clone(), true)
        }
    };
    let resume = !create_target && index.type_def(&target_key).is_some();

    if options.relation_name.trim().is_empty() {
        blocking.push("the relation needs a name".to_owned());
    }
    match options.split.as_deref().map(str::trim) {
        Some("") => {
            blocking.push("a split needs a delimiter".to_owned());
        }
        Some(_) if source_property.format != PropertyFormat::Text => {
            blocking.push("only a text column can split one cell into several values".to_owned());
        }
        Some(_) if !options.multi => {
            blocking.push("splitting a text column needs several targets".to_owned());
        }
        _ => {}
    }
    if source_property.format == PropertyFormat::MultiSelect && !options.multi {
        blocking.push("a multi-select column needs a relation with several targets".to_owned());
    }

    let relation_key = temporary_key(source_key);
    let existing_relation = index.property_def(&relation_key).cloned();
    let relation_matches = existing_relation.as_ref().is_some_and(|property| {
        property.format == PropertyFormat::Relation
            && property.target_type.as_deref() == Some(target_key.as_str())
            && property.multi == options.multi
    });
    if existing_relation.is_some() && !(resume && relation_matches) {
        blocking.push(format!(
            "{relation_key} is already a property; the temporary relation key is taken"
        ));
    }

    let split = options.split.as_deref().map(str::trim);
    let mut records = 0usize;
    let mut empty = 0usize;
    let mut links = 0usize;
    let mut order: Vec<String> = Vec::new();
    let mut values: BTreeMap<String, (String, usize)> = BTreeMap::new();
    if owner.is_some() {
        for doc in index
            .objects()
            .chain(index.trash())
            .filter(|doc| doc.type_key == type_key)
        {
            records += 1;
            let Some(value) = doc.properties.get(source_key) else {
                empty += 1;
                continue;
            };
            if value::is_empty(value) {
                empty += 1;
                continue;
            }
            let titles = record_titles(&source_property, value, split, &mut warnings);
            if titles.is_empty() {
                empty += 1;
                continue;
            }
            links += titles.len();
            for title in titles {
                if title.chars().count() > MAX_TITLE_LEN {
                    let shortened: String = title.chars().take(60).collect();
                    blocking.push(format!(
                        "“{shortened}…” is longer than {MAX_TITLE_LEN} characters; shorten it first"
                    ));
                }
                let folded = fold_title(&title);
                match values.get_mut(&folded) {
                    Some((_, held)) => *held += 1,
                    None => {
                        order.push(folded.clone());
                        values.insert(folded, (title, 1));
                    }
                }
            }
        }
    }
    let distinct = values.len();
    if distinct > MAX_PROMOTE_VALUES {
        blocking.push(format!(
            "{distinct} distinct values is more than the {MAX_PROMOTE_VALUES} one run can create"
        ));
    }
    if records > MAX_PROMOTE_RECORDS {
        blocking.push(format!(
            "{records} records is more than the {MAX_PROMOTE_RECORDS} one run can read"
        ));
    }

    let required = owner
        .and_then(|def| {
            def.properties
                .iter()
                .find(|member| member.key == source_key)
        })
        .is_some_and(|member| member.required);
    if required && empty > 0 {
        warnings.insert(
            "the column is required, but the new relation is optional, so records without a value stay empty"
                .to_owned(),
        );
    }

    let existing_targets: BTreeSet<String> = if resume {
        index
            .objects()
            .filter(|doc| doc.type_key == target_key)
            .map(|doc| fold_title(&doc.title))
            .collect()
    } else {
        BTreeSet::new()
    };
    let mut create_records = 0usize;
    let target_values: Vec<PromoteValue> = order
        .iter()
        .filter_map(|folded| values.get(folded))
        .map(|(title, held)| {
            let exists = existing_targets.contains(&fold_title(title));
            if !exists {
                create_records += 1;
            }
            PromoteValue {
                title: title.clone(),
                records: *held,
                exists,
            }
        })
        .collect();

    let views: Vec<PromoteView> = owner
        .map(|def| {
            def.views
                .iter()
                .filter_map(|view| {
                    let columns = view.columns.iter().any(|column| column == source_key)
                        || view.widths.contains_key(source_key);
                    let sorts = view
                        .sorts
                        .iter()
                        .filter(|sort| sort.property == source_key)
                        .count();
                    let (moved, dropped) = view
                        .filter
                        .conditions
                        .iter()
                        .filter(|condition| condition.property == source_key)
                        .fold((0usize, 0usize), |(moved, dropped), condition| {
                            if matches!(condition.condition, CondOp::IsEmpty | CondOp::IsNotEmpty) {
                                (moved + 1, dropped)
                            } else {
                                (moved, dropped + 1)
                            }
                        });
                    if !columns && sorts == 0 && moved == 0 && dropped == 0 {
                        return None;
                    }
                    Some(PromoteView {
                        key: view.key.clone(),
                        name: view.name.clone(),
                        columns,
                        sorts,
                        filters_moved: moved,
                        filters_dropped: dropped,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let name = options.target_name.trim().to_owned();
    let name_plural = options
        .target_name_plural
        .as_deref()
        .map(str::trim)
        .filter(|plural| !plural.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{name}s"));

    PromotePlan {
        source: PromoteSource {
            type_key: type_key.to_owned(),
            key: source_key.to_owned(),
            name: source_property.name.clone(),
            format: source_property.format,
            split: split.map(str::to_owned),
            records,
            distinct,
            empty,
        },
        target: PromoteTarget {
            key: target_key,
            name,
            name_plural,
            icon: options
                .target_icon
                .as_deref()
                .map(str::trim)
                .filter(|icon| !icon.is_empty())
                .map(str::to_owned),
            create: create_target,
            values: target_values,
            create_records,
        },
        relation: PromoteRelation {
            key: relation_key,
            name: options.relation_name.trim().to_owned(),
            multi: options.multi,
        },
        links,
        views,
        warnings: warnings.into_iter().collect(),
        blocking,
    }
}

/// The type and records a `targets` run writes, reusing the type and every
/// record whose folded title is already present.
pub fn targets(index: &SpaceIndex, plan: &PromotePlan) -> Result<PromoteTargets, CoreError> {
    if !plan.blocking.is_empty() {
        return Err(CoreError::ValidationFailed {
            field: "promotion".to_owned(),
            message: plan.blocking.join("; "),
        });
    }
    let existing = index.type_def(&plan.target.key).cloned();
    let type_def = existing.unwrap_or_else(|| TypeDef {
        key: plan.target.key.clone(),
        name: plan.target.name.clone(),
        name_plural: plan.target.name_plural.clone(),
        icon: plan.target.icon.clone(),
        description: String::new(),
        schedule: false,
        schedule_labels: Default::default(),
        properties: Vec::new(),
        views: vec![initial_view()],
        default_view: "all".to_owned(),
    });
    let create_type = index.type_def(&plan.target.key).is_none();

    let mut live: BTreeMap<String, Uuid> = BTreeMap::new();
    if !create_type {
        for doc in index
            .objects()
            .filter(|doc| doc.type_key == plan.target.key)
        {
            live.entry(fold_title(&doc.title)).or_insert(doc.id);
        }
    }
    let records: Vec<PromoteRecord> = plan
        .target
        .values
        .iter()
        .map(|value| {
            let folded = fold_title(&value.title);
            match live.get(&folded) {
                Some(id) => PromoteRecord {
                    id: *id,
                    title: value.title.clone(),
                    exists: true,
                },
                None => PromoteRecord {
                    id: Uuid::now_v7(),
                    title: value.title.clone(),
                    exists: false,
                },
            }
        })
        .collect();

    Ok(PromoteTargets {
        type_def,
        create_type,
        records,
    })
}

/// One source record's new relation value.
#[derive(Debug, Clone, PartialEq)]
pub struct PromoteLink {
    pub record: Uuid,
    pub targets: Vec<Uuid>,
}

/// What a `links` run writes, before `finish` renames the key back.
#[derive(Debug, Clone, PartialEq)]
pub struct PromoteLinks {
    pub property: PropertyDef,
    pub create_property: bool,
    /// The owning type with the temporary relation added and its views moved.
    pub type_def: TypeDef,
    /// The relation value each source record still needs.
    pub links: Vec<PromoteLink>,
}

fn promote_error(message: impl Into<String>) -> CoreError {
    CoreError::ValidationFailed {
        field: "promotion".to_owned(),
        message: message.into(),
    }
}

/// The temporary relation property, the owning type with its views moved, and
/// the per-record value the `links` stage writes.
///
/// The target type and its records must already exist; every source record that
/// already holds the temporary key is skipped, so a retry resumes the pass. The
/// old column is left untouched.
pub fn links(index: &SpaceIndex, plan: &PromotePlan) -> Result<PromoteLinks, CoreError> {
    if !plan.blocking.is_empty() {
        return Err(promote_error(plan.blocking.join("; ")));
    }
    let mut type_def = index
        .type_def(&plan.source.type_key)
        .cloned()
        .ok_or_else(|| promote_error(format!("type {} does not exist", plan.source.type_key)))?;
    if index.type_def(&plan.target.key).is_none() {
        return Err(promote_error("create the target records before linking"));
    }
    let source = index
        .property_def(&plan.source.key)
        .cloned()
        .ok_or_else(|| promote_error(format!("property {} no longer exists", plan.source.key)))?;

    let mut targets: BTreeMap<String, Uuid> = BTreeMap::new();
    for doc in index
        .objects()
        .chain(index.trash())
        .filter(|doc| doc.type_key == plan.target.key)
    {
        targets.entry(fold_title(&doc.title)).or_insert(doc.id);
    }

    let existing = index.property_def(&plan.relation.key).cloned();
    if let Some(property) = &existing
        && (property.format != PropertyFormat::Relation
            || property.target_type.as_deref() != Some(plan.target.key.as_str())
            || property.multi != plan.relation.multi)
    {
        return Err(promote_error(format!(
            "{} is already a property; the temporary relation key is taken",
            plan.relation.key
        )));
    }
    let create_property = existing.is_none();
    let property = existing.unwrap_or(PropertyDef {
        key: plan.relation.key.clone(),
        name: plan.relation.name.clone(),
        format: PropertyFormat::Relation,
        options: Vec::new(),
        target_type: Some(plan.target.key.clone()),
        multi: plan.relation.multi,
        compute: None,
    });

    if !type_def
        .properties
        .iter()
        .any(|member| member.key == plan.relation.key)
    {
        let old = type_def
            .properties
            .iter()
            .find(|member| member.key == plan.source.key)
            .cloned();
        type_def.properties.push(TypeProperty {
            key: plan.relation.key.clone(),
            required: old.as_ref().is_some_and(|member| member.required) && plan.source.empty == 0,
            featured: old.as_ref().is_some_and(|member| member.featured),
        });
    }

    for view in &mut type_def.views {
        for column in &mut view.columns {
            if column == &plan.source.key {
                *column = plan.relation.key.clone();
            }
        }
        if let Some(width) = view.widths.remove(&plan.source.key) {
            view.widths.insert(plan.relation.key.clone(), width);
        }
        for sort in &mut view.sorts {
            if sort.property == plan.source.key {
                sort.property = plan.relation.key.clone();
            }
        }
        view.filter.conditions = std::mem::take(&mut view.filter.conditions)
            .into_iter()
            .filter_map(|condition| {
                if condition.property != plan.source.key {
                    return Some(condition);
                }
                matches!(condition.condition, CondOp::IsEmpty | CondOp::IsNotEmpty).then(|| {
                    Condition {
                        property: plan.relation.key.clone(),
                        ..condition
                    }
                })
            })
            .collect();
    }

    let split = plan.source.split.as_deref();
    let mut warnings = BTreeSet::new();
    let mut links = Vec::new();
    for doc in index
        .objects()
        .chain(index.trash())
        .filter(|doc| doc.type_key == plan.source.type_key)
    {
        if doc.properties.contains_key(&plan.relation.key) {
            continue;
        }
        let Some(value) = doc.properties.get(&plan.source.key) else {
            continue;
        };
        if value::is_empty(value) {
            continue;
        }
        let mut ids: Vec<Uuid> = Vec::new();
        for title in record_titles(&source, value, split, &mut warnings) {
            if let Some(id) = targets.get(&fold_title(&title))
                && !ids.contains(id)
            {
                ids.push(*id);
            }
        }
        if !plan.relation.multi {
            ids.truncate(1);
        }
        if ids.is_empty() {
            continue;
        }
        links.push(PromoteLink {
            record: doc.id,
            targets: ids,
        });
    }

    Ok(PromoteLinks {
        property,
        create_property,
        type_def,
        links,
    })
}

/// The object a new target record starts as. The server saves it and records
/// its first revision; this only shapes the file.
pub fn target_record(
    plan: &PromotePlan,
    id: Uuid,
    title: &str,
    at: time::OffsetDateTime,
    by: Uuid,
) -> ObjectDoc {
    ObjectDoc {
        id,
        type_key: plan.target.key.clone(),
        title: title.to_owned(),
        icon: None,
        cover: None,
        cover_position: None,
        rev: 1,
        created_at: at,
        updated_at: at,
        created_by: by,
        updated_by: by,
        trashed_at: None,
        trashed_from: None,
        properties: BTreeMap::new(),
        body: format!("# {title}\n"),
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use tempfile::TempDir;
    use time::OffsetDateTime;

    use super::*;
    use crate::model::{
        CondOp, Condition, Direction, EmptyPlacement, Filter, FilterOp, Member, OptionDef, Role,
        Sort, SpaceMeta, TITLE_KEY, TypeProperty, ViewDef, ViewKind,
    };
    use crate::store::SpaceStore;
    use crate::store::fs::FsSpaceStore;

    fn at(offset: i64) -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_760_000_000 + offset).expect("a timestamp")
    }

    fn me() -> Uuid {
        Uuid::from_u128(1)
    }

    fn space_meta() -> SpaceMeta {
        SpaceMeta {
            id: Uuid::from_u128(100),
            name: "Records".to_owned(),
            icon: None,
            accent: None,
            timezone: "UTC".to_owned(),
            created_at: at(0),
            members: vec![Member {
                user: me(),
                role: Role::Owner,
            }],
        }
    }

    fn text_property(key: &str, name: &str) -> PropertyDef {
        PropertyDef {
            key: key.to_owned(),
            name: name.to_owned(),
            format: PropertyFormat::Text,
            options: Vec::new(),
            target_type: None,
            multi: false,
            compute: None,
        }
    }

    fn view(key: &str, columns: &[&str]) -> ViewDef {
        ViewDef {
            key: key.to_owned(),
            name: key.to_owned(),
            kind: ViewKind::Table,
            sorts: Vec::new(),
            filter: Filter {
                op: FilterOp::And,
                conditions: Vec::new(),
            },
            columns: columns.iter().map(|column| (*column).to_owned()).collect(),
            widths: BTreeMap::new(),
            group_by: None,
            cover: None,
            date_property: None,
        }
    }

    fn sort(property: &str) -> Sort {
        Sort {
            property: property.to_owned(),
            direction: Direction::Asc,
            empty: EmptyPlacement::End,
        }
    }

    fn condition(property: &str, condition: CondOp, value: Option<Value>) -> Condition {
        Condition {
            property: property.to_owned(),
            condition,
            value,
        }
    }

    fn type_def(key: &str, name: &str, properties: &[&str], views: Vec<ViewDef>) -> TypeDef {
        TypeDef {
            key: key.to_owned(),
            name: name.to_owned(),
            name_plural: format!("{name}s"),
            icon: None,
            description: String::new(),
            schedule: false,
            schedule_labels: Default::default(),
            properties: properties
                .iter()
                .map(|key| TypeProperty {
                    key: (*key).to_owned(),
                    required: false,
                    featured: true,
                })
                .collect(),
            views,
            default_view: "all".to_owned(),
        }
    }

    fn object(id: u128, type_key: &str, title: &str, values: &[(&str, &str)]) -> ObjectDoc {
        ObjectDoc {
            id: Uuid::from_u128(id),
            type_key: type_key.to_owned(),
            title: title.to_owned(),
            icon: None,
            cover: None,
            cover_position: None,
            rev: 1,
            created_at: at(0),
            updated_at: at(0),
            created_by: me(),
            updated_by: me(),
            trashed_at: None,
            trashed_from: None,
            properties: values
                .iter()
                .map(|(key, value)| ((*key).to_owned(), Value::Text((*value).to_owned())))
                .collect(),
            body: String::new(),
        }
    }

    struct Space {
        /// Held for its Drop, which removes the space after the test.
        _dir: TempDir,
        store: FsSpaceStore,
    }

    impl Space {
        fn new() -> Self {
            let dir = TempDir::new().expect("a temp dir");
            let store = FsSpaceStore::create(dir.path(), &space_meta()).expect("a space");
            Self { _dir: dir, store }
        }

        fn index(&self) -> SpaceIndex {
            SpaceIndex::rebuild_from_disk(&self.store).expect("a rebuilt index")
        }

        fn save_type(&self, def: &TypeDef) {
            let expected = self
                .store
                .load_type(&def.key)
                .ok()
                .map(|(_, fingerprint)| fingerprint);
            self.store.save_type(def, expected).expect("a type");
        }

        fn save_property(&self, def: &PropertyDef) {
            let expected = self
                .store
                .load_property(&def.key)
                .ok()
                .map(|(_, fingerprint)| fingerprint);
            self.store.save_property(def, expected).expect("a property");
        }

        fn save_object(&self, doc: &ObjectDoc) -> std::path::PathBuf {
            let path = self
                .store
                .new_object_path(&doc.type_key, &doc.title)
                .expect("a path");
            let expected = self
                .store
                .load_object(&path)
                .ok()
                .map(|(_, fingerprint)| fingerprint);
            self.store
                .save_object(&path, doc, expected)
                .expect("an object");
            path
        }
    }

    fn album_space(properties: &[PropertyDef], objects: &[ObjectDoc]) -> Space {
        let space = Space::new();
        for property in properties {
            space.save_property(property);
        }
        let member_keys: Vec<&str> = properties.iter().map(|p| p.key.as_str()).collect();
        let mut first = view("all", &[TITLE_KEY, "artist"]);
        first.sorts.push(sort("artist"));
        first.filter.conditions.push(condition(
            "artist",
            CondOp::Equal,
            Some(Value::Text("Miles Davis".to_owned())),
        ));
        first
            .filter
            .conditions
            .push(condition("artist", CondOp::IsNotEmpty, None));
        let mut second = view("empty", &[TITLE_KEY, "artist"]);
        second
            .filter
            .conditions
            .push(condition("artist", CondOp::IsEmpty, None));
        space.save_type(&type_def(
            "album",
            "Album",
            &member_keys,
            vec![first, second],
        ));
        for doc in objects {
            space.save_object(doc);
        }
        space
    }

    fn artist_options() -> PromoteOptions {
        PromoteOptions {
            target_name: "Artist".to_owned(),
            target_name_plural: Some("Artists".to_owned()),
            target_icon: Some("🎷".to_owned()),
            relation_name: "Artist".to_owned(),
            multi: false,
            split: None,
        }
    }

    fn artists() -> Vec<ObjectDoc> {
        vec![
            object(1, "album", "Kind of Blue", &[("artist", "Miles Davis")]),
            object(2, "album", "A Love Supreme", &[("artist", "John Coltrane")]),
            object(3, "album", "Bitches Brew", &[("artist", "Herbie Hancock")]),
            object(4, "album", "Waltz for Debby", &[("artist", "Bill Evans")]),
            object(5, "album", "Monk's Dream", &[("artist", "Thelonious Monk")]),
            object(6, "album", "Chet Baker Sings", &[("artist", "Chet Baker")]),
            object(7, "album", "Untitled", &[("artist", "  ")]),
            object(8, "album", "No artist", &[]),
        ]
    }

    #[test]
    fn plans_a_text_column_with_counts_links_and_view_changes() {
        let space = album_space(&[text_property("artist", "Artist")], &artists());
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        assert!(plan.blocking.is_empty(), "{:?}", plan.blocking);
        assert_eq!(plan.source.key, "artist");
        assert_eq!(plan.source.records, 8);
        assert_eq!(plan.source.distinct, 6);
        assert_eq!(plan.source.empty, 2);
        assert_eq!(plan.target.key, "artist");
        assert!(plan.target.create);
        assert_eq!(plan.target.create_records, 6);
        assert_eq!(plan.target.name_plural, "Artists");
        assert_eq!(plan.relation.key, "artist_ref");
        assert!(!plan.relation.multi);
        assert_eq!(plan.links, 6);
        assert_eq!(plan.views.len(), 2);
        assert_eq!(
            plan.views
                .iter()
                .map(|view| view.filters_dropped)
                .sum::<usize>(),
            1
        );
        assert_eq!(
            plan.views
                .iter()
                .map(|view| view.filters_moved)
                .sum::<usize>(),
            2
        );
    }

    #[test]
    fn split_turns_one_cell_into_several_values_when_the_relation_is_multi() {
        let objects = vec![object(
            1,
            "album",
            "Two leaders",
            &[("artist", "Miles Davis, John Coltrane")],
        )];
        let space = album_space(&[text_property("artist", "Artist")], &objects);
        let index = space.index();
        let mut options = artist_options();
        options.multi = true;
        options.split = Some(",".to_owned());
        let plan = super::plan(&index, "album", "artist", &options, None);

        assert!(plan.blocking.is_empty(), "{:?}", plan.blocking);
        assert_eq!(plan.source.distinct, 2);
        assert_eq!(plan.links, 2);
        assert_eq!(
            plan.target
                .values
                .iter()
                .map(|value| value.title.as_str())
                .collect::<Vec<_>>(),
            vec!["Miles Davis", "John Coltrane"]
        );
        assert!(
            !plan
                .warnings
                .iter()
                .any(|warning| warning.contains("empty"))
        );
    }

    #[test]
    fn a_split_needs_text_and_several_targets() {
        let space = album_space(
            &[
                text_property("artist", "Artist"),
                PropertyDef {
                    key: "room".to_owned(),
                    name: "Room".to_owned(),
                    format: PropertyFormat::Select,
                    options: Vec::new(),
                    target_type: None,
                    multi: false,
                    compute: None,
                },
            ],
            &[],
        );
        let index = space.index();
        let mut options = artist_options();
        options.split = Some(",".to_owned());
        let plan = super::plan(&index, "album", "artist", &options, None);
        assert!(
            plan.blocking
                .iter()
                .any(|reason| reason.contains("several targets"))
        );

        options.multi = true;
        options.split = Some(",".to_owned());
        let plan = super::plan(&index, "album", "room", &options, None);
        assert!(
            plan.blocking
                .iter()
                .any(|reason| reason.contains("only a text column"))
        );
    }

    #[test]
    fn select_options_read_as_names_and_an_unknown_key_warns() {
        let mut room = PropertyDef {
            key: "room".to_owned(),
            name: "Room".to_owned(),
            format: PropertyFormat::Select,
            options: vec![OptionDef {
                key: "study".to_owned(),
                name: "Study".to_owned(),
                color: "#000000".to_owned(),
            }],
            target_type: None,
            multi: false,
            compute: None,
        };
        let objects = vec![
            object(1, "album", "One", &[("room", "study")]),
            object(2, "album", "Two", &[("room", "attic")]),
        ];
        let space = album_space(&[room.clone()], &objects);
        let index = space.index();
        let plan = super::plan(&index, "album", "room", &artist_options(), None);
        assert!(plan.blocking.is_empty(), "{:?}", plan.blocking);
        assert_eq!(
            plan.target
                .values
                .iter()
                .map(|value| value.title.as_str())
                .collect::<Vec<_>>(),
            vec!["Study", "attic"]
        );
        assert!(
            plan.warnings
                .iter()
                .any(|warning| warning.contains("option attic has no display name"))
        );

        room.options.clear();
        let space = album_space(&[room], &objects);
        let index = space.index();
        let plan = super::plan(&index, "album", "room", &artist_options(), None);
        assert!(
            plan.warnings
                .iter()
                .any(|warning| warning.contains("option study has no display name"))
        );
    }

    #[test]
    fn multi_select_values_become_one_target_per_option() {
        let tags = PropertyDef {
            key: "tags".to_owned(),
            name: "Tags".to_owned(),
            format: PropertyFormat::MultiSelect,
            options: vec![
                OptionDef {
                    key: "jazz".to_owned(),
                    name: "Jazz".to_owned(),
                    color: "#000000".to_owned(),
                },
                OptionDef {
                    key: "live".to_owned(),
                    name: "Live".to_owned(),
                    color: "#000000".to_owned(),
                },
            ],
            target_type: None,
            multi: false,
            compute: None,
        };
        let mut doc = object(1, "album", "One", &[]);
        doc.properties.insert(
            "tags".to_owned(),
            Value::List(vec!["jazz".to_owned(), "live".to_owned()]),
        );
        let space = album_space(&[tags], &[doc]);
        let index = space.index();
        let mut options = artist_options();
        options.multi = true;
        let plan = super::plan(&index, "album", "tags", &options, None);
        assert!(plan.blocking.is_empty(), "{:?}", plan.blocking);
        assert_eq!(plan.source.distinct, 2);
        assert_eq!(plan.links, 2);

        options.multi = false;
        let plan = super::plan(&index, "album", "tags", &options, None);
        assert!(
            plan.blocking
                .iter()
                .any(|reason| reason.contains("multi-select"))
        );
    }

    #[test]
    fn dedupe_folds_case_and_whitespace_and_keeps_the_first_spelling() {
        let objects = vec![
            object(1, "album", "One", &[("artist", "Miles Davis")]),
            object(2, "album", "Two", &[("artist", "  miles   DAVIS  ")]),
        ];
        let space = album_space(&[text_property("artist", "Artist")], &objects);
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        assert_eq!(plan.source.distinct, 1);
        assert_eq!(plan.target.values[0].title, "Miles Davis");
        assert_eq!(plan.target.values[0].records, 2);
    }

    #[test]
    fn trashed_records_are_read_as_well_as_live_ones() {
        let space = album_space(&[text_property("artist", "Artist")], &[]);
        let doc = object(1, "album", "Gone", &[("artist", "Alice Coltrane")]);
        let path = space.save_object(&doc);
        let fingerprint = space.store.load_object(&path).expect("the object").1;
        space
            .store
            .move_to_trash(&path, at(10), Some(fingerprint))
            .expect("to trash");
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        assert_eq!(plan.source.records, 1);
        assert_eq!(plan.source.distinct, 1);
        assert_eq!(plan.links, 1);
    }

    #[test]
    fn a_property_carried_by_two_types_is_blocked() {
        let space = album_space(&[text_property("artist", "Artist")], &[]);
        space.save_type(&type_def(
            "session",
            "Session",
            &["artist"],
            vec![view("all", &[TITLE_KEY])],
        ));
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        assert!(
            plan.blocking
                .iter()
                .any(|reason| reason.contains("carried by 2 types"))
        );
    }

    #[test]
    fn a_taken_target_key_or_temporary_key_blocks() {
        let space = album_space(&[text_property("artist", "Artist")], &[]);
        space.save_type(&type_def(
            "artist",
            "Artist",
            &[],
            vec![view("all", &[TITLE_KEY])],
        ));
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        assert!(
            plan.blocking
                .iter()
                .any(|reason| reason.contains("type key artist is already taken"))
        );
        let resumed = super::plan(&index, "album", "artist", &artist_options(), Some("artist"));
        assert!(
            !resumed
                .blocking
                .iter()
                .any(|reason| reason.contains("already taken"))
        );
        assert!(!resumed.target.create);

        space.save_property(&PropertyDef {
            key: "artist_ref".to_owned(),
            name: "Artist ref".to_owned(),
            format: PropertyFormat::Text,
            options: Vec::new(),
            target_type: None,
            multi: false,
            compute: None,
        });
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), Some("artist"));
        assert!(
            plan.blocking
                .iter()
                .any(|reason| reason.contains("temporary relation key is taken"))
        );
    }

    #[test]
    fn a_required_source_with_empty_values_warns_that_the_relation_is_optional() {
        let space = Space::new();
        space.save_property(&text_property("artist", "Artist"));
        let mut def = type_def(
            "album",
            "Album",
            &["artist"],
            vec![view("all", &[TITLE_KEY])],
        );
        def.properties[0].required = true;
        space.save_type(&def);
        let objects = vec![
            object(1, "album", "One", &[("artist", "Miles Davis")]),
            object(2, "album", "Two", &[]),
        ];
        for doc in &objects {
            space.save_object(doc);
        }
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        assert!(
            plan.warnings
                .iter()
                .any(|warning| warning.contains("the new relation is optional"))
        );
    }

    #[test]
    fn a_property_no_type_carries_is_blocked() {
        let space = Space::new();
        space.save_property(&text_property("artist", "Artist"));
        space.save_type(&type_def(
            "album",
            "Album",
            &[],
            vec![view("all", &[TITLE_KEY])],
        ));
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        assert!(
            plan.blocking
                .iter()
                .any(|reason| reason.contains("not carried by any type"))
        );
    }

    #[test]
    fn a_view_that_groups_by_the_source_blocks() {
        let mut by_room = view("all", &[TITLE_KEY, "artist"]);
        by_room.group_by = Some("artist".to_owned());
        let space = Space::new();
        space.save_property(&PropertyDef {
            key: "artist".to_owned(),
            name: "Artist".to_owned(),
            format: PropertyFormat::Select,
            options: vec![OptionDef {
                key: "miles".to_owned(),
                name: "Miles Davis".to_owned(),
                color: "#000000".to_owned(),
            }],
            target_type: None,
            multi: false,
            compute: None,
        });
        space.save_type(&type_def("album", "Album", &["artist"], vec![by_room]));
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        assert!(
            plan.blocking
                .iter()
                .any(|reason| reason.contains("uses artist as its group by"))
        );
    }

    #[test]
    fn targets_creates_once_and_then_reuses_every_record() {
        let space = album_space(&[text_property("artist", "Artist")], &artists());
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        let first = targets(&index, &plan).expect("targets");
        assert!(first.create_type);
        assert_eq!(first.records.len(), 6);
        assert!(first.records.iter().all(|record| !record.exists));

        space.save_type(&first.type_def);
        let mut saved = Vec::new();
        for record in &first.records {
            let doc = target_record(&plan, record.id, &record.title, at(1), me());
            space.save_object(&doc);
            saved.push(record.id);
        }
        let index = space.index();
        let resumed = super::plan(&index, "album", "artist", &artist_options(), Some("artist"));
        assert!(resumed.blocking.is_empty(), "{:?}", resumed.blocking);
        assert!(!resumed.target.create);
        assert_eq!(resumed.target.create_records, 0);
        let second = targets(&index, &resumed).expect("targets again");
        assert!(!second.create_type);
        assert!(second.records.iter().all(|record| record.exists));
        assert_eq!(
            second
                .records
                .iter()
                .map(|record| record.id)
                .collect::<Vec<_>>(),
            saved
        );
    }

    #[test]
    fn the_temporary_key_keeps_its_suffix_within_the_key_limit() {
        let key = temporary_key(&"a".repeat(MAX_KEY_LEN));
        assert_eq!(key.len(), MAX_KEY_LEN);
        assert!(key.ends_with("_ref"));
        assert_eq!(temporary_key("artist"), "artist_ref");
    }

    fn linked_space() -> (Space, Vec<Uuid>) {
        let space = album_space(&[text_property("artist", "Artist")], &artists());
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        let targets = targets(&index, &plan).expect("targets");
        space.save_type(&targets.type_def);
        let mut ids = Vec::new();
        for record in &targets.records {
            let doc = target_record(&plan, record.id, &record.title, at(1), me());
            space.save_object(&doc);
            ids.push(record.id);
        }
        (space, ids)
    }

    #[test]
    fn links_writes_the_temporary_relation_and_moves_every_view() {
        let (space, target_ids) = linked_space();
        let index = space.index();
        assert_eq!(
            index
                .type_def("artist")
                .expect("target type")
                .properties
                .len(),
            0
        );
        let plan = super::plan(&index, "album", "artist", &artist_options(), Some("artist"));
        assert!(plan.blocking.is_empty(), "{:?}", plan.blocking);
        let linked = links(&index, &plan).expect("links");

        assert!(linked.create_property);
        assert_eq!(linked.property.key, "artist_ref");
        assert_eq!(linked.property.format, PropertyFormat::Relation);
        assert_eq!(linked.property.target_type.as_deref(), Some("artist"));
        assert!(!linked.property.multi);

        let member = linked
            .type_def
            .properties
            .iter()
            .find(|member| member.key == "artist_ref")
            .expect("the temporary member");
        assert!(member.featured);
        assert!(!member.required);

        let all = linked.type_def.view("all").expect("the first view");
        assert!(all.columns.iter().any(|column| column == "artist_ref"));
        assert!(!all.columns.iter().any(|column| column == "artist"));
        assert_eq!(all.sorts[0].property, "artist_ref");
        assert_eq!(all.filter.conditions.len(), 1);
        assert_eq!(all.filter.conditions[0].property, "artist_ref");
        assert_eq!(all.filter.conditions[0].condition, CondOp::IsNotEmpty);
        let empty = linked.type_def.view("empty").expect("the second view");
        assert_eq!(empty.filter.conditions[0].property, "artist_ref");
        assert_eq!(empty.filter.conditions[0].condition, CondOp::IsEmpty);

        assert_eq!(linked.links.len(), 6);
        let miles = index.object(Uuid::from_u128(1)).expect("Kind of Blue");
        let link = linked
            .links
            .iter()
            .find(|link| link.record == miles.id)
            .expect("the Miles Davis row");
        let miles_id = index
            .objects()
            .find(|doc| doc.type_key == "artist" && doc.title == "Miles Davis")
            .expect("the Miles Davis target")
            .id;
        assert_eq!(link.targets, vec![miles_id]);
        assert!(
            linked
                .links
                .iter()
                .all(|link| link.targets.len() == 1 && target_ids.contains(&link.targets[0]))
        );
    }

    #[test]
    fn links_reuses_the_property_and_skips_records_already_written() {
        let (space, _) = linked_space();
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), Some("artist"));
        let first = links(&index, &plan).expect("links");
        space.save_property(&first.property);
        space.save_type(&first.type_def);
        let mut kind_of_blue = space
            .index()
            .object(Uuid::from_u128(1))
            .cloned()
            .expect("a row");
        kind_of_blue.properties.insert(
            "artist_ref".to_owned(),
            Value::Text(first.links[0].targets[0].to_string()),
        );
        space.save_object(&kind_of_blue);

        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), Some("artist"));
        let again = links(&index, &plan).expect("links again");
        assert!(!again.create_property);
        assert_eq!(again.property.key, "artist_ref");
        assert_eq!(again.links.len(), 5);
        assert!(
            !again
                .links
                .iter()
                .any(|link| link.record == kind_of_blue.id)
        );
        assert_eq!(
            again.type_def.view("all").expect("the view").columns.len(),
            2
        );
        assert_eq!(
            again
                .type_def
                .view("all")
                .expect("the view")
                .filter
                .conditions
                .len(),
            1
        );
    }

    #[test]
    fn links_copies_required_only_when_every_value_is_present() {
        let objects = vec![object(
            1,
            "album",
            "Kind of Blue",
            &[("artist", "Miles Davis")],
        )];
        let space = album_space(&[text_property("artist", "Artist")], &objects);
        let mut def = space.index().type_def("album").cloned().expect("the type");
        def.properties[0].required = true;
        space.save_type(&def);

        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        assert_eq!(plan.source.empty, 0);
        let first = targets(&index, &plan).expect("targets");
        space.save_type(&first.type_def);
        for record in &first.records {
            space.save_object(&target_record(&plan, record.id, &record.title, at(1), me()));
        }

        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), Some("artist"));
        let linked = links(&index, &plan).expect("links");
        let member = linked
            .type_def
            .properties
            .iter()
            .find(|member| member.key == "artist_ref")
            .expect("the temporary member");
        assert!(member.required);
    }

    #[test]
    fn links_links_trashed_source_records_too() {
        let space = album_space(
            &[text_property("artist", "Artist")],
            &[object(
                1,
                "album",
                "Kind of Blue",
                &[("artist", "Miles Davis")],
            )],
        );
        let index = space.index();
        let id = Uuid::from_u128(1);
        let path = index.object_path(id).expect("a path").to_owned();
        let expected = index.fingerprint(&path);
        space
            .store
            .move_to_trash(&path, at(2), expected)
            .expect("trashed");

        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        assert_eq!(plan.source.records, 1);
        let targets = targets(&index, &plan).expect("targets");
        space.save_type(&targets.type_def);
        for record in &targets.records {
            space.save_object(&target_record(&plan, record.id, &record.title, at(1), me()));
        }

        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), Some("artist"));
        let linked = links(&index, &plan).expect("links");
        assert_eq!(linked.links.len(), 1);
        assert_eq!(linked.links[0].record, id);
        assert_eq!(linked.links[0].targets.len(), 1);
    }

    #[test]
    fn links_refuses_a_plan_whose_target_type_does_not_exist() {
        let space = album_space(&[text_property("artist", "Artist")], &artists());
        let index = space.index();
        let plan = super::plan(&index, "album", "artist", &artist_options(), None);
        let refused = links(&index, &plan).expect_err("no target type yet");
        assert!(matches!(refused, CoreError::ValidationFailed { .. }));
        assert!(refused.to_string().contains("create the target records"));
    }
}
