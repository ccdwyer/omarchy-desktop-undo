.pragma library

// Bounded deque journal with an editor-style cursor.
// Super+Z moves the cursor back; Super+Y moves it forward. A new user
// action truncates the redo tail. Capacity 50; relaunch metadata dies
// with the entry that leaves the ring.

var VERSION = 1
var MAX = 50

var entries = []
var cursor = 0
var revision = 0
var persistDirty = false

function _id() {
    var t = Date.now().toString(16)
    var r = Math.floor(Math.random() * 0xffffffff).toString(16)
    return t + "-" + r
}

function bump() {
    revision += 1
    persistDirty = true
}

function depth() {
    return cursor
}

function redoDepth() {
    return entries.length - cursor
}

function atPresent() {
    return cursor === entries.length
}

function peekUndo() {
    if (cursor <= 0)
        return null
    return entries[cursor - 1]
}

function peekRedo() {
    if (cursor >= entries.length)
        return null
    return entries[cursor]
}

function snapshot() {
    var copy = []
    for (var i = 0; i < entries.length; i++)
        copy.push(cloneEntry(entries[i]))
    return {
        version: VERSION,
        cursor: cursor,
        entries: copy,
        revision: revision,
        depth: depth(),
        redoDepth: redoDepth()
    }
}

function visibleEntries() {
    var out = []
    for (var i = 0; i < cursor; i++)
        out.push(entries[i])
    return out
}

function cloneEntry(entry) {
    if (!entry)
        return null
    var raw = JSON.stringify(entry)
    return JSON.parse(raw)
}

function stripExpired(entry) {
    return cloneEntry(entry)
}

function push(entry) {
    if (!entry)
        return null
    if (cursor < entries.length)
        entries = entries.slice(0, cursor)
    var stored = cloneEntry(entry)
    if (!stored.id)
        stored.id = _id()
    if (!stored.timestamp)
        stored.timestamp = Date.now()
    entries.push(stored)
    while (entries.length > MAX) {
        var dropped = entries.shift()
        if (dropped && dropped.relaunch)
            dropped.relaunch = null
    }
    cursor = entries.length
    bump()
    return stored
}

function moveCursor(delta) {
    var next = cursor + delta
    if (next < 0)
        next = 0
    if (next > entries.length)
        next = entries.length
    if (next === cursor)
        return false
    cursor = next
    bump()
    return true
}

function undo() {
    var entry = peekUndo()
    if (!entry)
        return null
    cursor -= 1
    bump()
    return cloneEntry(entry)
}

function redo() {
    var entry = peekRedo()
    if (!entry)
        return null
    cursor += 1
    bump()
    return cloneEntry(entry)
}

function scrubTo(index) {
    var next = Number(index)
    if (isNaN(next))
        return false
    if (next < 0)
        next = 0
    if (next > entries.length)
        next = entries.length
    if (next === cursor)
        return false
    cursor = next
    bump()
    return true
}

function commitPresent() {
    if (cursor < entries.length) {
        entries = entries.slice(0, cursor)
        bump()
        return true
    }
    return false
}

function restorePresent() {
    if (cursor === entries.length)
        return false
    cursor = entries.length
    bump()
    return true
}

function load(obj) {
    var data = obj
    if (typeof obj === "string") {
        try {
            data = JSON.parse(obj)
        } catch (e) {
            return false
        }
    }
    if (!data || typeof data !== "object")
        return false
    var next = []
    var src = data.entries || []
    for (var i = 0; i < src.length && next.length < MAX; i++) {
        if (src[i] && src[i].type)
            next.push(cloneEntry(src[i]))
    }
    entries = next
    cursor = Number(data.cursor)
    if (isNaN(cursor) || cursor < 0)
        cursor = entries.length
    if (cursor > entries.length)
        cursor = entries.length
    bump()
    persistDirty = false
    return true
}

function serialize() {
    var clean = []
    for (var i = 0; i < entries.length; i++) {
        var e = cloneEntry(entries[i])
        if (e && e.relaunch && e.relaunch.environ)
            delete e.relaunch.environ
        clean.push(e)
    }
    return JSON.stringify({
        version: VERSION,
        cursor: cursor,
        entries: clean,
        savedAt: Date.now()
    })
}

function reset() {
    entries = []
    cursor = 0
    bump()
}

function replaceAddress(oldAddr, newAddr) {
    if (!oldAddr || !newAddr)
        return
    var a = String(oldAddr).toLowerCase()
    var b = String(newAddr).toLowerCase()
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i]
        if (String(e.address || "").toLowerCase() === a)
            e.address = b
        if (e.before && String(e.before.address || "").toLowerCase() === a)
            e.before.address = b
        if (e.after && String(e.after.address || "").toLowerCase() === a)
            e.after.address = b
    }
    bump()
}

function fuzzInvariant(log) {
    if (cursor < 0 || cursor > entries.length)
        return "cursor-out-of-range"
    if (entries.length > MAX)
        return "over-capacity"
    for (var i = 0; i < entries.length; i++) {
        if (!entries[i] || !entries[i].type)
            return "bad-entry:" + i
        if (!entries[i].id)
            return "missing-id:" + i
    }
    if (log && log.length > 5000)
        return "log-unbounded"
    return "ok"
}
