#!/usr/bin/env python3
"""Remove this plugin's marked o.bind block from ~/.config/hypr/bindings.lua."""

import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: uninstall-binds.py PLUGIN_ID", file=sys.stderr)
        return 2
    plugin_id = sys.argv[1]
    config_home = os.environ.get("XDG_CONFIG_HOME") or os.path.join(
        os.path.expanduser("~"), ".config"
    )
    path = os.path.join(config_home, "hypr", "bindings.lua")
    begin = f"-- BEGIN {plugin_id}"
    end = f"-- END {plugin_id}"
    if not os.path.isfile(path):
        print("ok")
        return 0
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    if begin not in text or end not in text:
        print("ok")
        return 0
    pre = text[: text.index(begin)]
    post = text[text.index(end) + len(end) :].lstrip("\n")
    out = pre.rstrip()
    if post:
        out = out + "\n\n" + post.lstrip()
        if not out.endswith("\n"):
            out += "\n"
    elif out:
        out += "\n"
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(out)
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
