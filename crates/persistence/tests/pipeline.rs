//! The repository entry points must run through the disposable PostgreSQL harness.
//!
//! The integration tests in this crate fail closed without an isolated cluster, so any pipeline
//! that calls `cargo test --workspace` directly is red for the whole workspace. These checks keep
//! CI and the pnpm scripts pointed at `test-postgres.sh` instead of re-learning that the hard way.
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn repository_file(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(name);
    fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

fn scripts() -> Value {
    let manifest: Value = serde_json::from_str(&repository_file("package.json"))
        .expect("package.json must be valid JSON");
    manifest["scripts"].clone()
}

#[test]
fn ci_installs_postgres_and_runs_the_harness() {
    let workflow = repository_file(".github/workflows/ci.yml");
    let path_step = workflow
        .find("GITHUB_PATH")
        .expect("ci.yml must put the PostgreSQL binaries on PATH before the tests run");
    let harness = workflow
        .find("bash crates/persistence/test-postgres.sh")
        .expect("ci.yml must run the PostgreSQL harness, not bare cargo test");
    assert!(
        path_step < harness,
        "ci.yml puts PostgreSQL on PATH after the harness step"
    );
    assert!(
        !workflow.contains("cargo test --workspace"),
        "ci.yml runs cargo test without DESIRE_TEST_SOCKET; it fails closed by design"
    );
}

#[test]
fn ci_runs_every_existing_suite() {
    let workflow = repository_file(".github/workflows/ci.yml");
    for command in [
        "corepack pnpm run test:frontend",
        "corepack pnpm run check:tests",
        "python3 tools/contracts/generate.py --check",
        "python3 -m unittest discover -s tools/contracts/tests",
    ] {
        assert!(workflow.contains(command), "ci.yml never runs `{command}`");
    }
}

#[test]
fn package_scripts_route_rust_tests_through_the_harness() {
    let scripts = scripts();
    assert_eq!(
        scripts["test:rust"], "bash crates/persistence/test-postgres.sh",
        "pnpm test:rust must fail closed through the harness, like CI"
    );
    assert!(
        scripts["test"]
            .as_str()
            .unwrap_or_default()
            .contains("test:rust"),
        "pnpm test must still include the Rust suite"
    );
}
