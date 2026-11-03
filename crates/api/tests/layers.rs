//! The HTTP layer consumes typed repositories; it must not issue business SQL.
use std::path::Path;

const DATABASE_CALLS: [&str; 11] = [
    ".query(",
    ".query_one(",
    ".query_opt(",
    ".execute(",
    ".batch_execute(",
    ".simple_query(",
    ".transaction(",
    ".build_transaction(",
    ".prepare(",
    ".copy_in(",
    ".copy_out(",
];

fn violations(source: &str) -> Vec<&str> {
    DATABASE_CALLS
        .iter()
        .copied()
        .filter(|call| source.contains(call))
        .chain(
            ["::Row", "::ToSql"]
                .into_iter()
                .filter(|ty| source.contains(ty)),
        )
        .collect()
}

fn inspect(path: &Path) {
    for entry in std::fs::read_dir(path).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            inspect(&path);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            let source = std::fs::read_to_string(&path).unwrap();
            // The database bridge may ping its connection, but business queries stay in repositories.
            let source = if path.file_name().unwrap() == "db.rs" {
                source.replace(".simple_query(\"SELECT 1\")", "")
            } else {
                source
            };
            assert!(
                violations(&source).is_empty(),
                "SQL boundary: {}: {:?}",
                path.display(),
                violations(&source)
            );
        }
    }
}

#[test]
fn api_business_code_uses_typed_persistence_repositories() {
    inspect(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"));
}

#[test]
fn boundary_guard_detects_database_execution_and_row_types() {
    assert_eq!(violations("client.query(sql, params);"), vec![".query("]);
    assert_eq!(violations("client.transaction();"), vec![".transaction("]);
    assert_eq!(violations("postgres::Row"), vec!["::Row"]);
    assert_eq!(violations("Page::from_query(&query)"), Vec::<&str>::new());
}
