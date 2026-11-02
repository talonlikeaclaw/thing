//! `[[TypeKey/Title]]` links in a markdown body.
//!
//! A link is body syntax, never a frontmatter value: the index records the edge
//! it names and the record read exposes it. Parsing skips fenced code blocks and
//! inline code, because a link inside a code sample is text, not an edge.
//!
//! Grammar: `[[TypeKey/Title]]`, the first `/` splits the type key from the
//! title, the inner text is trimmed, both sides must be non-empty, the key must
//! be a legal type key and the whole inner text is at most 200 characters.

use crate::slug::is_valid_key;
use uuid::Uuid;

/// Longest inner text a link may carry, in characters.
pub const MAX_LINK_CHARS: usize = 200;

/// What a link names in the current space.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkStatus {
    /// Exactly one live record of that type carries the title.
    Found(Uuid),
    /// No live record matches.
    Unknown,
    /// More than one live record carries the title; the count is the number.
    Ambiguous(usize),
}

/// One distinct outgoing link, with its resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkView {
    /// The trimmed text between the brackets, as typed.
    pub raw: String,
    pub type_key: String,
    pub title: String,
    pub status: LinkStatus,
}

/// A record that points here through a relation property.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationBacklink {
    pub source: Uuid,
    pub property: String,
}

/// A record whose body links here, with the first occurrence's sentence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MentionBacklink {
    pub source: Uuid,
    pub count: usize,
    pub snippet: String,
}

/// One parsed `[[…]]` occurrence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLink {
    /// The trimmed text between the brackets.
    pub inner: String,
    /// Character offset of the opening `[`.
    pub start: usize,
    /// Character offset one past the closing `]`.
    pub end: usize,
    pub type_key: String,
    pub title: String,
}

/// Every link in `body`, in document order, duplicate occurrences included.
pub fn parse(body: &str) -> Vec<ParsedLink> {
    let mut links = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut offset = 0usize;

    for line in body.split_inclusive('\n') {
        let characters: Vec<char> = line.chars().collect();
        let trimmed = line.trim_start();

        if let Some((marker, length)) = fence {
            if is_closing_fence(trimmed, marker, length) {
                fence = None;
            }
            offset += characters.len();
            continue;
        }
        if let Some(opened) = opening_fence(trimmed) {
            fence = Some(opened);
            offset += characters.len();
            continue;
        }

        scan_line(&characters, offset, &mut links);
        offset += characters.len();
    }
    links
}

/// A whitespace-collapsed window around one link occurrence, for a backlink.
pub fn excerpt(body: &str, start: usize, end: usize, width: usize) -> String {
    let characters: Vec<char> = body.chars().collect();
    let span = end.saturating_sub(start);
    let padding = width.saturating_sub(span) / 2;
    let from = start.saturating_sub(padding);
    let to = (end + padding).min(characters.len());
    characters[from..to]
        .iter()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn scan_line(characters: &[char], offset: usize, links: &mut Vec<ParsedLink>) {
    // A link never crosses a line; the newline closes the search window.
    let limit = characters
        .iter()
        .position(|character| *character == '\n')
        .unwrap_or(characters.len());
    let mut at = 0;

    while at < limit {
        if characters[at] == '\\'
            && at + 2 < limit
            && characters[at + 1] == '['
            && characters[at + 2] == '['
        {
            at += 3;
            continue;
        }
        if characters[at] == '`' {
            let run = backtick_run(characters, at, limit);
            if let Some(close) = closing_backticks(characters, at + run, limit, run) {
                at = close + run;
            } else {
                at += run;
            }
            continue;
        }
        if characters[at] == '['
            && at + 1 < limit
            && characters[at + 1] == '['
            && let Some(close) = closing_brackets(characters, at + 2, limit)
        {
            let inner: String = characters[at + 2..close].iter().collect();
            if let Some((type_key, title)) = split_inner(&inner) {
                links.push(ParsedLink {
                    inner: inner.trim().to_owned(),
                    start: offset + at,
                    end: offset + close + 2,
                    type_key,
                    title,
                });
            }
            at = close + 2;
            continue;
        }
        at += 1;
    }
}

fn split_inner(inner: &str) -> Option<(String, String)> {
    if inner.chars().count() > MAX_LINK_CHARS {
        return None;
    }
    let (type_key, title) = inner.trim().split_once('/')?;
    let type_key = type_key.trim();
    let title = title.trim();
    if !is_valid_key(type_key) || title.is_empty() {
        return None;
    }
    Some((type_key.to_owned(), title.to_owned()))
}

fn backtick_run(characters: &[char], at: usize, limit: usize) -> usize {
    let mut end = at;
    while end < limit && characters[end] == '`' {
        end += 1;
    }
    end - at
}

/// The start of the next run of exactly `run` backticks, if one closes the span.
fn closing_backticks(characters: &[char], from: usize, limit: usize, run: usize) -> Option<usize> {
    let mut at = from;
    while at < limit {
        if characters[at] != '`' {
            at += 1;
            continue;
        }
        let found = backtick_run(characters, at, limit);
        if found == run {
            return Some(at);
        }
        at += found;
    }
    None
}

fn closing_brackets(characters: &[char], from: usize, limit: usize) -> Option<usize> {
    let mut at = from;
    while at + 1 < limit {
        if characters[at] == ']' && characters[at + 1] == ']' {
            return Some(at);
        }
        at += 1;
    }
    None
}

/// A fence opener: at least three backticks or tildes after optional indentation.
fn opening_fence(trimmed: &str) -> Option<(char, usize)> {
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let length = trimmed
        .chars()
        .take_while(|character| *character == marker)
        .count();
    (length >= 3).then_some((marker, length))
}

fn is_closing_fence(trimmed: &str, marker: char, length: usize) -> bool {
    let run = trimmed
        .chars()
        .take_while(|character| *character == marker)
        .count();
    run >= length
        && trimmed
            .chars()
            .skip(run)
            .all(|character| character.is_whitespace())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(body: &str) -> ParsedLink {
        let mut links = parse(body);
        assert_eq!(links.len(), 1, "{links:?}");
        links.remove(0)
    }

    #[test]
    fn a_link_splits_on_the_first_slash_and_is_trimmed() {
        let link = one("See [[plant/Monstera in the study]].");
        assert_eq!(link.type_key, "plant");
        assert_eq!(link.title, "Monstera in the study");
        assert_eq!(link.inner, "plant/Monstera in the study");
    }

    #[test]
    fn a_title_may_contain_a_slash() {
        let link = one("[[plant/Fiddle/fig]]");
        assert_eq!(link.type_key, "plant");
        assert_eq!(link.title, "Fiddle/fig");
    }

    #[test]
    fn offsets_cover_the_whole_brackets() {
        let body = "a [[plant/Monstera]] b";
        let link = one(body);
        let text: String = body
            .chars()
            .skip(link.start)
            .take(link.end - link.start)
            .collect();
        assert_eq!(text, "[[plant/Monstera]]");
    }

    #[test]
    fn links_inside_a_fence_or_inline_code_are_text() {
        let body = "Outside [[plant/Monstera]].\n\n```rust\n[[plant/Ficus]]\n```\n\nAlso `[[plant/Fern]]` here.";
        let links = parse(body);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].title, "Monstera");
    }

    #[test]
    fn a_tilde_fence_is_skipped_too() {
        let body = "~~~\n[[plant/Ficus]]\n~~~\n[[plant/Monstera]]";
        let links = parse(body);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].title, "Monstera");
    }

    #[test]
    fn an_escaped_open_is_not_a_link() {
        assert!(parse(r"\[[plant/Monstera]]").is_empty());
    }

    #[test]
    fn malformed_links_are_not_links() {
        for body in [
            "[[]]",
            "[[plant/]]",
            "[[/Monstera]]",
            "[[plant]]",
            "[[Plant/Monstera]]",
            "[[plant/Monstera\n]]",
            "[[plant/Monstera]",
        ] {
            assert!(parse(body).is_empty(), "{body}");
        }
    }

    #[test]
    fn an_over_long_inner_text_is_not_a_link() {
        let title = "a".repeat(MAX_LINK_CHARS);
        let body = format!("[[plant/{title}]]");
        assert!(parse(&body).is_empty());
    }

    #[test]
    fn duplicate_occurrences_are_all_reported() {
        let body = "[[plant/Monstera]] then [[plant/Monstera]]";
        assert_eq!(parse(body).len(), 2);
    }

    #[test]
    fn an_excerpt_surrounds_the_link_and_collapses_whitespace() {
        let body = "The plant sits here.\n\nLinked to [[plant/Monstera]] in the corner.";
        let link = one(body);
        let excerpt = excerpt(body, link.start, link.end, 60);
        assert!(excerpt.contains("Monstera"), "{excerpt}");
        assert!(!excerpt.contains('\n'), "{excerpt}");
    }
}
