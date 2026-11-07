# syntax=docker/dockerfile:1

# One image serves the API and the compiled frontend. Build stages install their own
# toolchain; the runtime stage carries only the binary, the static build and CA roots.

# --- frontend: Wasm, type checks and the Vite bundle -------------------------
FROM rust:1.97.1-bookworm AS frontend
# Reuse the official Node distribution instead of adding a package repository.
COPY --from=node:24-bookworm-slim /usr/local /usr/local
WORKDIR /build
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    rustup target add wasm32-unknown-unknown \
    && cargo install wasm-pack --version 0.15.0 --locked

# Dependencies first, so a source-only change keeps this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# Only /usr/local was copied, so the Node image's yarn symlinks point nowhere.
RUN rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && corepack enable \
    && corepack pnpm install --frozen-lockfile
COPY . .
RUN corepack pnpm build

# --- api: release binary with the migrations embedded at compile time --------
FROM rust:1.97.1-bookworm AS api
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY migrations ./migrations
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --locked --release -p desire-api \
    && cp target/release/desire-api /usr/local/bin/desire-api

# --- runtime: binary, static files and CA roots only -------------------------
FROM debian:bookworm-slim AS runtime
# The build image is the same Debian release, so its CA bundle avoids an apt round trip
# and keeps the runtime image free of a package manager.
COPY --from=api /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
WORKDIR /app
COPY --from=api /usr/local/bin/desire-api /usr/local/bin/desire-api
COPY --from=frontend /build/dist ./static
# Runtime flags: one file, re-read on every lookup, so serving the frontend can be switched
# off on a running machine without a rebuild. Unset, every flag is off (docs/flags.md).
RUN printf 'static_site = on\n' > /app/flags.txt \
    && chown 10001:10001 /app/flags.txt
ENV HOST=0.0.0.0 \
    PORT=8080 \
    DESIRE_STATIC_DIR=/app/static \
    DESIRE_FLAGS_FILE=/app/flags.txt
EXPOSE 8080
# No package manager, shell tools or write access needed at runtime.
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/desire-api"]
