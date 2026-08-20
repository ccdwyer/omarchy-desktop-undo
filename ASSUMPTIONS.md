# Assumptions

Conservative choices where the Omarchy / Quickshell / Hyprland API was not 100% certain. Authoritative platform contract: `docs/quattro-shell-reference.md`. Prefer documented types (`Process`, `Socket`, `FileView`, `Hyprland`, `IpcHandler`, `PanelWindow`) and degrade.

## Plugin host (from the Quattro reference)

- **Entry points are QML files named in `entryPoints`.** Overlay/panel kinds are opened with `omarchy-shell shell summon <id> <payloadJson>` and closed with `shell hide <id>`. Overlay `open(payloadJson)` / `close()` match that IPC.
- **`keepLoaded: true`** is a documented top-level manifest key so an overlay can stay mounted between summons.
- **Settings are inline on the `shell.json` entry.** No `config:` sub-object, no per-plugin settings file. The Quattro manifest shape puts `defaults` and `schema` only inside `barWidget`. The service/overlay declare the same keys as QML properties (`hideChipAtZero`, `extraExclusions`) so a `plugins[]` entry can inject them; they are not top-level manifest fields. The bar widget uses `setting(key, fallback)` when the BarWidget base provides it, else `settings`.
- **`omarchy-shell shell call <id> <method> <arg>`** calls a method on an already-loaded plugin. The `<arg>` argument is required; methods accept a string and ignore it when unused. `summon` loads+opens a panel/overlay — it does not invoke an arbitrary method.
- **`IpcHandler` target** is the plugin id so `call` and `qs ipc` share one name. This is extra surface, not a substitute for `shell call`.

## What the reference does **not** establish

The following were used only as optional in-process shortcuts, never as documented API:

- `shell.serviceFor` / `shell.firstPartyServiceFor` / `pluginRegistry.serviceFor`
- `shell.call` / `shell.summon` as QML methods on the injected `shell` object

When those are missing, overlay and bar chip go through `omarchy-shell shell call|summon` with a full argv. Journal display is shared via `.pragma library` JS in the same engine plus `journal.json`.

Injected properties such as `omarchyPath`, `shell`, `manifest`, `pluginRegistry`, and `settings` are assumed by analogy with first-party plugins; every read is guarded.

## Quickshell

- **`Hyprland.rawEvent`** is the documented socket2 feed (`event.name`, `event.data`). Used as the primary event source.
- **`Socket` fallback** connects only if `rawEvent` has not fired within 2s, so the two feeds do not double-record. Lines are read with `parser: SplitParser { onRead }` into `handleLine`. If `rawEvent` is silent, `hyprctl -j clients` diffs on the poll timer still derive actions (events are triggers; diffs are truth).
- **Mutations go through `hyprctl dispatch` as a `Process`** so the exit code and stdout can fail the transaction. Never a private compositor API.
- **`Hyprland.eventSocketPath`** is preferred when building the Socket path; otherwise `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock`.
- **Geometry signals.** `HyprlandToplevel` documents `address`, `title`, `workspace`, `lastIpcObject` — not dedicated `x`/`y`/`size` properties. Drag detection polls `hyprctl -j clients` every 250ms and commits only after 400ms with no further geometry change (inactivity > poll interval). The first `before` of a drag is frozen; only `after` updates until that deadline. Quickshell does not document compositor pointer-button state, so "buttons down" is approximated by "geometry still changing".
- **Undo/redo cursor** moves only after a transaction step is confirmed (matching socket2 event, clients-j, or a successful `hyprctl dispatch` with no expected event). Timeout, non-zero hyprctl exit, or error text fails the batch, restores the cursor (it was never advanced), and sets `lastStatus` to `failed:…`.
- **Scrub** is a single `desiredTarget` in `js/Scrub.js`. Rapid Left/Right only updates that target; the service enqueues one undo or redo after each confirmation. Enter/Esc/overlay-close set a pending dismiss and do not apply until the journal cursor equals the target and the executor is idle. Cancel retargets the present cursor saved when scrubbing began.
- **`image://icon/<appId>`** for overlay cards. If the provider is absent, the card shows the action glyph (`Image.status !== Ready`).
- **Theme tokens** `Color.menu.*`, `Color.accent`, `Style.*`, `Border.*`, `WidgetButton`, `BarWidget`, `BorderSurface`, `PanelWindow`, `WlrLayershell` — copied from first-party clipboard / clock / media. Reduced motion: `Style.reduceMotion` if present, else `OMARCHY_REDUCED_MOTION=1`.
- **`.pragma library` JS** is shared across Service, Overlay, and BarWidget in one engine. Tests strip the pragma and eval under Node.

## Hyprland

- Socket2 events and payloads are taken from the 2026-08-18 wiki: `openwindow`, `closewindow`, `movewindow`/`movewindowv2`, `changefloatingmode`, `fullscreen` (payload `0/1`, **no address**). Address for fullscreen is resolved via `activewindowv2` + a clients-j diff.
- There is **no** drag/resize socket2 event.
- Inverse dispatchers:
  - `movewindowpixel exact X Y,address:0x…`
  - `resizewindowpixel exact W H,address:0x…`
  - `movetoworkspacesilent N,address:0x…`
  - `settiled` / `setfloating` + address
  - `fullscreenstate <internal> <client>,address:0x…` (0 none / 1 maximize / 2 fullscreen / 3 both)
  - `exec [workspace N silent] …`
  - redo of a close uses `closewindow address:0x…`
- Close-undo restoration (workspace / float / geometry) is **not** queued against the closed address. It is enqueued only after cookie-match (or pid→address lookup) yields a live client.
- `hyprctl -j version` and `hyprctl -j clients` exist. Version is stored for logs; unknown socket2 events are logged and skipped.
- Address spelling is normalized to lowercase `0x…`.

## Helper

- `compat/undo-probe.sh` is the default path (zero-setup). `build.sh` may compile Rust `bin/undo-probe`; QML uses the binary only when it is executable.
- Probe never persists `environ`. Cookie matching reads it at runtime from `/proc/<pid>/environ` and drops it.
- `FileView.setText` does not document mode 0600, so after each journal save we run `undo-probe secure <path>` (chmod 0600, parent 0700). The state dir holds `journal.json` only.

## Out of scope (intentional)

- Tiled swap undo (tribunal cut).
- Writing Hyprland config.
- A second Quickshell process.
- Network, accounts, telemetry.
