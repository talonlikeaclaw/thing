//! Filename slugs: `objects/<type-key>/<slug>.md`.
//!
//! A slug is lowercase ASCII letters and digits joined by single `-`. Anything
//! else collapses into a separator, so two different titles may slugify to the
//! same string; `unique_slug` disambiguates within a type.

/// Longest slug, suffix included.
pub const MAX_SLUG_LEN: usize = 60;

/// Slug for a title that has no ASCII letters or digits.
pub const EMPTY_SLUG: &str = "untitled";

/// Lowercases a title and collapses every run of other characters into `-`.
pub fn slugify(title: &str) -> String {
    let mut slug = String::with_capacity(title.len());
    let mut separator = false;
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            if separator && !slug.is_empty() {
                slug.push('-');
            }
            separator = false;
            slug.push(ch.to_ascii_lowercase());
        } else {
            separator = !slug.is_empty();
        }
    }
    truncate(&mut slug, MAX_SLUG_LEN);
    if slug.is_empty() {
        EMPTY_SLUG.to_owned()
    } else {
        slug
    }
}

/// Returns `base`, or `base-2`, `base-3`, ... — the first not present in `taken`.
pub fn unique_slug<'a>(base: &str, taken: impl Iterator<Item = &'a str>) -> String {
    let base = if base.is_empty() { EMPTY_SLUG } else { base };
    let taken: std::collections::HashSet<&str> = taken.collect();
    if !taken.contains(base) {
        return base.to_owned();
    }
    let mut n = 2u32;
    loop {
        let suffix = format!("-{n}");
        let mut candidate = base.to_owned();
        truncate(&mut candidate, MAX_SLUG_LEN - suffix.len());
        while candidate.ends_with('-') {
            candidate.pop();
        }
        candidate.push_str(&suffix);
        if !taken.contains(candidate.as_str()) {
            return candidate;
        }
        n += 1;
    }
}

/// Longest type or property key, leading character included.
pub const MAX_KEY_LEN: usize = 40;

/// The prefix a name that cannot start a key gets: a key begins with a letter,
/// so `2026 goals` derives `key_2026_goals` rather than an illegal `2026_goals`.
pub const KEY_PREFIX: &str = "key_";

/// Whether `key` is a legal type or property key: `^[a-z][a-z0-9_]{0,39}$`.
pub fn is_valid_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() => {}
        _ => return false,
    }
    key.len() <= MAX_KEY_LEN
        && chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
}

/// The key a display name derives: lowercased, every run of other characters
/// folded to one `_`, trimmed of separators and cut to [`MAX_KEY_LEN`].
///
/// A name with nothing to keep is [`EMPTY_SLUG`], the same word a title with no
/// letters slugs to; a name that would start the key with a digit is prefixed
/// with [`KEY_PREFIX`], because a key must start with a letter.
pub fn key_from_name(name: &str) -> String {
    let mut key = String::with_capacity(name.len());
    let mut separator = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if separator && !key.is_empty() {
                key.push('_');
            }
            separator = false;
            key.push(ch.to_ascii_lowercase());
        } else {
            separator = !key.is_empty();
        }
    }
    while key.ends_with('_') {
        key.pop();
    }
    if key.is_empty() {
        return EMPTY_SLUG.to_owned();
    }
    if !key.starts_with(|ch: char| ch.is_ascii_lowercase()) {
        key.insert_str(0, KEY_PREFIX);
    }
    truncate(&mut key, MAX_KEY_LEN);
    while key.ends_with('_') {
        key.pop();
    }
    key
}

/// Truncates at a character boundary, never past `max` bytes.
fn truncate(s: &mut String, max: usize) {
    if let Some((cut, _)) = s.char_indices().nth(max) {
        s.truncate(cut);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowercases_and_separates_words() {
        assert_eq!(slugify("Monstera in the study"), "monstera-in-the-study");
    }

    #[test]
    fn collapses_runs_of_punctuation() {
        assert_eq!(slugify("  Room // 2 -- !!  window "), "room-2-window");
    }

    #[test]
    fn drops_leading_and_trailing_separators() {
        assert_eq!(slugify("---watering 7d---"), "watering-7d");
    }

    #[test]
    fn keeps_digits() {
        assert_eq!(slugify("Q3 2026"), "q3-2026");
    }

    #[test]
    fn non_ascii_letters_become_separators() {
        assert_eq!(slugify("Café au lait"), "caf-au-lait");
        assert_eq!(slugify("🪴 Monstera"), "monstera");
    }

    #[test]
    fn title_without_ascii_alphanumerics_is_untitled() {
        assert_eq!(slugify("日本語"), EMPTY_SLUG);
        assert_eq!(slugify("!!!"), EMPTY_SLUG);
        assert_eq!(slugify(""), EMPTY_SLUG);
    }

    #[test]
    fn truncates_to_max_length() {
        let long = "a".repeat(100);
        assert_eq!(slugify(&long).len(), MAX_SLUG_LEN);
    }

    #[test]
    fn keeps_base_when_free() {
        assert_eq!(unique_slug("plant", ["tree"].into_iter()), "plant");
    }

    #[test]
    fn appends_the_first_free_counter() {
        assert_eq!(
            unique_slug("plant", ["plant", "plant-2"].into_iter()),
            "plant-3"
        );
    }

    #[test]
    fn suffix_fits_inside_max_length() {
        let base = "a".repeat(MAX_SLUG_LEN);
        let taken = [base.as_str()];
        let chosen = unique_slug(&base, taken.into_iter());
        assert_eq!(chosen.len(), MAX_SLUG_LEN);
        assert!(chosen.ends_with("-2"));
        assert_ne!(chosen, base);
    }

    #[test]
    fn empty_base_falls_back_to_untitled() {
        assert_eq!(unique_slug("", [].into_iter()), EMPTY_SLUG);
        assert_eq!(unique_slug("", [EMPTY_SLUG].into_iter()), "untitled-2");
    }

    #[test]
    fn a_key_is_lowercase_letters_digits_and_underscores() {
        for key in [
            "plant",
            "watering_interval_days",
            "q3_total",
            "a",
            &"a".repeat(40),
        ] {
            assert!(is_valid_key(key), "{key}");
        }
        for key in [
            "",
            "Plant",
            "1plant",
            "_plant",
            "plant-2",
            "plant care",
            "plant.care",
            &"a".repeat(41),
        ] {
            assert!(!is_valid_key(key), "{key}");
        }
    }

    #[test]
    fn a_key_from_a_name_folds_separators_and_lowercases() {
        assert_eq!(
            key_from_name("Watering interval days"),
            "watering_interval_days"
        );
        assert_eq!(key_from_name("  Room // 2 -- window "), "room_2_window");
        assert_eq!(key_from_name("Last watered"), "last_watered");
    }

    #[test]
    fn a_key_from_a_name_is_always_a_valid_key() {
        for name in [
            "Plant",
            "2026 goals",
            "3D printer",
            "日本語",
            "!!!",
            "   ",
            &"-".repeat(200),
        ] {
            let key = key_from_name(name);
            assert!(is_valid_key(&key), "{name} derived {key}");
        }
        assert_eq!(key_from_name("2026 goals"), "key_2026_goals");
        assert_eq!(key_from_name("3d printer"), "key_3d_printer");
        assert_eq!(key_from_name("日本語"), EMPTY_SLUG);
        assert_eq!(key_from_name(""), EMPTY_SLUG);
    }

    #[test]
    fn a_key_from_a_name_keeps_the_prefix_inside_the_length_limit() {
        let key = key_from_name(&format!("2026 {}", "a".repeat(100)));
        assert!(is_valid_key(&key), "{key}");
        assert_eq!(key.len(), MAX_KEY_LEN);
        assert!(key.starts_with(KEY_PREFIX));
    }
}
