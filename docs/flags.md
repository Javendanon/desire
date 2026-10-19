# Runtime feature flags

Every change with an effect at runtime ships behind a flag that is **off by default**. A revert
undoes code; a flag undoes behaviour in a running server, and it is the only cheap way to make a
merged runtime change reversible in practice.

## Mechanism

`desire_core::flags` (`crates/core/src/flags.rs`). A plain-text file, one flag per line:

```text
# flags.txt
sector_labels = on
fog_of_war = off
```

- The path comes from `DESIRE_FLAGS_FILE`. No variable, or no file at that path, means every flag
  is off: the behaviour before the flag existed.
- The file is read again on every lookup, so editing it takes effect without a restart.
- A malformed line (`name = yes`) is an explicit `FlagError::Malformed` with the line number. The
  caller falls back to the default (off) and logs the error; it never guesses.

Why this and not something else: environment variables cannot change in a running process,
and a database table adds a migration and a dependency on Postgres being up just to read a
boolean. A text file re-read per lookup is hot-switchable, has no dependency, and its absence is
the safe state.

## Declaring a flag

1. Add a `Flag` constant and list it in `REGISTRY` in `crates/core/src/flags.rs`:

   ```rust
   pub const SECTOR_LABELS: Flag = Flag {
       name: "sector_labels",
       description: "render sector labels on the city map",
   };
   pub const REGISTRY: &[Flag] = &[SECTOR_LABELS];
   ```

2. Read it where the behaviour forks, with the old behaviour on the off branch:

   ```rust
   let source = FlagSource::from_env();
   let on = source.is_on(&SECTOR_LABELS).unwrap_or_else(|error| {
       eprintln!("flags: {error}; using the default (off)");
       Flag::DEFAULT
   });
   ```

3. Add the flag to the table below in the same change.

The default lives in one place, `Flag::DEFAULT`, and it is `false` for every flag. There is no
per-flag default on purpose: a flag that starts on is not a safety net.

## Switching a flag off in a running server

Edit the file `DESIRE_FLAGS_FILE` points at and set the flag to `off` (or delete the line). The
next lookup reads the new value. No restart, no deploy.

## Merge rule

A runtime change without a flag is not auto-mergeable: under `merge-policy.json` it is treated
as `T2-never` and goes to a human. The loop cannot yet detect "runtime change without a flag"
from a diff, so the reviewer raises it as a blocking finding (coordinated with D25, whose
`docs/merge-policy.md` states the same rule).

## Flags

| Flag | Default | Where the default lives | Purpose |
| --- | --- | --- | --- |
| *(none yet)* | off | `Flag::DEFAULT` in `crates/core/src/flags.rs` | — |

The tests in `crates/core/tests/flags.rs` use a test-only flag, `sector_labels`, which is not part
of `REGISTRY`.
