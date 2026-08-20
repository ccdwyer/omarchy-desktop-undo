.pragma library

// clients -j snapshot indexing and diffs. Events/geometry signals are
// triggers; the diff is the source of truth for the journal record.

function normalizeAddress(value) {
    var s = String(value || "").trim().toLowerCase()
    if (!s)
        return ""
    if (s.indexOf("0x") !== 0)
        s = "0x" + s
    return s
}

function workspaceId(client) {
    if (!client)
        return 0
    var ws = client.workspace
    if (ws && typeof ws === "object")
        return Number(ws.id || 0)
    return Number(client.workspaceId || 0)
}

function workspaceName(client) {
    if (!client)
        return ""
    var ws = client.workspace
    if (ws && typeof ws === "object")
        return String(ws.name || ws.id || "")
    if (client.workspaceName)
        return String(client.workspaceName)
    return String(workspaceId(client) || "")
}

function point(client) {
    var at = client && client.at
    if (at && at.length >= 2)
        return { x: Number(at[0]) || 0, y: Number(at[1]) || 0 }
    return { x: Number(client && client.x) || 0, y: Number(client && client.y) || 0 }
}

function sizeOf(client) {
    var sz = client && client.size
    if (sz && sz.length >= 2)
        return { w: Number(sz[0]) || 0, h: Number(sz[1]) || 0 }
    return { w: Number(client && client.width) || 0, h: Number(client && client.height) || 0 }
}

function fullscreenValue(client) {
    if (!client)
        return 0
    if (typeof client.fullscreen === "number")
        return client.fullscreen
    if (client.fullscreen === true)
        return 2
    return Number(client.fullscreen) || 0
}

function fullscreenClientValue(client) {
    if (!client)
        return 0
    if (typeof client.fullscreenClient === "number")
        return client.fullscreenClient
    return Number(client.fullscreenClient) || 0
}

function captureState(client) {
    if (!client)
        return null
    var p = point(client)
    var s = sizeOf(client)
    return {
        address: normalizeAddress(client.address),
        appId: String(client["class"] || client.initialClass || ""),
        title: String(client.title || client.initialTitle || ""),
        pid: Number(client.pid) || 0,
        workspace: workspaceId(client),
        workspaceName: workspaceName(client),
        x: p.x,
        y: p.y,
        w: s.w,
        h: s.h,
        floating: !!client.floating,
        fullscreen: fullscreenValue(client),
        fullscreenClient: fullscreenClientValue(client),
        monitor: client.monitor
    }
}

function indexByAddress(clients) {
    var map = {}
    var list = clients || []
    for (var i = 0; i < list.length; i++) {
        var c = list[i]
        if (!c)
            continue
        var addr = normalizeAddress(c.address)
        if (!addr)
            continue
        map[addr] = c
    }
    return map
}

function parseClients(raw) {
    if (!raw)
        return []
    if (typeof raw !== "string")
        return raw
    try {
        var parsed = JSON.parse(raw)
        return parsed && parsed.length ? parsed : []
    } catch (e) {
        return []
    }
}

function samePoint(a, b) {
    if (!a || !b)
        return false
    return a.x === b.x && a.y === b.y
}

function addressForPid(clients, pid) {
    var want = Number(pid) || 0
    if (!want)
        return ""
    var list = clients || []
    for (var i = 0; i < list.length; i++) {
        if (Number(list[i].pid) === want)
            return normalizeAddress(list[i].address)
    }
    return ""
}

function coalesceDrag(existing, action) {
    if (!action)
        return existing || null
    if (!existing) {
        return {
            type: action.type,
            address: action.address,
            appId: action.appId,
            title: action.title,
            before: action.before,
            after: action.after,
            floating: !!action.floating || !!(action.before && action.before.floating)
        }
    }
    var before = existing.before
    var after = action.after
    var moved = before && after && (before.x !== after.x || before.y !== after.y)
    var resized = before && after && (before.w !== after.w || before.h !== after.h)
    var type = "move"
    if (resized && !moved)
        type = "resize"
    return {
        type: type,
        address: existing.address || action.address,
        appId: action.appId || existing.appId,
        title: action.title || existing.title,
        before: before,
        after: after,
        floating: !!(existing.floating || action.floating || (before && before.floating) || (after && after.floating))
    }
}

function sameSize(a, b) {
    return a.w === b.w && a.h === b.h
}

function geometryChanged(before, after) {
    return !samePoint(before, after) || !sameSize(before, after)
}

function findFullscreenChange(beforeList, afterList, hintAddress) {
    var beforeMap = indexByAddress(beforeList)
    var afterMap = indexByAddress(afterList)
    if (hintAddress) {
        var addr = normalizeAddress(hintAddress)
        if (beforeMap[addr] && afterMap[addr]) {
            var b = captureState(beforeMap[addr])
            var a = captureState(afterMap[addr])
            if (b.fullscreen !== a.fullscreen || b.fullscreenClient !== a.fullscreenClient)
                return { before: b, after: a }
        }
    }
    var keys = []
    for (var k in afterMap) {
        if (afterMap.hasOwnProperty(k))
            keys.push(k)
    }
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i]
        if (!beforeMap[key])
            continue
        var prev = captureState(beforeMap[key])
        var next = captureState(afterMap[key])
        if (prev.fullscreen !== next.fullscreen || prev.fullscreenClient !== next.fullscreenClient)
            return { before: prev, after: next }
    }
    return null
}

function findActive(clients, address) {
    var addr = normalizeAddress(address)
    var list = clients || []
    for (var i = 0; i < list.length; i++) {
        if (normalizeAddress(list[i].address) === addr)
            return list[i]
    }
    return null
}

function diff(beforeList, afterList, trigger) {
    var beforeMap = indexByAddress(beforeList)
    var afterMap = indexByAddress(afterList)
    var actions = []
    var seen = {}
    var t = trigger || {}

    function add(action) {
        if (!action || !action.address)
            return
        var key = action.type + ":" + action.address
        if (seen[key])
            return
        seen[key] = true
        actions.push(action)
    }

    var afterKeys = []
    for (var ak in afterMap) {
        if (afterMap.hasOwnProperty(ak))
            afterKeys.push(ak)
    }
    var beforeKeys = []
    for (var bk in beforeMap) {
        if (beforeMap.hasOwnProperty(bk))
            beforeKeys.push(bk)
    }

    for (var i = 0; i < beforeKeys.length; i++) {
        var addr = beforeKeys[i]
        var prevClient = beforeMap[addr]
        var nextClient = afterMap[addr]
        var prev = captureState(prevClient)
        if (!nextClient) {
            add({
                type: "close",
                address: addr,
                appId: prev.appId,
                title: prev.title,
                before: prev,
                after: null
            })
            continue
        }
        var next = captureState(nextClient)
        if (prev.workspace !== next.workspace) {
            add({
                type: "workspace",
                address: addr,
                appId: next.appId,
                title: next.title,
                before: prev,
                after: next
            })
        }
        if (!!prev.floating !== !!next.floating) {
            add({
                type: "float",
                address: addr,
                appId: next.appId,
                title: next.title,
                before: prev,
                after: next
            })
        }
        if (prev.fullscreen !== next.fullscreen || prev.fullscreenClient !== next.fullscreenClient) {
            add({
                type: "fullscreen",
                address: addr,
                appId: next.appId,
                title: next.title,
                before: prev,
                after: next
            })
        }
        if (geometryChanged(prev, next)) {
            var geomType = (!sameSize(prev, next) && samePoint(prev, next)) ? "resize" : "move"
            if (!sameSize(prev, next) && !samePoint(prev, next))
                geomType = "move"
            add({
                type: geomType,
                address: addr,
                appId: next.appId,
                title: next.title,
                before: prev,
                after: next,
                floating: !!next.floating || !!prev.floating
            })
        }
    }

    for (var j = 0; j < afterKeys.length; j++) {
        var opened = afterKeys[j]
        if (beforeMap[opened])
            continue
        var st = captureState(afterMap[opened])
        add({
            type: "open",
            address: opened,
            appId: st.appId,
            title: st.title,
            before: null,
            after: st
        })
    }

    if (t.name === "fullscreen" && actions.length === 0) {
        var hit = findFullscreenChange(beforeList, afterList, t.address)
        if (hit) {
            add({
                type: "fullscreen",
                address: hit.after.address,
                appId: hit.after.appId,
                title: hit.after.title,
                before: hit.before,
                after: hit.after
            })
        }
    }

    if (t.address) {
        var focused = []
        var rest = []
        var want = normalizeAddress(t.address)
        for (var n = 0; n < actions.length; n++) {
            if (actions[n].address === want)
                focused.push(actions[n])
            else
                rest.push(actions[n])
        }
        actions = focused.concat(rest)
    }

    return actions
}

function relevantForTrigger(action, trigger) {
    if (!action)
        return false
    var t = trigger || {}
    if (t.name === "closewindow" || t.name === "kill")
        return action.type === "close"
    if (t.name === "openwindow")
        return action.type === "open"
    if (t.name === "movewindow" || t.name === "movewindowv2")
        return action.type === "workspace"
    if (t.name === "changefloatingmode")
        return action.type === "float"
    if (t.name === "fullscreen")
        return action.type === "fullscreen"
    if (t.name === "geometry")
        return action.type === "move" || action.type === "resize"
    if (t.name === "poll-state")
        return action.type !== "open" && action.type !== "move" && action.type !== "resize"
    return action.type !== "open"
}
