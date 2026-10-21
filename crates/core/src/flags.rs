//! Runtime feature flags: every flag is off unless a flags file turns it on.
//!
//! Mechanism: a plain-text file (`name = on|off`, `#` comments) whose path comes from
//! `DESIRE_FLAGS_FILE`. It is read again on every lookup, so a flag can be switched off in a
//! running server by editing the file — no restart, no new dependency. A missing variable or a
//! missing file means every flag is off: the old behaviour. A malformed file is an explicit error;
//! the caller decides to fall back to the default and must say so in its logs.

use std::collections::BTreeSet;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

/// Environment variable that points at the flags file.
pub const FLAGS_FILE_ENV: &str = "DESIRE_FLAGS_FILE";

/// A declared runtime flag. Its default is always off: new behaviour is opt-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Flag {
    pub name: &'static str,
    pub description: &'static str,
}

impl Flag {
    /// The value used when no flags file turns the flag on.
    pub const DEFAULT: bool = false;
}

/// Every flag the code base reads. Empty until the first runtime change ships behind a flag;
/// add the flag here and to `docs/flags.md` in the same change.
pub const REGISTRY: &[Flag] = &[];

/// Why a flags file could not be used.
#[derive(Debug)]
pub enum FlagError {
    Unreadable {
        path: PathBuf,
        source: io::Error,
    },
    Malformed {
        path: PathBuf,
        line: usize,
        text: String,
    },
}

impl fmt::Display for FlagError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreadable { path, source } => {
                write!(f, "flags file {} is unreadable: {source}", path.display())
            }
            Self::Malformed { path, line, text } => write!(
                f,
                "flags file {} line {line} is not `name = on|off`: {text:?}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for FlagError {}

/// The flags that are on, as read at one moment.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct FlagSet {
    enabled: BTreeSet<String>,
}

impl FlagSet {
    pub fn is_on(&self, flag: &Flag) -> bool {
        self.enabled.contains(flag.name)
    }
}

/// Where flags come from. `None` (no file configured) means every flag is off.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlagSource {
    path: Option<PathBuf>,
}

impl FlagSource {
    /// The source configured by `DESIRE_FLAGS_FILE`, or no source when the variable is unset.
    pub fn from_env() -> Self {
        Self {
            path: std::env::var_os(FLAGS_FILE_ENV).map(PathBuf::from),
        }
    }

    pub fn file(path: impl Into<PathBuf>) -> Self {
        Self {
            path: Some(path.into()),
        }
    }

    pub fn none() -> Self {
        Self { path: None }
    }

    /// Read the flags now. Called per lookup, so edits to the file apply without a restart.
    pub fn read(&self) -> Result<FlagSet, FlagError> {
        let Some(path) = &self.path else {
            return Ok(FlagSet::default());
        };
        match std::fs::read_to_string(path) {
            Ok(text) => parse(path, &text),
            Err(source) if source.kind() == io::ErrorKind::NotFound => Ok(FlagSet::default()),
            Err(source) => Err(FlagError::Unreadable {
                path: path.clone(),
                source,
            }),
        }
    }

    /// One flag, read now.
    pub fn is_on(&self, flag: &Flag) -> Result<bool, FlagError> {
        Ok(self.read()?.is_on(flag))
    }
}

/// Parse `name = on|off` lines. O(lines).
fn parse(path: &Path, text: &str) -> Result<FlagSet, FlagError> {
    let mut enabled = BTreeSet::new();
    for (index, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or_default().trim();
        if line.is_empty() {
            continue;
        }
        let malformed = || FlagError::Malformed {
            path: path.to_path_buf(),
            line: index + 1,
            text: raw.to_string(),
        };
        let (name, value) = line.split_once('=').ok_or_else(malformed)?;
        match value.trim() {
            "on" => enabled.insert(name.trim().to_string()),
            "off" => enabled.remove(name.trim()),
            _ => return Err(malformed()),
        };
    }
    Ok(FlagSet { enabled })
}
