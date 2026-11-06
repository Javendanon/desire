//! Validated campaign path. D06 confirmed `CAM` with `Accept: application/json`; the path
//! includes a slug, so the adapter accepts the visible path instead of inventing an endpoint.

const PREFIX: &str = "/games/dnd-5/campaigns/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CampaignPath {
    pub external_id: i64,
    pub path: String,
}

pub fn parse_path(raw: &str) -> Result<CampaignPath, String> {
    if raw.trim() != raw {
        return Err("source_path must not have surrounding whitespace".into());
    }
    let Some(segment) = raw.strip_prefix(PREFIX) else {
        return Err(format!("source_path must start with {PREFIX}"));
    };
    if segment.is_empty() || !valid_segment(segment) {
        return Err("source_path must be one campaign slug".into());
    }
    let id_part = segment.split_once('-').map_or(segment, |(id, _)| id);
    let external_id: i64 = id_part
        .parse()
        .map_err(|_| "source_path must start with a numeric campaign id".to_string())?;
    if external_id <= 0 || id_part.starts_with('0') {
        return Err("source_path campaign id must be positive".into());
    }
    Ok(CampaignPath {
        external_id,
        path: raw.to_string(),
    })
}

fn valid_segment(segment: &str) -> bool {
    segment != "."
        && segment != ".."
        && !segment.contains("..")
        && segment.chars().all(segment_char)
}

fn segment_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.' | '~')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_verified_path_and_the_numeric_form() {
        let slug = parse_path("/games/dnd-5/campaigns/109662-synthetic").unwrap();
        assert_eq!(slug.external_id, 109_662);
        assert_eq!(slug.path, "/games/dnd-5/campaigns/109662-synthetic");

        let numeric = parse_path("/games/dnd-5/campaigns/109662").unwrap();
        assert_eq!(numeric.external_id, 109_662);
    }

    #[test]
    fn rejects_other_origins_traversal_queries_and_invalid_ids() {
        for value in [
            "https://nivel20.com/games/dnd-5/campaigns/1-x",
            "/campaigns/1-x",
            "/games/dnd-5/campaigns/",
            "/games/dnd-5/campaigns/../secret",
            "/games/dnd-5/campaigns/1-x/extra",
            "/games/dnd-5/campaigns/1-x?query=1",
            "/games/dnd-5/campaigns/1-x#fragment",
            "/games/dnd-5/campaigns/abc",
            "/games/dnd-5/campaigns/0",
            "/games/dnd-5/campaigns/01",
            " /games/dnd-5/campaigns/1-x",
        ] {
            assert!(parse_path(value).is_err(), "{value}");
        }
    }
}
