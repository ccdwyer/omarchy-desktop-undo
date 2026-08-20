.pragma library

// Detect live Hyprland binds and plan a bindings.lua snippet.
// Lua binds show up as dispatcher "__lua" with a description, not the
// omarchy-shell command in `arg`, so "ours" is plugin-id in arg OR our
// descriptions.
// Writing bindings.lua is opt-in from the overlay. Never auto-assign.

var PLUGIN_ID = "io.github.chris.desktop-undo"
var SUPER = 64
var SHIFT = 1
var CTRL = 4
var ALT = 8

var CANDIDATES = [
    {
        keys: "SUPER + Z",
        modmask: SUPER,
        key: "Z",
        desc: "Desktop undo",
        cmd: "omarchy-shell io.github.chris.desktop-undo undo ''",
        alternates: [
            { keys: "SUPER + ALT + Z", modmask: SUPER + ALT, key: "Z" }
        ]
    },
    {
        keys: "SUPER + Y",
        modmask: SUPER,
        key: "Y",
        desc: "Desktop redo",
        cmd: "omarchy-shell io.github.chris.desktop-undo redo ''",
        alternates: [
            { keys: "SUPER + ALT + Y", modmask: SUPER + ALT, key: "Y" }
        ]
    },
    {
        keys: "SUPER + SHIFT + Z",
        modmask: SUPER + SHIFT,
        key: "Z",
        desc: "Desktop undo timeline",
        cmd: "omarchy-shell shell summon io.github.chris.desktop-undo",
        alternates: [
            { keys: "SUPER + ALT + SHIFT + Z", modmask: SUPER + SHIFT + ALT, key: "Z" }
        ]
    }
]

var offer = {
    needed: true,
    note: "",
    already: 0,
    installed: [],
    toAdd: [],
    skipped: []
}

function setOffer(next) {
    offer = next || offer
}

function parseBinds(raw) {
    if (!raw)
        return []
    var data = raw
    if (typeof raw === "string") {
        try {
            data = JSON.parse(raw)
        } catch (e) {
            return []
        }
    }
    return data && data.length ? data : []
}

function keyOf(bind) {
    return String((bind && bind.key) || "").toUpperCase()
}

function isOurs(bind) {
    if (!bind)
        return false
    var arg = String(bind.arg || "")
    var desc = String(bind.description || "")
    if (arg.indexOf(PLUGIN_ID) >= 0)
        return true
    for (var i = 0; i < CANDIDATES.length; i++) {
        if (desc === CANDIDATES[i].desc)
            return true
    }
    return false
}

function oursCount(binds) {
    var n = 0
    var list = binds || []
    for (var i = 0; i < list.length; i++) {
        if (isOurs(list[i]))
            n++
    }
    return n
}

function keysFromModmask(modmask, key) {
    var parts = []
    var m = Number(modmask) || 0
    if (m & SUPER)
        parts.push("SUPER")
    if (m & CTRL)
        parts.push("CTRL")
    if (m & ALT)
        parts.push("ALT")
    if (m & SHIFT)
        parts.push("SHIFT")
    var k = String(key || "").toUpperCase()
    if (k)
        parts.push(k)
    return parts.join(" + ")
}

function prettyKeys(keys) {
    return String(keys || "")
        .replace(/SUPER/g, "Super")
        .replace(/SHIFT/g, "Shift")
        .replace(/CTRL/g, "Ctrl")
        .replace(/ALT/g, "Alt")
        .replace(/ \+ /g, "+")
}

function cmdForDesc(desc) {
    var want = String(desc || "")
    for (var i = 0; i < CANDIDATES.length; i++) {
        if (CANDIDATES[i].desc === want)
            return CANDIDATES[i].cmd
    }
    return ""
}

function oursLive(binds) {
    var out = []
    var list = binds || []
    for (var i = 0; i < list.length; i++) {
        var b = list[i]
        if (!isOurs(b))
            continue
        var desc = String(b.description || "")
        var keys = keysFromModmask(b.modmask, keyOf(b))
        out.push({
            keys: keys,
            chosen: keys,
            desc: desc,
            cmd: cmdForDesc(desc),
            modmask: Number(b.modmask),
            key: keyOf(b)
        })
    }
    return out
}

function comboOwner(binds, modmask, key) {
    var want = String(key || "").toUpperCase()
    var list = binds || []
    for (var i = 0; i < list.length; i++) {
        var b = list[i]
        if (Number(b.modmask) !== Number(modmask))
            continue
        if (keyOf(b) !== want)
            continue
        if (isOurs(b))
            return { ours: true, desc: String(b.description || "") }
        return { ours: false, desc: String(b.description || b.dispatcher || "already bound") }
    }
    return null
}

function pickCombo(binds, candidate) {
    var owner = comboOwner(binds, candidate.modmask, candidate.key)
    if (!owner)
        return { keys: candidate.keys, modmask: candidate.modmask, key: candidate.key, desc: candidate.desc, cmd: candidate.cmd, chosen: candidate.keys }
    if (owner.ours)
        return { already: true, keys: candidate.keys, desc: candidate.desc, cmd: candidate.cmd, chosen: candidate.keys }
    var alts = candidate.alternates || []
    for (var i = 0; i < alts.length; i++) {
        var a = alts[i]
        var altOwner = comboOwner(binds, a.modmask, a.key)
        if (!altOwner)
            return {
                keys: a.keys,
                modmask: a.modmask,
                key: a.key,
                desc: candidate.desc,
                cmd: candidate.cmd,
                chosen: a.keys,
                preferred: candidate.keys,
                conflict: owner.desc
            }
        if (altOwner.ours)
            return { already: true, keys: a.keys, desc: candidate.desc, cmd: candidate.cmd, chosen: a.keys }
    }
    return { skipped: true, keys: candidate.keys, desc: candidate.desc, conflict: owner.desc }
}

function suggestedKeys() {
    return CANDIDATES.map(function(c) { return c.keys }).join(", ")
}

function plan(binds) {
    var toAdd = []
    var skipped = []
    var already = 0
    var installed = oursLive(binds)
    for (var i = 0; i < CANDIDATES.length; i++) {
        var pick = pickCombo(binds, CANDIDATES[i])
        if (pick.already)
            already++
        else if (pick.skipped)
            skipped.push(pick)
        else
            toAdd.push(pick)
    }
    var needed = installed.length === 0
    var note = ""
    if (!needed)
        note = installed.map(function(it) { return prettyKeys(it.keys) + " " + String(it.desc || "").replace(/^Desktop /i, "") }).join(" · ")
    else if (!toAdd.length && skipped.length)
        note = skipped.map(function(s) { return prettyKeys(s.keys) + " is " + (s.conflict || "taken") }).join("; ")
    else if (toAdd.length) {
        var bits = toAdd.map(function(p) { return prettyKeys(p.chosen || p.keys) })
        note = "Suggested: " + bits.join(", ")
        for (var s = 0; s < skipped.length; s++)
            note += " — skipped " + prettyKeys(skipped[s].keys) + " (" + skipped[s].conflict + ")"
    } else
        note = "Suggested: " + CANDIDATES.map(function(c) { return prettyKeys(c.keys) }).join(", ")
    return { needed: needed, already: already, installed: installed, toAdd: toAdd, skipped: skipped, note: note }
}

function luaLine(item) {
    var keys = String(item.chosen || item.keys || "").replace(/"/g, "")
    var desc = String(item.desc || "").replace(/"/g, "")
    var cmd = String(item.cmd || "").replace(/"/g, '\\"')
    return "o.bind(\"" + keys + "\", \"" + desc + "\", \"" + cmd + "\")"
}

function luaBlock(items) {
    var lines = []
    var list = items || []
    for (var i = 0; i < list.length; i++)
        lines.push(luaLine(list[i]))
    return lines.join("\n")
}

function writeItems(plan) {
    var items = []
    var seen = {}
    function add(it) {
        if (!it)
            return
        var d = String(it.desc || "")
        if (!d || seen[d])
            return
        if (!(it.chosen || it.keys) || !it.cmd)
            return
        seen[d] = true
        items.push(it)
    }
    var p = plan || offer
    var addl = p.toAdd || []
    for (var j = 0; j < addl.length; j++)
        add(addl[j])
    var inst = p.installed || []
    for (var i = 0; i < inst.length; i++)
        add(inst[i])
    return items
}

function statusLine(plan) {
    var p = plan || offer
    var inst = p.installed || []
    if (inst.length)
        return inst.map(function(it) { return prettyKeys(it.keys) + " " + String(it.desc || "").replace(/^Desktop /i, "") }).join(" · ")
    var bits = (p.toAdd || []).map(function(it) { return prettyKeys(it.chosen || it.keys) })
    if (bits.length)
        return "No hotkey set. Suggested: " + bits.join(", ")
    if (p.skipped && p.skipped.length)
        return "No hotkey set. " + (p.note || "preferred combos are taken")
    return "No hotkey set. Suggested: " + CANDIDATES.map(function(c) { return prettyKeys(c.keys) }).join(", ")
}

function applyScan(raw) {
    var p = plan(parseBinds(raw))
    setOffer(p)
    return p
}

function notifyBody(items, skipped) {
    var lines = []
    var list = items || []
    for (var i = 0; i < list.length; i++) {
        var it = list[i]
        lines.push((it.chosen || it.keys) + " — " + it.desc)
    }
    var miss = skipped || []
    for (var s = 0; s < miss.length; s++)
        lines.push("skipped " + miss[s].keys + " (" + (miss[s].conflict || "taken") + ")")
    return lines.join("\n")
}

function notifyArgv(appName, headline, body) {
    return ["omarchy", "notification", "send", "--app-name", String(appName || PLUGIN_ID), "-g", "󰌌", String(headline || "Keybindings"), String(body || "")]
}
