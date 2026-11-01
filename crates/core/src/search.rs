//! An inverted index over one space's live records.
//!
//! The index is derived state: [`crate::index::SpaceIndex`] builds it from the
//! markdown at boot and updates one document whenever a file is re-read. It is
//! never written to disk, because the files it indexes are already the source.
//!
//! Matching is deliberately small: a token is a lowercase alphanumeric run, a
//! query matches when every one of its tokens begins an indexed token, and the
//! order is pinned so one space always answers the same query the same way.

use std::collections::{BTreeMap, BTreeSet};
use std::ops::Bound;

use time::OffsetDateTime;
use uuid::Uuid;

use crate::model::ObjectDoc;

/// Longest token kept; a longer run is split instead of dropped.
const TOKEN_MAX_CHARS: usize = 64;
/// A query token beyond this many is ignored.
const MAX_QUERY_TOKENS: usize = 8;
/// How many indexed tokens one query prefix may expand to before only the
/// exact token is considered, so a pathological prefix cannot scan the index.
const PREFIX_EXPANSIONS: usize = 64;
/// Body occurrences counted per query token, so one repeated word cannot
/// outrank a title match.
const BODY_HITS_PER_TOKEN: u32 = 20;

/// Lowercase alphanumeric runs of `text`, in order.
///
/// A run longer than [`TOKEN_MAX_CHARS`] yields several tokens rather than one
/// truncated token, so a long identifier stays searchable at its start.
pub fn tokens(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|character: char| !character.is_alphanumeric())
        .filter(|run| !run.is_empty())
        .flat_map(tokenize_run)
}

fn tokenize_run(run: &str) -> Vec<String> {
    let characters: Vec<char> = run.chars().collect();
    characters
        .chunks(TOKEN_MAX_CHARS)
        .map(|chunk| {
            chunk
                .iter()
                .flat_map(|character| character.to_lowercase())
                .collect()
        })
        .collect()
}

/// One document's participation in the index.
#[derive(Debug, Clone)]
struct IndexedDoc {
    type_key: String,
    /// The trimmed title, folded for the phrase test and the name tie-break.
    title: String,
    title_tokens: BTreeSet<String>,
    /// Every body token and how many times it occurs.
    body_terms: BTreeMap<String, u32>,
    updated_at: OffsetDateTime,
}

/// One ranked result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub id: Uuid,
    pub score: u32,
}

/// Every match before the caller's limit, and the page it asked for.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchResults {
    pub total: usize,
    pub hits: Vec<SearchHit>,
}

/// The inverted index itself.
#[derive(Debug, Clone, Default)]
pub struct SearchIndex {
    postings: BTreeMap<String, BTreeSet<Uuid>>,
    docs: BTreeMap<Uuid, IndexedDoc>,
}

impl SearchIndex {
    /// Adds or replaces one live document.
    pub fn upsert(&mut self, doc: &ObjectDoc) {
        self.remove(doc.id);
        let title_tokens: BTreeSet<String> = tokens(&doc.title).collect();
        let mut body_terms: BTreeMap<String, u32> = BTreeMap::new();
        for token in tokens(&doc.body) {
            *body_terms.entry(token).or_insert(0) += 1;
        }
        for token in title_tokens.iter().chain(body_terms.keys()) {
            self.postings
                .entry(token.clone())
                .or_default()
                .insert(doc.id);
        }
        self.docs.insert(
            doc.id,
            IndexedDoc {
                type_key: doc.type_key.clone(),
                title: doc.title.trim().to_lowercase(),
                title_tokens,
                body_terms,
                updated_at: doc.updated_at,
            },
        );
    }

    /// Drops one document and every posting that named it.
    pub fn remove(&mut self, id: Uuid) {
        let Some(doc) = self.docs.remove(&id) else {
            return;
        };
        let keys: BTreeSet<&String> = doc
            .title_tokens
            .iter()
            .chain(doc.body_terms.keys())
            .collect();
        for key in keys {
            let now_empty = match self.postings.get_mut(key) {
                Some(ids) => {
                    ids.remove(&id);
                    ids.is_empty()
                }
                None => false,
            };
            if now_empty {
                self.postings.remove(key);
            }
        }
    }

    /// Builds an index from a whole space in one pass.
    pub fn rebuild<'a>(docs: impl Iterator<Item = &'a ObjectDoc>) -> Self {
        let mut index = Self::default();
        for doc in docs {
            index.upsert(doc);
        }
        index
    }

    /// Ranks live documents that match every query token.
    ///
    /// A query token matches an indexed token that equals it or starts with it.
    /// The optional type key narrows before scoring. `total` counts every match;
    /// `hits` is capped at `limit`.
    pub fn query(&self, text: &str, type_key: Option<&str>, limit: usize) -> SearchResults {
        let query_tokens: Vec<String> = tokens(text).take(MAX_QUERY_TOKENS).collect();
        if query_tokens.is_empty() {
            return SearchResults::default();
        }

        let mut matches: Vec<BTreeSet<Uuid>> = Vec::with_capacity(query_tokens.len());
        for token in &query_tokens {
            let ids = self.expand(token);
            if ids.is_empty() {
                return SearchResults::default();
            }
            matches.push(ids);
        }
        let mut candidates = matches[0].clone();
        for ids in matches.iter().skip(1) {
            candidates = candidates.intersection(ids).copied().collect();
            if candidates.is_empty() {
                return SearchResults::default();
            }
        }

        let whole = text.trim().to_lowercase();
        let mut scored: Vec<Scored> = candidates
            .into_iter()
            .filter_map(|id| {
                let doc = self.docs.get(&id)?;
                if type_key.is_some_and(|wanted| doc.type_key != wanted) {
                    return None;
                }
                Some(Scored {
                    id,
                    score: self.score(doc, &query_tokens, &whole),
                    updated_at: doc.updated_at,
                    title: doc.title.clone(),
                })
            })
            .collect();
        let total = scored.len();
        scored.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.title.cmp(&right.title))
                .then_with(|| left.id.cmp(&right.id))
        });
        let hits = scored
            .into_iter()
            .take(limit)
            .map(|entry| SearchHit {
                id: entry.id,
                score: entry.score,
            })
            .collect();
        SearchResults { total, hits }
    }

    /// Every posting key a query token names, capped so a one-letter query
    /// cannot walk the whole dictionary.
    fn expand(&self, token: &str) -> BTreeSet<Uuid> {
        let mut keys: Vec<&String> = self
            .postings
            .range::<str, _>((Bound::Included(token), Bound::Unbounded))
            .take_while(|(key, _)| key.starts_with(token))
            .map(|(key, _)| key)
            .collect();
        if keys.len() > PREFIX_EXPANSIONS {
            keys = self
                .postings
                .get_key_value(token)
                .map(|(key, _)| vec![key])
                .unwrap_or_default();
        }
        let mut ids = BTreeSet::new();
        for key in keys {
            if let Some(postings) = self.postings.get(key) {
                ids.extend(postings.iter().copied());
            }
        }
        ids
    }

    fn score(&self, doc: &IndexedDoc, query_tokens: &[String], whole: &str) -> u32 {
        let mut score: u32 = 0;
        if !whole.is_empty() && doc.title.contains(whole) {
            score += 100;
        }
        let mut title_hits: u32 = 0;
        for token in query_tokens {
            let starts_a_title_token = doc
                .title_tokens
                .range::<str, _>((Bound::Included(token.as_str()), Bound::Unbounded))
                .next()
                .is_some_and(|term| term.starts_with(token.as_str()));
            if starts_a_title_token {
                title_hits += 1;
            }
        }
        if title_hits == query_tokens.len() as u32 {
            score += 40;
        }
        score += 8 * title_hits;
        for token in query_tokens {
            let mut hits: u32 = 0;
            for (term, count) in doc
                .body_terms
                .range::<str, _>((Bound::Included(token.as_str()), Bound::Unbounded))
            {
                if !term.starts_with(token.as_str()) {
                    break;
                }
                hits += *count;
                if hits >= BODY_HITS_PER_TOKEN {
                    hits = BODY_HITS_PER_TOKEN;
                    break;
                }
            }
            score += hits.min(BODY_HITS_PER_TOKEN);
        }
        score
    }
}

/// A candidate kept with the fields its tie-break needs.
struct Scored {
    id: Uuid,
    score: u32,
    updated_at: OffsetDateTime,
    title: String,
}

/// A whitespace-collapsed window around the first body occurrence of `query`.
///
/// The phrase is tried first; otherwise the earliest query token wins. Returns
/// `None` when the body does not contain the query, which is how a title-only
/// match sends no snippet. Matching is case-insensitive without slicing the
/// original by a folded byte offset, so text outside ASCII cannot panic.
pub fn snippet(body: &str, query: &str, width: usize) -> Option<String> {
    if width == 0 || body.is_empty() {
        return None;
    }
    let characters: Vec<char> = body.chars().collect();
    let (folded, map) = fold_with_map(body);

    let phrase = query.trim().to_lowercase();
    let phrase_chars = phrase.chars().count();
    let mut span = if phrase_chars > 0 {
        find_span(&folded, &map, &phrase, phrase_chars, characters.len())
    } else {
        None
    };
    if span.is_none() {
        let mut earliest: Option<(usize, (usize, usize))> = None;
        for token in tokens(query) {
            let length = token.chars().count();
            let Some(found) = find_span(&folded, &map, &token, length, characters.len()) else {
                continue;
            };
            if earliest.is_none_or(|(start, _)| found.0 < start) {
                earliest = Some((found.0, found));
            }
        }
        span = earliest.map(|(_, found)| found);
    }
    let (hit_start, hit_end) = span?;
    let padding = width.saturating_sub(hit_end - hit_start) / 2;
    let start = hit_start.saturating_sub(padding);
    let end = (hit_end + padding).min(characters.len());
    let window: String = characters[start..end].iter().collect();
    let window = window.split_whitespace().collect::<Vec<_>>().join(" ");
    (!window.is_empty()).then_some(window)
}

/// Finds one folded needle and returns its span in original character indices.
fn find_span(
    folded: &str,
    map: &[usize],
    needle: &str,
    needle_chars: usize,
    original_len: usize,
) -> Option<(usize, usize)> {
    if needle_chars == 0 {
        return None;
    }
    let byte = folded.find(needle)?;
    let folded_start = folded[..byte].chars().count();
    let folded_last = folded_start + needle_chars - 1;
    let start = *map.get(folded_start)?;
    let end = (*map.get(folded_last)? + 1).min(original_len);
    Some((start, end))
}

/// Folds text to lowercase and records which original character each folded
/// character came from, so a match can be mapped back with no byte slicing.
fn fold_with_map(text: &str) -> (String, Vec<usize>) {
    let mut folded = String::new();
    let mut map = Vec::new();
    for (index, character) in text.chars().enumerate() {
        for lower in character.to_lowercase() {
            folded.push(lower);
            map.push(index);
        }
    }
    (folded, map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ObjectDoc, Value};

    fn at(offset: i64) -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_760_000_000 + offset).expect("valid timestamp")
    }

    fn doc(id: u128, title: &str, body: &str, updated: i64) -> ObjectDoc {
        ObjectDoc {
            id: Uuid::from_u128(id),
            type_key: "plant".to_owned(),
            title: title.to_owned(),
            icon: None,
            rev: 1,
            created_at: at(0),
            updated_at: at(updated),
            created_by: Uuid::from_u128(1),
            updated_by: Uuid::from_u128(1),
            trashed_at: None,
            trashed_from: None,
            properties: BTreeMap::<String, Value>::new(),
            body: body.to_owned(),
        }
    }

    fn ids(results: &SearchResults) -> Vec<Uuid> {
        results.hits.iter().map(|hit| hit.id).collect()
    }

    #[test]
    fn tokens_are_lowercase_alphanumeric_runs_in_order() {
        assert_eq!(
            tokens("Water the Monstera, twice!").collect::<Vec<_>>(),
            vec!["water", "the", "monstera", "twice"]
        );
        assert_eq!(tokens("  ...  ").count(), 0);
    }

    #[test]
    fn a_long_run_is_split_rather_than_dropped() {
        let long = "a".repeat(TOKEN_MAX_CHARS + 1);
        let found: Vec<String> = tokens(&long).collect();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].chars().count(), TOKEN_MAX_CHARS);
        assert_eq!(found[1], "a");
    }

    #[test]
    fn a_body_only_word_is_found() {
        let index = SearchIndex::rebuild([doc(2, "Monstera", "The soil stays moist.", 5)].iter());
        let results = index.query("moist", None, 10);
        assert_eq!(results.total, 1);
        assert_eq!(ids(&results), vec![Uuid::from_u128(2)]);
    }

    #[test]
    fn a_query_token_matches_a_prefix() {
        let index = SearchIndex::rebuild([doc(2, "Monstera", "Watered today.", 5)].iter());
        assert_eq!(index.query("wat", None, 10).total, 1);
        assert_eq!(index.query("water", None, 10).total, 1);
        assert_eq!(index.query("watering", None, 10).total, 0);
    }

    #[test]
    fn every_query_token_must_match() {
        let index = SearchIndex::rebuild(
            [
                doc(2, "Monstera", "The soil stays moist.", 5),
                doc(3, "Ficus", "The soil is dry.", 6),
            ]
            .iter(),
        );
        assert_eq!(index.query("soil moist", None, 10).total, 1);
        assert_eq!(index.query("soil dry", None, 10).total, 1);
        assert_eq!(index.query("soil frost", None, 10).total, 0);
    }

    #[test]
    fn a_title_hit_outranks_a_body_hit() {
        let index = SearchIndex::rebuild(
            [
                doc(2, "Water the ficus", "", 5),
                doc(3, "Monstera", "water water water water water", 6),
            ]
            .iter(),
        );
        let results = index.query("water", None, 10);
        assert_eq!(ids(&results), vec![Uuid::from_u128(2), Uuid::from_u128(3)]);
        assert!(results.hits[0].score > results.hits[1].score);
    }

    #[test]
    fn the_type_filter_narrows_before_counting() {
        let mut chore = doc(4, "Water the monstera", "", 7);
        chore.type_key = "chore".to_owned();
        let index = SearchIndex::rebuild([doc(2, "Monstera", "water", 5), chore].iter());
        assert_eq!(index.query("water", None, 10).total, 2);
        assert_eq!(index.query("water", Some("chore"), 10).total, 1);
        assert_eq!(
            ids(&index.query("water", Some("chore"), 10)),
            vec![Uuid::from_u128(4)]
        );
        assert_eq!(index.query("water", Some("plant"), 10).total, 1);
    }

    #[test]
    fn updating_a_document_removes_its_stale_tokens() {
        let mut index = SearchIndex::default();
        index.upsert(&doc(2, "Ficus", "A dry room.", 5));
        index.upsert(&doc(2, "Monstera", "A moist room.", 6));
        assert_eq!(index.query("ficus", None, 10).total, 0);
        assert_eq!(index.query("dry", None, 10).total, 0);
        assert_eq!(index.query("monstera", None, 10).total, 1);
        assert_eq!(index.query("moist", None, 10).total, 1);
    }

    #[test]
    fn removing_a_document_drops_its_postings() {
        let mut index = SearchIndex::rebuild([doc(2, "Monstera", "water", 5)].iter());
        index.remove(Uuid::from_u128(2));
        assert_eq!(index.query("monstera", None, 10).total, 0);
        assert_eq!(index.query("water", None, 10).total, 0);
        assert!(index.postings.is_empty());
    }

    #[test]
    fn rebuild_matches_the_incremental_index() {
        let docs = [
            doc(2, "Monstera", "The soil stays moist.", 5),
            doc(3, "Ficus", "Water when dry.", 6),
        ];
        let rebuilt = SearchIndex::rebuild(docs.iter());
        let mut incremental = SearchIndex::default();
        for doc in &docs {
            incremental.upsert(doc);
        }
        assert_eq!(
            rebuilt.query("soil", None, 10),
            incremental.query("soil", None, 10)
        );
        assert_eq!(
            rebuilt.query("water", None, 10),
            incremental.query("water", None, 10)
        );
    }

    #[test]
    fn an_empty_query_returns_nothing() {
        let index = SearchIndex::rebuild([doc(2, "Monstera", "water", 5)].iter());
        assert_eq!(index.query("", None, 10), SearchResults::default());
        assert_eq!(index.query("   ", None, 10), SearchResults::default());
        assert_eq!(index.query("!!!", None, 10), SearchResults::default());
    }

    #[test]
    fn equal_scores_break_on_time_then_title_then_id() {
        let index = SearchIndex::rebuild(
            [
                doc(9, "Same", "water", 5),
                doc(4, "Same", "water", 5),
                doc(3, "Same", "water", 6),
            ]
            .iter(),
        );
        assert_eq!(
            ids(&index.query("water", None, 10)),
            vec![Uuid::from_u128(3), Uuid::from_u128(4), Uuid::from_u128(9)]
        );
    }

    #[test]
    fn the_limit_caps_hits_but_not_the_total() {
        let index = SearchIndex::rebuild(
            [doc(2, "Monstera", "water", 5), doc(3, "Ficus", "water", 6)].iter(),
        );
        let results = index.query("water", None, 1);
        assert_eq!(results.total, 2);
        assert_eq!(results.hits.len(), 1);
    }

    #[test]
    fn a_snippet_surrounds_the_match_and_collapses_whitespace() {
        let body = "The soil is still quite moist near the roots.\n\nWater when dry.";
        let found = snippet(body, "moist", 120).expect("a body match");
        assert!(found.contains("moist"), "{found}");
        assert!(!found.contains('\n'), "{found}");
    }

    #[test]
    fn a_title_only_match_has_no_snippet() {
        assert_eq!(snippet("A dry room.", "monstera", 120), None);
        assert_eq!(snippet("", "monstera", 120), None);
        assert_eq!(snippet("moist", "moist", 0), None);
    }

    #[test]
    fn a_snippet_is_safe_outside_ascii() {
        let found = snippet("İstanbul is warm today.", "stan", 40).expect("a body match");
        assert!(found.contains("stanbul"), "{found}");
    }
}
