//! Typed routing failures with enough context to fix the caller.

use std::fmt;

/// Why a route could not be produced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RoutingError {
    /// Width or height is zero.
    EmptyGrid,
    /// The grid exceeds the bounded-transfer limit.
    GridTooLarge { cells: u64 },
    /// The cost buffer does not match `width * height`.
    BufferLengthMismatch { expected: usize, actual: usize },
    /// D04 revisions are positive integers.
    InvalidRevision,
    /// Request identifiers are positive; zero never names a live request.
    InvalidRequestId,
    /// The start cell lies outside the grid.
    StartOutOfBounds { x: u32, y: u32 },
    /// The goal cell lies outside the grid.
    GoalOutOfBounds { x: u32, y: u32 },
    /// The start cell uses the blocked sentinel.
    StartBlocked { x: u32, y: u32 },
    /// The goal cell uses the blocked sentinel.
    GoalBlocked { x: u32, y: u32 },
    /// No four-neighbour path connects start and goal.
    NoPath,
    /// Accumulated cost exceeded the `u32` transfer contract.
    CostOverflow,
    /// Internal invariant: a reconstructed cell lost its predecessor.
    InvalidSearchState { cell: u32 },
}

impl fmt::Display for RoutingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyGrid => write!(formatter, "grid width and height must be positive"),
            Self::GridTooLarge { cells } => {
                write!(formatter, "grid has {cells} cells, above limit")
            }
            Self::BufferLengthMismatch { expected, actual } => write!(
                formatter,
                "buffer length {actual} does not match expected {expected}"
            ),
            Self::InvalidRevision => write!(formatter, "revision must be a positive integer"),
            Self::InvalidRequestId => write!(formatter, "request id must be a positive integer"),
            Self::StartOutOfBounds { x, y } => {
                write!(formatter, "start cell ({x}, {y}) is outside the grid")
            }
            Self::GoalOutOfBounds { x, y } => {
                write!(formatter, "goal cell ({x}, {y}) is outside the grid")
            }
            Self::StartBlocked { x, y } => write!(formatter, "start cell ({x}, {y}) is blocked"),
            Self::GoalBlocked { x, y } => write!(formatter, "goal cell ({x}, {y}) is blocked"),
            Self::NoPath => write!(formatter, "no route connects the requested cells"),
            Self::CostOverflow => write!(formatter, "route cost exceeds the u32 transfer contract"),
            Self::InvalidSearchState { cell } => {
                write!(formatter, "search state lost predecessor of cell {cell}")
            }
        }
    }
}

impl std::error::Error for RoutingError {}
