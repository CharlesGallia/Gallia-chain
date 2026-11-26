#!/usr/bin/env bash
# Compile le nœud Gallia dans un conteneur Rust (rien n'est installé sur le serveur lui-même).
# Usage : ./gallia-build.sh [fast]   (fast = périodes raccourcies, pour les tests locaux uniquement)
set -euo pipefail
cd "$(dirname "$0")"
FEATURES="gtest"; [[ "${1:-}" == fast ]] && FEATURES="gtest,fast"
exec docker run --rm --name gallia-build --cpus=3 \
  -v "$PWD":/src -v "$HOME/gallia-build/cargo":/usr/local/cargo/registry -v "$HOME/gallia-build/cargo-git":/usr/local/cargo/git \
  -v "$HOME/gallia-build/target":/target -e CARGO_TARGET_DIR=/target \
  -e CARGO_NET_GIT_FETCH_WITH_CLI=true -w /src \
  rust:1.93.0-bookworm bash -c "
    apt-get update -qq && apt-get install -y -qq protobuf-compiler clang libclang-dev cmake >/dev/null &&
    rustup show active-toolchain >/dev/null &&
    nice cargo build --locked --release -j3 -p duniter --no-default-features --features $FEATURES"
