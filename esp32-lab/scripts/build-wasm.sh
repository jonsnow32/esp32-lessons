#!/bin/sh
# Build the emulator for the browser and copy it next to its TypeScript wrapper.
# Needs a Rust toolchain with the wasm32-unknown-unknown target (rustup target add ...).
set -e
cd "$(dirname "$0")/.."
# Prefer a rustup toolchain (a Homebrew rustc has no wasm32 standard library)
TOOLCHAIN="$HOME/.rustup/toolchains/stable-$(uname -m | sed 's/arm64/aarch64/')-apple-darwin/bin"
if [ -x "$TOOLCHAIN/cargo" ]; then
  PATH="$TOOLCHAIN:$PATH"
fi
cargo build --release --target wasm32-unknown-unknown -p esp32-wasm \
  --config 'profile.release.debug=false' --config 'profile.release.strip=true' \
  --config 'profile.release.lto=true' --config 'profile.release.codegen-units=1' \
  --config 'profile.release.panic="abort"'
mkdir -p packages/mcu-esp32/wasm
cp target/wasm32-unknown-unknown/release/esp32_wasm.wasm packages/mcu-esp32/wasm/esp32.wasm
ls -la packages/mcu-esp32/wasm/esp32.wasm
