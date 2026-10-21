# syntax=docker/dockerfile:1

# Development image: Rust 1.98.1 and Node 24 in one container, with cargo-watch
# for server restarts and Vite's dev server for hot module replacement.
FROM node:24@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0 AS node

FROM rust:1.98.1@sha256:a8a5f0a1e5fe7dfe1d352591e4a1c7dd2c08fd70475cae872cf3458ba0df0546

ARG UID=1000
ARG GID=1000

RUN apt-get update \
    && apt-get install -y --no-install-recommends less \
    && rm -rf /var/lib/apt/lists/* \
    && rustup component add rustfmt clippy \
    && cargo install cargo-watch --locked --version 8.5.3 \
    && groupadd --gid "${GID}" dev \
    && useradd --uid "${UID}" --gid "${GID}" --create-home --shell /bin/bash dev \
    && chown -R dev:dev /usr/local/cargo

# Node and npm are copied from the official image so both toolchains share the
# same container; no NodeSource repository or second runtime.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

USER dev
WORKDIR /workspaces/thing
CMD ["bash", "scripts/dev-serve.sh"]
