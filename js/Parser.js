.pragma library

// Defensive socket2 line parser.
// Protocol: EVENT>>DATA\n
// Unknown events are returned as {kind:"unknown"} so callers can log-and-skip.
// Argument counts follow the Hyprland IPC wiki; the last field may contain commas.

var KNOWN = {
    openwindow: { args: 4, fields: ["address", "workspace", "klass", "title"] },
    closewindow: { args: 1, fields: ["address"] },
    kill: { args: 1, fields: ["address"] },
    movewindow: { args: 2, fields: ["address", "workspace"] },
    movewindowv2: { args: 3, fields: ["address", "workspaceId", "workspace"] },
    changefloatingmode: { args: 2, fields: ["address", "floating"] },
    fullscreen: { args: 1, fields: ["state"] },
    activewindow: { args: 2, fields: ["klass", "title"] },
    activewindowv2: { args: 1, fields: ["address"] },
    windowtitle: { args: 1, fields: ["address"] },
    windowtitlev2: { args: 2, fields: ["address", "title"] },
    workspace: { args: 1, fields: ["workspace"] },
    workspacev2: { args: 2, fields: ["workspaceId", "workspace"] },
    focusedmon: { args: 2, fields: ["monitor", "workspace"] },
    focusedmonv2: { args: 2, fields: ["monitor", "workspaceId"] },
    configreloaded: { args: 0, fields: [] }
}

var ACTION_EVENTS = {
    openwindow: true,
    closewindow: true,
    movewindow: true,
    movewindowv2: true,
    changefloatingmode: true,
    fullscreen: true
}

function splitArgs(data, count) {
    if (count <= 0)
        return []
    if (data === undefined || data === null || data === "")
        return count === 1 ? [""] : []
    var parts = []
    var rest = String(data)
    for (var i = 0; i < count - 1; i++) {
        var idx = rest.indexOf(",")
        if (idx < 0) {
            parts.push(rest)
            rest = ""
            break
        }
        parts.push(rest.slice(0, idx))
        rest = rest.slice(idx + 1)
    }
    while (parts.length < count - 1)
        parts.push("")
    parts.push(rest)
    return parts
}

function normalizeAddress(value) {
    var s = String(value || "").trim().toLowerCase()
    if (!s)
        return ""
    if (s.indexOf("0x") !== 0)
        s = "0x" + s
    return s
}

function parseLine(line) {
    var raw = String(line || "").replace(/\r$/, "")
    if (!raw)
        return null
    var sep = raw.indexOf(">>")
    if (sep < 0)
        return { kind: "unknown", name: "", data: raw, raw: raw, fields: {} }
    var name = raw.slice(0, sep)
    var data = raw.slice(sep + 2)
    var spec = KNOWN[name]
    if (!spec) {
        return {
            kind: "unknown",
            name: name,
            data: data,
            raw: raw,
            fields: {},
            action: false
        }
    }
    var args = splitArgs(data, spec.args)
    var fields = {}
    for (var i = 0; i < spec.fields.length; i++) {
        var key = spec.fields[i]
        var val = args[i] !== undefined ? args[i] : ""
        if (key === "address")
            val = normalizeAddress(val)
        else if (key === "floating" || key === "state")
            val = String(val) === "1" ? 1 : 0
        else if (key === "workspaceId")
            val = parseInt(val, 10)
        if (key === "klass")
            fields["class"] = val
        else
            fields[key] = val
    }
    return {
        kind: "event",
        name: name,
        data: data,
        raw: raw,
        fields: fields,
        action: !!ACTION_EVENTS[name]
    }
}

function parseStream(text) {
    var lines = String(text || "").split("\n")
    var out = []
    for (var i = 0; i < lines.length; i++) {
        var parsed = parseLine(lines[i])
        if (parsed)
            out.push(parsed)
    }
    return out
}

function isActionEvent(parsed) {
    return !!(parsed && parsed.action)
}

function eventMatchesExpected(parsed, expected) {
    if (!parsed || !expected)
        return false
    if (expected.name && parsed.name !== expected.name)
        return false
    if (expected.address && parsed.fields && parsed.fields.address) {
        if (normalizeAddress(parsed.fields.address) !== normalizeAddress(expected.address))
            return false
    }
    if (expected.hasOwnProperty("state") && parsed.fields) {
        if (Number(parsed.fields.state) !== Number(expected.state))
            return false
    }
    if (expected.hasOwnProperty("floating") && parsed.fields && parsed.fields.hasOwnProperty("floating")) {
        if (Number(parsed.fields.floating) !== Number(expected.floating))
            return false
    }
    if (expected.className && parsed.fields && parsed.fields["class"]) {
        if (String(parsed.fields["class"]).toLowerCase() !== String(expected.className).toLowerCase())
            return false
    }
    return true
}
