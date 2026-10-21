# syntax=docker/dockerfile:1

# Base images are pinned by index digest; refresh with
# `docker buildx imagetools inspect <tag>` and update the digest here.

# 1. The SPA. `npm ci` is its own layer so a source edit rebuilds only Vite.
FROM node:24@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0 AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2. The server. The first build compiles every dependency over stub sources;
#    the second then compiles only the two workspace crates.
FROM rust:1.98.1@sha256:a8a5f0a1e5fe7dfe1d352591e4a1c7dd2c08fd70475cae872cf3458ba0df0546 AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/core/Cargo.toml crates/core/Cargo.toml
COPY crates/server/Cargo.toml crates/server/Cargo.toml
RUN mkdir -p crates/core/src crates/server/src \
    && echo '' > crates/core/src/lib.rs \
    && echo 'fn main() {}' > crates/server/src/main.rs \
    && cargo build --release --locked
COPY crates ./crates
RUN touch crates/core/src/lib.rs crates/server/src/main.rs \
    && cargo build --release --locked

# 3. The runtime: the binary, the built SPA, and the data volume. Space content
#    is ordinary markdown under /data, so backing that directory up backs up
#    the whole app. The service runs as an unprivileged user whose ids match the
#    host directory owner by default; override the build args when they differ.
FROM debian:13-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS runtime
ARG UID=1000
ARG GID=1000
WORKDIR /app
ENV THING_BIND=0.0.0.0:8080 \
    THING_DATA_DIR=/data \
    THING_STATIC_DIR=/app/web/dist \
    THING_LOG=info
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid "${GID}" thing \
    && useradd --uid "${UID}" --gid "${GID}" --create-home --shell /usr/sbin/nologin thing \
    && mkdir -p /data \
    && chown thing:thing /data
COPY --from=build /app/target/release/thing-server /usr/local/bin/thing-server
COPY --from=web /app/web/dist /app/web/dist
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["curl", "-fsS", "http://127.0.0.1:8080/api/health"]
USER thing
CMD ["thing-server"]
