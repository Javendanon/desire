#!/usr/bin/env bash
# Install exactly the toolchain rust-toolchain.toml pins (channel, components, targets).
# Fail-closed: a missing rustup or an unreadable channel is an error, never a skip.
set -euo pipefail

file="rust-toolchain.toml"
command -v rustup >/dev/null || { echo "::error::rustup is not available"; exit 1; }
test -f "$file" || { echo "::error::$file is missing"; exit 1; }

channel="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$file")"
test -n "$channel" || { echo "::error::no channel in $file"; exit 1; }

# Comma-separated lists from `components = [..]` / `targets = [..]`; passed explicitly because
# not every rustup version installs them from the file on its own.
list_of() { sed -n "s/^$1 *= *\[\(.*\)\]/\1/p" "$file" | tr -d '" '; }
components="$(list_of components)"
targets="$(list_of targets)"

args=(toolchain install "$channel" --profile minimal)
if [ -n "$components" ]; then args+=(--component "$components"); fi
if [ -n "$targets" ]; then args+=(--target "$targets"); fi
rustup "${args[@]}"
rustup show active-toolchain
rustc --version
cargo --version
