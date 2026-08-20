#!/bin/sh
# POSIX fallback for undo-probe used when the compiled binary is missing.
# Degrades: walks children via /proc if present, otherwise uses the window pid
# cwd/cmdline. Cookie matching still reads environ at runtime and never stores it.

set -eu

PROC_ROOT="${UNDP_PROC_ROOT:-/proc}"

json_escape() {
  printf '%s' "$1" | od -An -v -tx1 | awk '
    BEGIN { ORS = "" }
    function hex2dec(h,    i, d, v, c) {
      v = 0
      h = tolower(h)
      for (i = 1; i <= length(h); i++) {
        c = substr(h, i, 1)
        if (c >= "0" && c <= "9") d = c + 0
        else d = index("abcdef", c) + 9
        v = v * 16 + d
      }
      return v
    }
    {
      for (i = 1; i <= NF; i++) {
        n = hex2dec($i)
        if (n == 92) printf "\\\\"
        else if (n == 34) printf "\\\""
        else if (n == 10) printf "\\n"
        else if (n == 13) printf "\\r"
        else if (n == 9) printf "\\t"
        else if (n < 32 || n == 127) printf "\\u00%02x", n
        else printf "%c", n
      }
    }
  '
}

is_shell() {
  case "$1" in
    bash|zsh|fish|sh|dash|mksh|ksh|csh|tcsh|nu|elvish|ion|xonsh|pwsh|ash) return 0 ;;
    *) return 1 ;;
  esac
}

read_cmdline() {
  pid="$1"
  file="$PROC_ROOT/$pid/cmdline"
  if [ ! -r "$file" ]; then
    printf ''
    return
  fi
  tr '\0' ' ' < "$file" | sed 's/[[:space:]]*$//'
}

read_argv0() {
  pid="$1"
  file="$PROC_ROOT/$pid/cmdline"
  if [ ! -r "$file" ]; then
    printf ''
    return
  fi
  tr '\0' '\n' < "$file" | head -n 1 | sed 's|.*/||; s/^-//'
}

# Full NUL-separated argv as a JSON array (matches the Rust helper).
# Arguments may contain newlines; only 0x00 splits entries.
read_argv_json() {
  pid="$1"
  file="$PROC_ROOT/$pid/cmdline"
  if [ ! -r "$file" ]; then
    printf '[]'
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys
parts=[p.decode("utf-8","replace") for p in open(sys.argv[1],"rb").read().split(b"\0") if p]
sys.stdout.write(json.dumps(parts))' "$file"
    return
  fi
  od -An -v -tx1 "$file" | awk '
    BEGIN { ORS = ""; first = 1; a = ""; started = 0; printf "[" }
    function hex2dec(h,    i, d, v, c) {
      v = 0
      h = tolower(h)
      for (i = 1; i <= length(h); i++) {
        c = substr(h, i, 1)
        if (c >= "0" && c <= "9") d = c + 0
        else d = index("abcdef", c) + 9
        v = v * 16 + d
      }
      return v
    }
    function esc(n) {
      if (n == 92) return "\\\\"
      if (n == 34) return "\\\""
      if (n == 10) return "\\n"
      if (n == 13) return "\\r"
      if (n == 9) return "\\t"
      if (n < 32 || n == 127) return sprintf("\\u00%02x", n)
      return sprintf("%c", n)
    }
    function flush() {
      if (!started) return
      if (!first) printf ","
      first = 0
      printf "\"%s\"", a
      a = ""
      started = 0
    }
    {
      for (i = 1; i <= NF; i++) {
        n = hex2dec($i)
        if (n == 0) { flush(); continue }
        started = 1
        a = a esc(n)
      }
    }
    END { flush(); printf "]" }
  '
}

read_cwd() {
  pid="$1"
  if [ -L "$PROC_ROOT/$pid/cwd" ]; then
    readlink "$PROC_ROOT/$pid/cwd" 2>/dev/null || printf ''
  else
    printf ''
  fi
}

children_of() {
  pid="$1"
  taskdir="$PROC_ROOT/$pid/task"
  if [ ! -d "$taskdir" ]; then
    return
  fi
  for t in "$taskdir"/*; do
    [ -r "$t/children" ] || continue
    # shellcheck disable=SC2013
    for c in $(cat "$t/children" 2>/dev/null); do
      printf '%s\n' "$c"
    done
  done
}

cmd_pid() {
  pid="$1"
  if [ ! -d "$PROC_ROOT/$pid" ]; then
    printf '{"ok":false,"error":"pid %s not found"}\n' "$pid"
    return 1
  fi

  best_pid="$pid"
  best_depth=0
  best_shell_pid=""
  best_shell_depth=-1

  queue="$pid:0"
  seen=" $pid "

  while [ -n "$queue" ]; do
    item=$(printf '%s\n' "$queue" | head -n 1)
    queue=$(printf '%s\n' "$queue" | tail -n +2)
    cur=${item%%:*}
    depth=${item##*:}
    argv0=$(read_argv0 "$cur")
    if [ "$depth" -ge "$best_depth" ]; then
      best_pid="$cur"
      best_depth="$depth"
    fi
    if is_shell "$argv0" && [ "$depth" -ge "$best_shell_depth" ]; then
      best_shell_pid="$cur"
      best_shell_depth="$depth"
    fi
    for child in $(children_of "$cur"); do
      case "$seen" in
        *" $child "*) continue ;;
      esac
      seen="$seen $child "
      nd=$((depth + 1))
      queue=$(printf '%s\n%s:%s\n' "$queue" "$child" "$nd" | sed '/^$/d')
    done
  done

  chosen="$best_pid"
  if [ -n "$best_shell_pid" ]; then
    chosen="$best_shell_pid"
  fi
  cwd=$(read_cwd "$chosen")
  cmdline=$(read_cmdline "$chosen")
  window_cmd=$(read_cmdline "$pid")
  argv_json=$(read_argv_json "$chosen")
  window_argv_json=$(read_argv_json "$pid")
  printf '{"ok":true,"found":true,"pid":%s,"shellPid":%s,"cwd":"%s","cmdline":"%s","argv":%s,"windowArgv":%s,"windowCmdline":"%s"}\n' \
    "$pid" "$chosen" "$(json_escape "$cwd")" "$(json_escape "$cmdline")" "$argv_json" "$window_argv_json" "$(json_escape "$window_cmd")"
}

cmd_cookie() {
  uuid="$1"
  shift
  needle="DESKTOP_UNDO_COOKIE=$uuid"
  scan_pid() {
    p="$1"
    envfile="$PROC_ROOT/$p/environ"
    [ -r "$envfile" ] || return 1
    tr '\0' '\n' < "$envfile" 2>/dev/null | grep -F -x "$needle" >/dev/null 2>&1
  }

  if [ "$#" -gt 0 ]; then
    pending=""
    for s in "$@"; do
      pending=$(printf '%s\n%s\n' "$pending" "$s")
    done
    seen=" "
    while [ -n "$(printf '%s' "$pending" | sed '/^$/d')" ]; do
      p=$(printf '%s\n' "$pending" | sed '/^$/d' | head -n 1)
      pending=$(printf '%s\n' "$pending" | sed '/^$/d' | tail -n +2)
      case "$seen" in
        *" $p "*) continue ;;
      esac
      seen="$seen $p "
      if scan_pid "$p"; then
        cwd=$(read_cwd "$p")
        cmdline=$(read_cmdline "$p")
        printf '{"ok":true,"found":true,"pid":%s,"shellPid":%s,"cwd":"%s","cmdline":"%s","argv":[]}\n' \
          "$p" "$p" "$(json_escape "$cwd")" "$(json_escape "$cmdline")"
        return 0
      fi
      for child in $(children_of "$p"); do
        pending=$(printf '%s\n%s\n' "$pending" "$child")
      done
    done
    printf '{"ok":false,"found":false}\n'
    return 0
  fi

  for envfile in "$PROC_ROOT"/[0-9]*/environ; do
    [ -r "$envfile" ] || continue
    if tr '\0' '\n' < "$envfile" 2>/dev/null | grep -F -x "$needle" >/dev/null 2>&1; then
      p=$(printf '%s' "$envfile" | sed -n "s|$PROC_ROOT/\([0-9]*\)/environ|\1|p")
      cwd=$(read_cwd "$p")
      cmdline=$(read_cmdline "$p")
      printf '{"ok":true,"found":true,"pid":%s,"shellPid":%s,"cwd":"%s","cmdline":"%s","argv":[]}\n' \
        "$p" "$p" "$(json_escape "$cwd")" "$(json_escape "$cmdline")"
      return 0
    fi
  done
  printf '{"ok":false,"found":false}\n'
}

cmd_init_state() {
  if [ "$#" -gt 0 ]; then
    dir="$1"
  else
    if [ -n "${XDG_STATE_HOME:-}" ]; then
      dir="$XDG_STATE_HOME/desktop-undo"
    else
      dir="${HOME:-/tmp}/.local/state/desktop-undo"
    fi
  fi
  mkdir -p "$dir"
  chmod 700 "$dir" 2>/dev/null || true
  journal="$dir/journal.json"
  if [ ! -f "$journal" ]; then
    printf '%s\n' '{"version":1,"cursor":0,"entries":[]}' > "$journal"
  fi
  chmod 600 "$journal" 2>/dev/null || true
  printf '{"ok":true,"dir":"%s"}\n' "$(json_escape "$dir")"
}

cmd_secure() {
  path="$1"
  parent=$(dirname "$path")
  if [ -d "$parent" ]; then
    chmod 700 "$parent" 2>/dev/null || true
  fi
  if [ -e "$path" ]; then
    chmod 600 "$path" 2>/dev/null || true
  fi
  printf '%s\n' '{"ok":true}'
}

cmd="${1:-}"
if [ -z "$cmd" ] || [ "$cmd" = "-h" ] || [ "$cmd" = "--help" ]; then
  printf '%s\n' "usage: undo-probe.sh pid <pid> | cookie <uuid> [pid...] | init-state [dir] | secure <path>" >&2
  exit 0
fi
shift || true

case "$cmd" in
  pid)
    cmd_pid "${1:?pid required}"
    ;;
  cookie)
    cmd_cookie "${1:?uuid required}" ${2+"$@"}
    ;;
  init-state)
    cmd_init_state ${1+"$@"}
    ;;
  secure)
    cmd_secure "${1:?path required}"
    ;;
  *)
    printf '%s\n' "unknown command: $cmd" >&2
    exit 2
    ;;
esac
