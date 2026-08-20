# Desktop Undo

Super+Z for Hyprland. The last fifty window closes, moves, floats, and workspace sends are a journal; undo walks them back. Super+Shift+Z opens a scrubbable timeline with live preview.

This is an Omarchy shell plugin (service + overlay + bar-widget). It runs inside the long-lived `omarchy-shell` process. It does not start a second Quickshell instance.

## Install

```sh
omarchy plugin add <git-url> --enable
```

That is the whole install. The plugin ships `compat/undo-probe.sh` and uses it automatically for process-tree / cookie matching. No compile step is required on a fresh machine.

`build.sh` is optional. If you have Rust, you can compile a faster `bin/undo-probe`; if that binary is absent, the shell fallback is used as-is.

Put the chip on the bar if `--enable` did not:

```sh
omarchy bar put io.github.chris.desktop-undo --section right
```

Reload plugins if the shell was already running:

```sh
omarchy-shell shell rescanPlugins
```

## Usage

| Combo | Action |
|---|---|
| Super+Z | Undo |
| Super+Y | Redo |
| Super+Shift+Z | Open timeline overlay |

On first load the plugin writes those binds to `~/.config/hypr/bindings.lua` if the combos are free, then pops an Omarchy notification with the keys it assigned. Occupied shortcuts (including stock Omarchy hotkeys) are skipped or replaced with Super+Alt variants. It never unbinds someone else's key, and it will not notify again once its binds are already live.

Undo/redo hit the plugin's `IpcHandler` (the service). `summon` opens the overlay. They are not interchangeable. The handler requires a third argument (use an empty string when the method needs no payload):

```
bind = SUPER, Z, exec, omarchy-shell io.github.chris.desktop-undo undo ''
bind = SUPER, Y, exec, omarchy-shell io.github.chris.desktop-undo redo ''
bind = SUPER SHIFT, Z, exec, omarchy-shell shell summon io.github.chris.desktop-undo
```

If a bind collides, click the bar chip. It always summons the overlay.

In the overlay: Left/Right (or click a card) scrubs with **live preview** — the desktop actually steps back. Enter commits (truncates redo). Esc rolls forward to the present.

## What undo does

| Action | Undo | Fidelity |
|---|---|---|
| Close a window | Relaunch the command, then re-apply workspace / geometry when we can | best-effort |
| Drag/resize a **floating** window | `movewindowpixel` / `resizewindowpixel` exact | exact |
| Send to another workspace | `movetoworkspacesilent` back | exact |
| Float / tile toggle | `settiled` / `setfloating` + restore geometry if floating | exact |
| Fullscreen | `fullscreenstate` to the recorded state (never a blind toggle) | exact |

Close-undo for terminals walks `/proc/<pid>/task/*/children` to the deepest child **shell** and restores *that* cwd, so a kitty running `htop` in `~/projects/demo` comes back in that directory. Matching the relaunched window uses a short-lived `DESKTOP_UNDO_COOKIE` env var read back from `/proc/<pid>/environ` (never persisted). Geometry restore waits until that new client is identified; it never targets the closed window's dead address.

## Honest limitations

- **Close is a relaunch, not a snapshot.** Apps whose document is not in argv come back as a fresh instance. The overlay labels these **reopen**, not undo.
- **Multi-window apps** (browsers, Electron, editors) are always "reopen". Geometry is not re-applied — two Firefox windows would race.
- **Tiled swap is not in 1.0.** `swapwindow` is direction-only; dwindle/master trees do not round-trip from pixels. Tiled windows still get workspace-send and float-toggle undo. Pixel-exact restore is floating-only.
- **Tiled intra-workspace drags are not recorded.** There is no honest inverse.
- **Journal can contain command lines** (tokens in argv). The file is `0600` in a `0700` directory under `~/.local/state/desktop-undo/`. `environ` is never written. Password managers are excluded by default. Relaunch metadata dies when the entry leaves the 50-deep ring.
- **Keybinds are yours to add.** The first time you open the overlay, a panel repeats the table above.

## Settings

Settings are inline on the `shell.json` entry. There is no plugin `config.json`. Widget `defaults` and `schema` live under `barWidget` in `manifest.json` (the Quattro shape). The service reads the same keys as injected QML properties.

Bar chip (layout entry):

```json
{ "id": "io.github.chris.desktop-undo", "hideChipAtZero": true }
```

Service (`plugins[]` entry — fields land on declared QML properties):

```json
{ "id": "io.github.chris.desktop-undo", "extraExclusions": "my-secret-app" }
```

`hideChipAtZero` hides the bar chip when there is nothing to undo. `extraExclusions` is a comma-separated list of additional window classes that are never journaled.

## IPC

```sh
omarchy-shell io.github.chris.desktop-undo undo ''
omarchy-shell io.github.chris.desktop-undo redo ''
omarchy-shell io.github.chris.desktop-undo status ''
omarchy-shell shell summon io.github.chris.desktop-undo
omarchy-shell shell hide io.github.chris.desktop-undo
omarchy-shell io.github.chris.desktop-undo installBinds ''
```

The service registers an `IpcHandler` target of the same id. Those handlers take a string argument. `omarchy-shell shell call io.github.chris.desktop-undo <method> ''` also works: it invokes the overlay, which forwards to the service.

## Tests (off-device)

```sh
node tests/run.js
# helper, if you have cargo:
cargo test --manifest-path src/undo-probe/Cargo.toml
```

## Remove

```sh
omarchy plugin remove io.github.chris.desktop-undo
```
