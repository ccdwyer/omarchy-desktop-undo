#!/bin/sh
# Build the undo-probe helper. The plugin QML degrades to compat/undo-probe.sh
# when bin/undo-probe is missing, so a failed build is not fatal at runtime.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
SRC="$ROOT/src/undo-probe"
OUT="$ROOT/bin"

mkdir -p "$OUT"
chmod +x "$ROOT/compat/undo-probe.sh" 2>/dev/null || true

if ! command -v cargo >/dev/null 2>&1; then
  echo "build.sh: cargo not found; installing POSIX fallback as bin/undo-probe" >&2
  cp "$ROOT/compat/undo-probe.sh" "$OUT/undo-probe"
  chmod +x "$OUT/undo-probe"
  echo "build.sh: wrote $OUT/undo-probe (shell fallback)"
  exit 0
fi

if ! cargo build --release --manifest-path "$SRC/Cargo.toml"; then
  echo "build.sh: cargo build failed; installing POSIX fallback as bin/undo-probe" >&2
  cp "$ROOT/compat/undo-probe.sh" "$OUT/undo-probe"
  chmod +x "$OUT/undo-probe"
  echo "build.sh: wrote $OUT/undo-probe (shell fallback)"
  exit 0
fi

BIN="$SRC/target/release/undo-probe"
if [ ! -x "$BIN" ]; then
  echo "build.sh: release binary missing after cargo build" >&2
  exit 1
fi
cp "$BIN" "$OUT/undo-probe"
chmod +x "$OUT/undo-probe"
echo "build.sh: wrote $OUT/undo-probe"
