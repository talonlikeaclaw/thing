//! The six highlight palettes a space may choose.
//!
//! One list, shared by the API's validation and the SPA's picker, so a preset
//! the server refuses can never be offered in the interface. The palettes
//! themselves (dark and light values, plus their ink) live in `globals.css`.

/// The preset ids; `lichen` is the default when a space has no accent.
pub const ACCENT_IDS: &[&str] = &["lichen", "yellow", "orange", "cyan", "green", "pink"];

/// Whether `raw` names a palette this build knows, after trimming and
/// lowercasing. A refused value is not repaired: custom colours stay out.
pub fn is_accent(raw: &str) -> bool {
    let raw = raw.trim().to_ascii_lowercase();
    ACCENT_IDS.contains(&raw.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_preset_id_is_accepted() {
        for id in ACCENT_IDS {
            assert!(is_accent(id), "{id} is a preset");
        }
    }

    #[test]
    fn an_uppercase_name_normalizes() {
        assert!(is_accent("CYAN"));
        assert!(is_accent("  Cyan  "));
    }

    #[test]
    fn empty_unknown_and_hex_values_are_refused() {
        assert!(!is_accent(""));
        assert!(!is_accent("chartreuse"));
        assert!(!is_accent("#c8d96b"));
    }
}
