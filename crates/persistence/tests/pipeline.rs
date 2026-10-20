//! The repository entry points must run through the disposable PostgreSQL harness.
//!
//! The integration tests in this crate fail closed without an isolated cluster, so any pipeline
//! that calls `cargo test --workspace` directly is red for the whole workspace. These checks keep
//! CI, the merge-policy gate and the pnpm scripts pointed at `test-postgres.sh` instead of
//! re-learning that the hard way.
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

const HARNESS: &str = "bash crates/persistence/test-postgres.sh";

fn repository_file(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(name);
    fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

fn json(name: &str) -> Value {
    serde_json::from_str(&repository_file(name))
        .unwrap_or_else(|error| panic!("{name} must be valid JSON: {error}"))
}

/// The `run` steps of one CI job, so neither a comment nor a neighbouring job can satisfy a
/// check. Comment lines are dropped, including shell comments inside a step's `run` block.
fn job(workflow: &str, name: &str) -> String {
    let start = workflow
        .lines()
        .position(|line| line == format!("  {name}:"))
        .unwrap_or_else(|| panic!("ci.yml has no `{name}` job"));
    let steps: Vec<&str> = workflow
        .lines()
        .skip(start + 1)
        .take_while(|line| !is_job_header(line))
        .filter(|line| !line.trim_start().starts_with('#'))
        .collect();
    steps.join("\n")
}

fn is_job_header(line: &str) -> bool {
    line.starts_with("  ") && !line.starts_with("   ") && line.ends_with(':')
}

/// A step has to invoke the command, not mention it. A commented-out line, an `echo`, or a
/// multi-line `name:` that contains the command does not count.
fn runs(steps: &str, command: &str) -> bool {
    let mut block: Option<usize> = None;
    for line in steps.lines() {
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        let text = trimmed.strip_prefix("- ").unwrap_or(trimmed);
        if block.is_some_and(|key| indent <= key) {
            block = None;
        }
        if let Some(value) = text.strip_prefix("run:") {
            if value.trim() == command {
                return true;
            }
            block = value.trim().starts_with(['|', '>']).then_some(indent);
        } else if block.is_some() && text.trim_end() == command {
            return true;
        }
    }
    false
}

#[test]
fn only_run_steps_satisfy_the_guard() {
    assert!(runs("        run: cargo fmt --all\n", "cargo fmt --all"));
    assert!(runs(
        "        run: |\n          cargo fmt --all\n",
        "cargo fmt --all"
    ));
    assert!(runs(
        "      - run: |\n          cargo fmt --all\n",
        "cargo fmt --all"
    ));
    assert!(!runs("        name: cargo fmt --all\n", "cargo fmt --all"));
    assert!(
        !runs("        run: cargo fmt --all || true\n", "cargo fmt --all"),
        "a step that swallows failures is not the command"
    );
    assert!(!runs(
        "        run: echo cargo fmt --all\n",
        "cargo fmt --all"
    ));
}

#[test]
fn comments_do_not_satisfy_the_guard() {
    let workflow = concat!(
        "jobs:\n  rust-test:\n    - run: |\n",
        "        # cargo test --workspace\n",
        "        bash crates/persistence/test-postgres.sh\n",
        "    - run: echo bash crates/persistence/test-postgres.sh\n",
        "  next:\n",
    );
    let steps = job(workflow, "rust-test");
    assert!(
        runs(&steps, HARNESS),
        "the guard reads the step, not a comment"
    );
    assert!(
        !steps.contains("cargo test"),
        "a commented-out command is not a step"
    );
    let echo = "    - run: echo bash crates/persistence/test-postgres.sh\n";
    assert!(
        !runs(echo, HARNESS),
        "a step that echoes the command is not a run"
    );
}

#[test]
fn rust_tests_run_through_the_postgres_harness() {
    let workflow = repository_file(".github/workflows/ci.yml");
    let steps = job(&workflow, "rust-test");
    let binaries = steps
        .find("GITHUB_PATH")
        .expect("the rust-test job must put the PostgreSQL binaries on PATH");
    let harness = steps
        .find(HARNESS)
        .expect("the rust-test job must run the PostgreSQL harness, not bare cargo test");
    assert!(
        binaries < harness,
        "PostgreSQL is on PATH after the harness runs"
    );
    assert!(
        runs(&steps, HARNESS),
        "the rust-test job must run the harness"
    );
    assert!(
        !steps.contains("cargo test --workspace"),
        "the rust-test job runs cargo test without DESIRE_TEST_SOCKET; it fails closed"
    );
}

#[test]
fn merge_policy_rust_gate_runs_the_harness() {
    let policy = json("merge-policy.json");
    let gate = policy["gates"]
        .as_array()
        .expect("merge-policy.json must list gates")
        .iter()
        .find(|gate| gate["name"] == "rust-test")
        .expect("merge-policy.json must keep the `rust-test` gate name the CI job uses");
    assert_eq!(
        gate["cmd"], HARNESS,
        "the local gate runs the same command as the CI job of the same name"
    );
}

#[test]
fn ci_runs_every_existing_suite() {
    let workflow = repository_file(".github/workflows/ci.yml");
    for (name, command) in [
        ("frontend-check", "corepack pnpm run test:frontend"),
        ("frontend-check", "corepack pnpm run check:tests"),
        (
            "quality-gate",
            "python3 tools/contracts/generate.py --check",
        ),
        (
            "quality-gate",
            "python3 -m unittest discover -s tools/contracts/tests -p 'test_*.py'",
        ),
    ] {
        assert!(
            runs(&job(&workflow, name), command),
            "the {name} job never runs `{command}`"
        );
    }
}

#[test]
fn package_scripts_route_rust_tests_through_the_harness() {
    let scripts = json("package.json")["scripts"].clone();
    assert_eq!(
        scripts["test:rust"], HARNESS,
        "pnpm test:rust must fail closed through the harness, like CI"
    );
    assert_eq!(
        scripts["test"], "pnpm run test:frontend && pnpm run test:rust",
        "pnpm test must still run the frontend suite first, then the harness"
    );
}
