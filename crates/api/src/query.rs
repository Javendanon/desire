//! Bounded pagination for every collection endpoint.
use crate::{error::ApiError, extract::Caller};
use serde::{Deserialize, Serialize};

pub const DEFAULT_LIMIT: u32 = 20;
pub const MAX_LIMIT: u32 = 100;
pub const MAX_OFFSET: u32 = 1_000_000;

#[derive(Debug, Default, Deserialize)]
pub struct PageQuery {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Copy)]
pub struct Page {
    limit: u32,
    offset: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PageBody<T> {
    pub items: Vec<T>,
    pub limit: u32,
    pub offset: u32,
    pub has_more: bool,
}

impl Page {
    pub fn from_query(query: &PageQuery, caller: &Caller) -> Result<Self, ApiError> {
        let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
        if !(1..=MAX_LIMIT).contains(&limit) {
            return Err(ApiError::invalid(
                caller,
                format!("limit must be between 1 and {MAX_LIMIT}"),
            ));
        }
        let offset = query.offset.unwrap_or(0);
        if offset > MAX_OFFSET {
            return Err(ApiError::invalid(
                caller,
                format!("offset must be at most {MAX_OFFSET}"),
            ));
        }
        Ok(Self { limit, offset })
    }

    /// Fetch one extra row to learn `has_more` without a second count query.
    pub fn fetch(self) -> (i64, i64) {
        (i64::from(self.limit) + 1, i64::from(self.offset))
    }

    pub fn finish<T>(self, mut items: Vec<T>) -> PageBody<T> {
        let has_more = items.len() > self.limit as usize;
        items.truncate(self.limit as usize);
        PageBody {
            items,
            limit: self.limit,
            offset: self.offset,
            has_more,
        }
    }
}
