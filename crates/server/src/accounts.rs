//! Accounts: users, sessions and invites in one SQLite file.
//!
//! Infrastructure only — no space content ever lands here. The schema is
//! versioned by `PRAGMA user_version` and walked as an ordered ladder, so a
//! database from an earlier build is upgraded in place.

use std::path::Path;
use std::sync::{Mutex, PoisonError};

use rusqlite::{Connection, OptionalExtension, params};
use thing_core::error::CoreError;
use thing_core::model::Role;
use thiserror::Error;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

/// One `CREATE TABLE` step per schema version, applied in order.
const LADDER: &[&str] = &["
    CREATE TABLE IF NOT EXISTS user (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invite (
        code TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        used_by TEXT,
        used_at TEXT
    );
"];

/// What the accounts layer can refuse.
#[derive(Debug, Error)]
pub enum AccountError {
    #[error("{0} is already registered")]
    EmailTaken(String),
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// A person, without their password hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
}

/// An invite code, before it is used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invite {
    pub code: String,
    pub space_id: Uuid,
    pub role: Role,
    pub created_by: Uuid,
    pub created_at: OffsetDateTime,
    pub expires_at: Option<OffsetDateTime>,
    pub used_by: Option<Uuid>,
    pub used_at: Option<OffsetDateTime>,
}

/// The `accounts.sqlite` file, behind one connection.
#[derive(Debug)]
pub struct Accounts {
    connection: Mutex<Connection>,
}

impl Accounts {
    /// Opens the database, creating and migrating it as needed.
    pub fn open(path: &Path) -> Result<Self, AccountError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        // The pragmas return a row, so they go through `execute_batch`.
        connection.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// An in-memory database, for tests.
    #[cfg(test)]
    pub fn in_memory() -> Result<Self, AccountError> {
        let connection = Connection::open_in_memory()?;
        migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// How many accounts the install has; the first one needs no invite.
    pub fn user_count(&self) -> Result<u64, AccountError> {
        let count = self
            .connection()
            .query_row("SELECT count(*) FROM user", [], |row| row.get::<_, i64>(0))?;
        Ok(count as u64)
    }

    pub fn create_user(
        &self,
        email: &str,
        name: &str,
        password_hash: &str,
        at: OffsetDateTime,
    ) -> Result<User, AccountError> {
        let user = User {
            id: Uuid::now_v7(),
            email: email.to_owned(),
            name: name.to_owned(),
        };
        let inserted = self.connection().execute(
            "INSERT OR IGNORE INTO user (id, email, name, password_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![user.id.to_string(), email, name, password_hash, stamp(at)?],
        )?;
        if inserted == 0 {
            return Err(AccountError::EmailTaken(email.to_owned()));
        }
        Ok(user)
    }

    pub fn user_by_id(&self, id: Uuid) -> Result<Option<User>, AccountError> {
        self.connection()
            .query_row(
                "SELECT id, email, name FROM user WHERE id = ?1",
                params![id.to_string()],
                user_from_row,
            )
            .optional()
            .map_err(AccountError::from)
    }

    /// The account and its password hash, for a sign-in attempt.
    pub fn credentials(&self, email: &str) -> Result<Option<(User, String)>, AccountError> {
        self.connection()
            .query_row(
                "SELECT id, email, name, password_hash FROM user WHERE email = ?1",
                params![email],
                |row| Ok((user_from_row(row)?, row.get::<_, String>(3)?)),
            )
            .optional()
            .map_err(AccountError::from)
    }

    /// Replaces one account's password hash; reports whether the email exists.
    pub fn set_password(&self, email: &str, password_hash: &str) -> Result<bool, AccountError> {
        let updated = self.connection().execute(
            "UPDATE user SET password_hash = ?2 WHERE email = ?1",
            params![email, password_hash],
        )?;
        Ok(updated > 0)
    }

    pub fn create_session(
        &self,
        token_hash: &str,
        user_id: Uuid,
        at: OffsetDateTime,
        expires_at: OffsetDateTime,
    ) -> Result<(), AccountError> {
        self.connection().execute(
            "INSERT INTO session (token_hash, user_id, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                token_hash,
                user_id.to_string(),
                stamp(at)?,
                stamp(expires_at)?
            ],
        )?;
        Ok(())
    }

    /// The account a session belongs to, deleting the session when it has expired.
    pub fn user_for_session(
        &self,
        token_hash: &str,
        now: OffsetDateTime,
    ) -> Result<Option<User>, AccountError> {
        let found = self
            .connection()
            .query_row(
                "SELECT user.id, user.email, user.name, session.expires_at
                 FROM session JOIN user ON user.id = session.user_id
                 WHERE session.token_hash = ?1",
                params![token_hash],
                |row| Ok((user_from_row(row)?, row.get::<_, String>(3)?)),
            )
            .optional()?;
        let Some((user, expires_at)) = found else {
            return Ok(None);
        };
        let expires_at = parse_stamp(&expires_at)?;
        if expires_at > now {
            return Ok(Some(user));
        }
        self.delete_session(token_hash)?;
        Ok(None)
    }

    pub fn delete_session(&self, token_hash: &str) -> Result<(), AccountError> {
        self.connection().execute(
            "DELETE FROM session WHERE token_hash = ?1",
            params![token_hash],
        )?;
        Ok(())
    }

    pub fn create_invite(
        &self,
        code: &str,
        space_id: Uuid,
        role: Role,
        created_by: Uuid,
        at: OffsetDateTime,
        expires_at: Option<OffsetDateTime>,
    ) -> Result<(), AccountError> {
        self.connection().execute(
            "INSERT INTO invite (code, space_id, role, created_by, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                code,
                space_id.to_string(),
                role.to_string(),
                created_by.to_string(),
                stamp(at)?,
                expires_at.map(stamp).transpose()?
            ],
        )?;
        Ok(())
    }

    pub fn invite(&self, code: &str) -> Result<Option<Invite>, AccountError> {
        self.connection()
            .query_row(
                "SELECT code, space_id, role, created_by, created_at, expires_at, used_by, used_at
                 FROM invite WHERE code = ?1",
                params![code],
                invite_from_row,
            )
            .optional()
            .map_err(AccountError::from)
    }

    pub fn invites_of_space(&self, space_id: Uuid) -> Result<Vec<Invite>, AccountError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT code, space_id, role, created_by, created_at, expires_at, used_by, used_at
             FROM invite WHERE space_id = ?1 ORDER BY created_at",
        )?;
        let invites = statement
            .query_map(params![space_id.to_string()], invite_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(invites)
    }

    /// Marks an invite used; reports whether it was still unused.
    pub fn mark_invite_used(
        &self,
        code: &str,
        user_id: Uuid,
        at: OffsetDateTime,
    ) -> Result<bool, AccountError> {
        let updated = self.connection().execute(
            "UPDATE invite SET used_by = ?2, used_at = ?3 WHERE code = ?1 AND used_by IS NULL",
            params![code, user_id.to_string(), stamp(at)?],
        )?;
        Ok(updated > 0)
    }

    /// Deletes an invite of this space; reports whether one was there.
    pub fn delete_invite(&self, space_id: Uuid, code: &str) -> Result<bool, AccountError> {
        let deleted = self.connection().execute(
            "DELETE FROM invite WHERE code = ?1 AND space_id = ?2",
            params![code, space_id.to_string()],
        )?;
        Ok(deleted > 0)
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

/// Applies every ladder step the database has not seen yet.
fn migrate(connection: &Connection) -> Result<(), rusqlite::Error> {
    let version = connection.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?;
    for (step, statements) in LADDER.iter().enumerate().skip(version as usize) {
        connection.execute_batch(statements)?;
        connection.pragma_update(None, "user_version", (step + 1) as u32)?;
    }
    Ok(())
}

fn user_from_row(row: &rusqlite::Row<'_>) -> Result<User, rusqlite::Error> {
    Ok(User {
        id: uuid_from_row(row, 0)?,
        email: row.get(1)?,
        name: row.get(2)?,
    })
}

fn invite_from_row(row: &rusqlite::Row<'_>) -> Result<Invite, rusqlite::Error> {
    Ok(Invite {
        code: row.get(0)?,
        space_id: uuid_from_row(row, 1)?,
        role: role_from_row(row, 2)?,
        created_by: uuid_from_row(row, 3)?,
        created_at: date_from_row(row, 4)?,
        expires_at: row
            .get::<_, Option<String>>(5)?
            .map(parse_row_stamp)
            .transpose()?,
        used_by: row
            .get::<_, Option<String>>(6)?
            .map(parse_row_uuid)
            .transpose()?,
        used_at: row
            .get::<_, Option<String>>(7)?
            .map(parse_row_stamp)
            .transpose()?,
    })
}

fn uuid_from_row(row: &rusqlite::Row<'_>, at: usize) -> Result<Uuid, rusqlite::Error> {
    parse_row_uuid(row.get(at)?)
}

fn date_from_row(row: &rusqlite::Row<'_>, at: usize) -> Result<OffsetDateTime, rusqlite::Error> {
    parse_row_stamp(row.get(at)?)
}

/// Reads a role by the one spelling core gives it; an unknown one is a bad row.
fn role_from_row(row: &rusqlite::Row<'_>, at: usize) -> Result<Role, rusqlite::Error> {
    let text: String = row.get(at)?;
    text.parse::<Role>().map_err(|err: CoreError| {
        rusqlite::Error::FromSqlConversionFailure(at, rusqlite::types::Type::Text, Box::new(err))
    })
}

fn parse_row_uuid(text: String) -> Result<Uuid, rusqlite::Error> {
    Uuid::parse_str(&text).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

fn parse_row_stamp(text: String) -> Result<OffsetDateTime, rusqlite::Error> {
    parse_stamp(&text)
}

fn parse_stamp(text: &str) -> Result<OffsetDateTime, rusqlite::Error> {
    OffsetDateTime::parse(text, &Rfc3339).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

fn stamp(at: OffsetDateTime) -> Result<String, AccountError> {
    at.format(&Rfc3339)
        .map_err(|err| rusqlite::Error::ToSqlConversionFailure(Box::new(err)).into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_800_000_000).expect("a fixed instant")
    }

    #[test]
    fn a_fresh_database_starts_at_the_current_schema_version() {
        let accounts = Accounts::in_memory().expect("opens");
        assert_eq!(accounts.user_count().expect("counts"), 0);
        let version: u32 = accounts
            .connection()
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("reads the version");
        assert_eq!(version as usize, LADDER.len());
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        let accounts = Accounts::in_memory().expect("opens");
        migrate(&accounts.connection()).expect("migrates again");
        assert_eq!(accounts.user_count().expect("counts"), 0);
    }

    #[test]
    fn one_email_can_register_once() {
        let accounts = Accounts::in_memory().expect("opens");
        accounts
            .create_user("a@b.c", "Talon", "hash", at())
            .expect("registers");
        let refused = accounts.create_user("a@b.c", "Someone else", "hash", at());
        assert!(matches!(refused, Err(AccountError::EmailTaken(email)) if email == "a@b.c"));
        assert_eq!(accounts.user_count().expect("counts"), 1);
    }

    #[test]
    fn a_session_resolves_until_it_expires_and_is_then_deleted() {
        let accounts = Accounts::in_memory().expect("opens");
        let user = accounts
            .create_user("a@b.c", "Talon", "hash", at())
            .expect("registers");
        accounts
            .create_session(
                "hash-of-token",
                user.id,
                at(),
                at() + time::Duration::hours(1),
            )
            .expect("stores the session");

        let seen = accounts
            .user_for_session("hash-of-token", at() + time::Duration::minutes(30))
            .expect("reads");
        assert_eq!(seen, Some(user.clone()));

        let expired = accounts
            .user_for_session("hash-of-token", at() + time::Duration::hours(2))
            .expect("reads");
        assert_eq!(expired, None);
        let rows: i64 = accounts
            .connection()
            .query_row("SELECT count(*) FROM session", [], |row| row.get(0))
            .expect("counts");
        assert_eq!(rows, 0, "an expired session is deleted on use");
    }

    #[test]
    fn an_invite_is_used_once_and_only_by_its_space() {
        let accounts = Accounts::in_memory().expect("opens");
        let space = Uuid::now_v7();
        let other = Uuid::now_v7();
        let owner = Uuid::now_v7();
        accounts
            .create_invite("code", space, Role::Editor, owner, at(), None)
            .expect("stores the invite");

        assert!(!accounts.delete_invite(other, "code").expect("deletes"));
        let stored = accounts.invite("code").expect("reads").expect("exists");
        assert_eq!(stored.space_id, space);
        assert_eq!(stored.role, Role::Editor);
        assert_eq!(stored.expires_at, None);

        assert!(
            accounts
                .mark_invite_used("code", owner, at())
                .expect("marks")
        );
        assert!(
            !accounts
                .mark_invite_used("code", owner, at())
                .expect("marks")
        );
        assert_eq!(
            accounts
                .invite("code")
                .expect("reads")
                .expect("exists")
                .used_by,
            Some(owner)
        );
        assert!(accounts.delete_invite(space, "code").expect("deletes"));
    }

    #[test]
    fn setting_a_password_reports_whether_the_email_exists() {
        let accounts = Accounts::in_memory().expect("opens");
        accounts
            .create_user("a@b.c", "Talon", "old", at())
            .expect("registers");
        assert!(accounts.set_password("a@b.c", "new").expect("updates"));
        assert!(!accounts.set_password("nobody@b.c", "new").expect("updates"));
        let (_, hash) = accounts
            .credentials("a@b.c")
            .expect("reads")
            .expect("exists");
        assert_eq!(hash, "new");
    }
}
