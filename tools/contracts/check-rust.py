"""Prueba el core exacto en un workspace temporal sin resolver Axum ni Wasm."""

from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix='desire-contracts-') as directory:
        isolated = Path(directory)
        shutil.copytree(ROOT / 'crates/core', isolated / 'crates/core')
        shutil.copytree(ROOT / 'contracts', isolated / 'contracts')
        (isolated / 'Cargo.toml').write_text('''[workspace]
members = ["crates/core"]
resolver = "3"
[workspace.package]
version = "0.1.0"
edition = "2024"
rust-version = "1.97"
publish = false
[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
''')
        subprocess.run(['cargo', 'test', '--offline'], cwd=isolated, check=True)
        subprocess.run(['cargo', 'clippy', '--offline', '--all-targets', '--', '-D', 'warnings'],
                       cwd=isolated, check=True)


if __name__ == '__main__':
    main()
