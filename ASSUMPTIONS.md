# Assumptions

Conservative choices where the Omarchy / Quickshell / Hyprland API was not 100% certain. The rule: isolate the uncertainty behind a small adapter, prefer documented types (`Process`, `Socket`, `FileView`, `Hyprland`, `IpcHandler`, `PanelWindow`), and degrade.

## Plugin host

- **Entry points are `Item`s**, not `ShellRoot`. Overlay exposes `open(payloadJson)` and `close()` for `omarchy-shell shell summon` / `hide`. Taken from `docs/omarchy-shell.md` and the clipboard overlay.
- **Injected properties** on load: `omarchyPath`, `shell`, `manifest`, `pluginRegistry` (and `bar` / `barWidgetRegistry` on bar widgets). Documented. Overlay and BarWidget still function if some of these are missing.
- **`keepLoaded: true`** so the overlay's layer-shell window can survive between summons, matching `omarchy.image-picker` / clipboard.
- **Third-party service lookup is not first-party `shell.firstPartyServiceFor`.** Bar/overlay try, in order: `pluginRegistry.serviceFor`, `shell.serviceFor`, `shell.firstPartyServiceFor`, then `omarchy-shell shell call` / `shell.summon`. Display state is also shared via `.pragma library` JS (`js/Journal.js`) in the same engine, plus the persisted JSON file.
- **IPC verb** is `omarchy-shell shell call <id> <method> <arg>` and `shell summon <id> <payloadJson>`. Confirmed in `docs/omarchy-shell.md`. README keybinds use that; we do not write `hyprland.conf`.
- **`IpcHandler` target** is the plugin id. First-party plugins use short names (`media`, `omarchy.clock`). A unique id avoids collisions. `shell call` is the primary path; IpcHandler is extra.

## Quickshell

- **`Hyprland.rawEvent`** is the documented socket2 feed (`event.name`, `event.data`). Used as the primary event source.
- **`Socket { path; connected }`** is opened only as a fallback if `Hyprland.rawEvent` has not fired within 2s. Connecting both would double-record (Hyprland already holds socket2). Socket's `parser` property is **not** used — it is not documented as clearly as Process `stdout: SplitParser`, and a missing property would fail the whole Service at load. If `rawEvent` is silent, `hyprctl -j clients` diffs on the poll timer still derive close/open/workspace/float/fullscreen/geometry (events are triggers; diffs are truth). Recorded so a later spike can attach a SplitParser if the build exposes it.
- **`Hyprland.dispatch(request)`** is used for mutations (same dispatcher string as `hyprctl dispatch`). Spec says `hyprctl dispatch`; if `dispatch` throws, we fall back to a `Process` of `hyprctl`. Both talk to the compositor — never a private API.
- **`Hyprland.eventSocketPath`** is preferred when building the Socket path; otherwise `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock`.
- **Geometry signals.** `HyprlandToplevel` documents `address`, `title`, `workspace`, `lastIpcObject` — **not** dedicated `x`/`y`/`size` properties. `lastIpcObject` only updates after `refreshToplevels()`. So drag detection is **not** property-change handlers; it is a `hyprctl -j clients` poll (250ms while geometry is in flux, 1s idle) plus a 150ms end-of-drag debounce. Quickshell does not document compositor pointer-button state, so "while buttons are down" is approximated by "geometry still changing".
- **`image://icon/<appId>`** for overlay cards. If the image provider is absent, the card shows the action glyph instead (`Image.status !== Ready`).
- **Theme tokens** `Color.menu.*`, `Color.accent`, `Style.*`, `Border.*`, `WidgetButton`, `BarWidget`, `BorderSurface`, `PanelWindow`, `WlrLayershell` — copied from first-party clipboard / clock / media. Reduced motion: `Style.reduceMotion` if present, else `OMARCHY_REDUCED_MOTION=1`.
- **`.pragma library` JS** is shared across Service, Overlay, and BarWidget in one engine. Tests strip the pragma and eval under Node.

## Hyprland

- Socket2 events and payloads are taken from the 2026-08-18 wiki: `openwindow`, `closewindow`, `movewindow`/`movewindowv2`, `changefloatingmode`, `fullscreen` (payload `0/1`, **no address**). Address for fullscreen is resolved via `activewindowv2` + a clients-j diff.
- There is **no** drag/resize socket2 event. Confirmed by the tribunal applied-changes section.
- Inverse dispatchers:
  - `movewindowpixel exact X Y,address:0x…`
  - `resizewindowpixel exact W H,address:0x…`
  - `movetoworkspacesilent N,address:0x…`
  - `settiled` / `setfloating` + address
  - `fullscreenstate <internal> <client>,address:0x…` (0 none / 1 maximize / 2 fullscreen / 3 both)
  - `exec [workspace N silent] …`
  - redo of a close uses `closewindow address:0x…`
- `hyprctl -j version` and `hyprctl -j clients` exist. Version is stored for logs; unknown socket2 events are logged and skipped.
- Address spelling is normalized to lowercase `0x…`.

## Helper

- Spec said "small shell script"; the competition brief also asked for a helper **binary** with `build.sh` and a missing-binary fallback. Both ship: Rust `src/undo-probe` → `bin/undo-probe`, POSIX `compat/undo-probe.sh`.
- Probe never persists `environ`. Cookie matching reads it at runtime from `/proc/<pid>/environ` and drops it.
- `FileView.setText` does not document mode 0600, so after each save we run `undo-probe secure <path>` (chmod 0600, parent 0700).

## Out of scope (intentional)

- Tiled swap undo (tribunal cut).
- Writing Hyprland config.
- A second Quickshell process.
- Network, accounts, telemetry.
