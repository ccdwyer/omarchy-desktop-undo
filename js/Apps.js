.pragma library

// Classification tables used by the journal and overlay labels.
// Kept data-driven so tests can assert every branch of the op table.

var DEFAULT_EXCLUSIONS = [
    "1password",
    "1Password",
    "org.keepassxc.KeePassXC",
    "keepassxc",
    "bitwarden",
    "Bitwarden",
    "org.gnome.seahorse.Application",
    "polkit-gnome-authentication-agent-1",
    "org.omarchy.polkit"
]

var TERMINAL_CLASSES = [
    "kitty",
    "Alacritty",
    "alacritty",
    "org.wezfurlong.wezterm",
    "wezterm",
    "foot",
    "footclient",
    "com.mitchellh.ghostty",
    "ghostty",
    "org.gnome.Terminal",
    "gnome-terminal-server",
    "konsole",
    "org.kde.konsole",
    "xfce4-terminal",
    "terminator",
    "tilix",
    "com.raggesilver.BlackBox",
    "dev.warp.Warp"
]

var MULTI_WINDOW_CLASSES = [
    "firefox",
    "firefox-esr",
    "zen",
    "zen-alpha",
    "librewolf",
    "chromium",
    "google-chrome",
    "google-chrome-stable",
    "brave-browser",
    "Brave-browser",
    "vivaldi-stable",
    "microsoft-edge",
    "code",
    "code-oss",
    "codium",
    "dev.zed.Zed",
    "slack",
    "discord",
    "vesktop",
    "element",
    "spotify",
    "obsidian",
    "notion",
    "figma",
    "electron",
    "org.mozilla.firefox",
    "org.chromium.Chromium"
]

var SHELL_NAMES = [
    "bash",
    "zsh",
    "fish",
    "sh",
    "dash",
    "mksh",
    "ksh",
    "csh",
    "tcsh",
    "nu",
    "elvish",
    "ion",
    "xonsh",
    "pwsh",
    "ash"
]

function _norm(value) {
    return String(value || "").toLowerCase()
}

function _inList(value, list) {
    var n = _norm(value)
    if (!n)
        return false
    for (var i = 0; i < list.length; i++) {
        if (_norm(list[i]) === n)
            return true
    }
    return false
}

function isExcluded(appId, extra) {
    if (_inList(appId, DEFAULT_EXCLUSIONS))
        return true
    if (extra && extra.length)
        return _inList(appId, extra)
    return false
}

function isTerminal(appId) {
    return _inList(appId, TERMINAL_CLASSES)
}

function isMultiWindow(appId) {
    return _inList(appId, MULTI_WINDOW_CLASSES)
}

function isShellName(comm) {
    var base = _norm(comm)
    var slash = base.lastIndexOf("/")
    if (slash >= 0)
        base = base.slice(slash + 1)
    if (base.charAt(0) === "-")
        base = base.slice(1)
    return _inList(base, SHELL_NAMES)
}

function labelForType(type, fidelity, multiWindow) {
    if (type === "close") {
        if (multiWindow || fidelity === "best-effort")
            return "reopen"
        return "undo"
    }
    if (fidelity === "workspace-only")
        return "workspace"
    return "undo"
}

function glyphForType(type) {
    if (type === "close")
        return "↺"
    if (type === "move")
        return "↩"
    if (type === "resize")
        return "⇲"
    if (type === "workspace")
        return "⬒"
    if (type === "float")
        return "⧉"
    if (type === "fullscreen")
        return "⛶"
    return "↩"
}

function titleForType(type) {
    if (type === "close")
        return "Closed"
    if (type === "move")
        return "Moved"
    if (type === "resize")
        return "Resized"
    if (type === "workspace")
        return "Sent"
    if (type === "float")
        return "Float"
    if (type === "fullscreen")
        return "Fullscreen"
    return type
}
