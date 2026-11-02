//! Contextual adapter errors with redacted display and inspectable SQLSTATE.
use std::{error::Error as StdError, fmt};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    Database,
    Conflict,
    InvalidMigration,
    SeedMismatch,
    Serialization,
}

pub struct Error {
    pub kind: ErrorKind,
    pub context: String,
    pub sqlstate: Option<String>,
    source: Option<Box<dyn StdError + Send + Sync>>,
}

impl Error {
    pub(crate) fn new(kind: ErrorKind, context: impl Into<String>) -> Self {
        Self {
            kind,
            context: context.into(),
            sqlstate: None,
            source: None,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:?}: {}", self.kind, self.context)?;
        if let Some(code) = &self.sqlstate {
            write!(formatter, " (SQLSTATE {code})")?;
        }
        Ok(())
    }
}

impl fmt::Debug for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, formatter)
    }
}

impl StdError for Error {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        self.source.as_deref().map(|source| source as &dyn StdError)
    }
}

pub(crate) trait Context<T> {
    fn context(self, context: impl Into<String>) -> Result<T, Error>;
}

impl<T, E: StdError + Send + Sync + 'static> Context<T> for Result<T, E> {
    fn context(self, context: impl Into<String>) -> Result<T, Error> {
        self.map_err(|source| {
            let database = (&source as &dyn StdError).downcast_ref::<postgres::Error>();
            let sqlstate = database
                .and_then(|error| error.code())
                .map(|code| code.code().into());
            let kind = if database.is_some() {
                ErrorKind::Database
            } else {
                ErrorKind::Serialization
            };
            Error {
                kind,
                context: context.into(),
                sqlstate,
                source: Some(Box::new(source)),
            }
        })
    }
}
