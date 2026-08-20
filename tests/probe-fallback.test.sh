#!/bin/sh
# Off-device test of compat/undo-probe.sh against a fake /proc tree.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
FAKE=$(mktemp -d)
trap 'rm -rf "$FAKE"' EXIT

write_proc() {
  pid="$1"
  cmd="$2"
  cwd="$3"
  kids="$4"
  mkdir -p "$FAKE/$pid/task/$pid"
  printf '%s\0' "$cmd" > "$FAKE/$pid/cmdline"
  ln -s "$cwd" "$FAKE/$pid/cwd"
  printf '%s\n' "$kids" > "$FAKE/$pid/task/$pid/children"
}

write_proc 100 "/usr/bin/kitty" "/usr/share/kitty" "101"
write_proc 101 "bash" "/home/chris/projects/demo" "102"
write_proc 102 "htop" "/home/chris/projects/demo" ""

export UNDP_PROC_ROOT="$FAKE"
out=$(sh "$ROOT/compat/undo-probe.sh" pid 100)
printf '%s\n' "$out" | grep -q '"shellPid":101' || { echo "expected shellPid 101: $out"; exit 1; }
printf '%s\n' "$out" | grep -q '/home/chris/projects/demo' || { echo "expected demo cwd: $out"; exit 1; }

mkdir -p "$FAKE/state"
sh "$ROOT/compat/undo-probe.sh" init-state "$FAKE/state" >/dev/null
[ -f "$FAKE/state/journal.json" ] || { echo "journal not created"; exit 1; }
[ ! -f "$FAKE/state/config.json" ] || { echo "config.json must not be created"; exit 1; }

# Control characters in argv/cwd must not break JSON.
write_proc 400 "$(printf 'foo\nbar')" "/tmp/quote\"here" ""
out=$(sh "$ROOT/compat/undo-probe.sh" pid 400)
printf '%s\n' "$out" | python3 -c 'import json,sys; json.loads(sys.stdin.read())' || {
  echo "invalid JSON for control-char cmdline: $out"
  exit 1
}
printf '%s\n' "$out" | grep -q '\\n' || { echo "newline not escaped: $out"; exit 1; }

echo "ok  probe-fallback"
