.pragma library

// Inverse-operation table. Every recorded type maps to one or more hyprctl
// dispatcher steps plus the socket2 / clients-j confirmation expected for
// the transaction machine. Tiled swap is intentionally absent (1.0 cut).

function addr(entry) {
    var a = entry && (entry.address || (entry.before && entry.before.address) || (entry.after && entry.after.address))
    return String(a || "")
}

function workspaceOf(state) {
    if (!state)
        return 1
    return Number(state.workspace || state.workspaceId || 1)
}

function quoteAddress(address) {
    var a = String(address || "")
    if (!a)
        return ""
    return "address:" + a
}

function dispatchArgs(name, value) {
    if (!value)
        return name
    return name + " " + value
}

function inverseSteps(entry) {
    if (!entry || !entry.type)
        return []
    var type = entry.type
    var address = addr(entry)
    var before = entry.before || {}
    var after = entry.after || {}
    var steps = []

    if (type === "close") {
        steps.push({
            kind: "relaunch",
            dispatcher: "exec",
            expect: {
                name: "openwindow",
                className: entry.appId
            },
            timeoutMs: 5000,
            thenGeometry: !entry.multiWindow
        })
        if (!entry.multiWindow) {
            steps.push({
                kind: "workspace",
                dispatcher: "movetoworkspacesilent",
                arg: String(workspaceOf(before)) + "," + quoteAddress(address),
                expect: { name: "movewindowv2", address: address },
                optionalAddress: true
            })
            if (before.floating) {
                steps.push({
                    kind: "float",
                    dispatcher: "setfloating",
                    arg: quoteAddress(address),
                    expect: { name: "changefloatingmode", address: address, floating: 1 },
                    optionalAddress: true
                })
                steps.push({
                    kind: "move",
                    dispatcher: "movewindowpixel",
                    arg: "exact " + Number(before.x || 0) + " " + Number(before.y || 0) + "," + quoteAddress(address),
                    expectClients: { address: address, x: before.x, y: before.y },
                    optionalAddress: true
                })
                steps.push({
                    kind: "resize",
                    dispatcher: "resizewindowpixel",
                    arg: "exact " + Number(before.w || 0) + " " + Number(before.h || 0) + "," + quoteAddress(address),
                    expectClients: { address: address, w: before.w, h: before.h },
                    optionalAddress: true
                })
            }
        }
        return steps
    }

    if (type === "move" || type === "resize") {
        if (!before.floating && !after.floating) {
            return [{
                kind: "skip",
                reason: "tiled-geometry-out-of-scope",
                dispatcher: null
            }]
        }
        if (type === "move" || (before.x !== after.x || before.y !== after.y)) {
            steps.push({
                kind: "move",
                dispatcher: "movewindowpixel",
                arg: "exact " + Number(before.x || 0) + " " + Number(before.y || 0) + "," + quoteAddress(address),
                expectClients: { address: address, x: before.x, y: before.y }
            })
        }
        if (type === "resize" || (before.w !== after.w || before.h !== after.h)) {
            steps.push({
                kind: "resize",
                dispatcher: "resizewindowpixel",
                arg: "exact " + Number(before.w || 0) + " " + Number(before.h || 0) + "," + quoteAddress(address),
                expectClients: { address: address, w: before.w, h: before.h }
            })
        }
        return steps
    }

    if (type === "workspace") {
        steps.push({
            kind: "workspace",
            dispatcher: "movetoworkspacesilent",
            arg: String(workspaceOf(before)) + "," + quoteAddress(address),
            expect: { name: "movewindowv2", address: address }
        })
        return steps
    }

    if (type === "float") {
        var wantFloating = !!before.floating
        steps.push({
            kind: "float",
            dispatcher: wantFloating ? "setfloating" : "settiled",
            arg: quoteAddress(address),
            expect: { name: "changefloatingmode", address: address, floating: wantFloating ? 1 : 0 }
        })
        if (wantFloating) {
            steps.push({
                kind: "move",
                dispatcher: "movewindowpixel",
                arg: "exact " + Number(before.x || 0) + " " + Number(before.y || 0) + "," + quoteAddress(address),
                expectClients: { address: address, x: before.x, y: before.y }
            })
            steps.push({
                kind: "resize",
                dispatcher: "resizewindowpixel",
                arg: "exact " + Number(before.w || 0) + " " + Number(before.h || 0) + "," + quoteAddress(address),
                expectClients: { address: address, w: before.w, h: before.h }
            })
        }
        return steps
    }

    if (type === "fullscreen") {
        var internal = Number(before.fullscreen || 0)
        var client = Number(before.fullscreenClient !== undefined ? before.fullscreenClient : before.fullscreen || 0)
        steps.push({
            kind: "fullscreen",
            dispatcher: "fullscreenstate",
            arg: String(internal) + " " + String(client) + "," + quoteAddress(address),
            expect: { name: "fullscreen", state: internal > 0 ? 1 : 0 },
            expectClients: {
                address: address,
                fullscreen: internal,
                fullscreenClient: client
            }
        })
        return steps
    }

    return []
}

function redoSteps(entry) {
    if (!entry)
        return []
    var flipped = {
        type: entry.type,
        address: addr(entry),
        appId: entry.appId,
        title: entry.title,
        before: entry.after,
        after: entry.before,
        relaunch: entry.relaunch,
        multiWindow: entry.multiWindow,
        fidelity: entry.fidelity
    }
    if (entry.type === "close") {
        return [{
            kind: "close",
            dispatcher: "closewindow",
            arg: quoteAddress(addr(entry)),
            expect: { name: "closewindow", address: addr(entry) }
        }]
    }
    return inverseSteps(flipped)
}

function dispatchString(step) {
    if (!step || !step.dispatcher)
        return ""
    if (!step.arg)
        return step.dispatcher
    return step.dispatcher + " " + step.arg
}

function clientsMatch(snapshot, expect) {
    if (!expect || !snapshot)
        return false
    var list = snapshot
    for (var i = 0; i < list.length; i++) {
        var c = list[i]
        var a = String(c.address || "").toLowerCase()
        var want = String(expect.address || "").toLowerCase()
        if (a !== want)
            continue
        if (expect.hasOwnProperty("x") && Number((c.at && c.at[0]) || c.x) !== Number(expect.x))
            return false
        if (expect.hasOwnProperty("y") && Number((c.at && c.at[1]) || c.y) !== Number(expect.y))
            return false
        if (expect.hasOwnProperty("w") && Number((c.size && c.size[0]) || c.w) !== Number(expect.w))
            return false
        if (expect.hasOwnProperty("h") && Number((c.size && c.size[1]) || c.h) !== Number(expect.h))
            return false
        if (expect.hasOwnProperty("fullscreen") && Number(c.fullscreen || 0) !== Number(expect.fullscreen))
            return false
        if (expect.hasOwnProperty("fullscreenClient") && Number(c.fullscreenClient || 0) !== Number(expect.fullscreenClient))
            return false
        if (expect.hasOwnProperty("workspace")) {
            var ws = c.workspace && typeof c.workspace === "object" ? c.workspace.id : c.workspace
            if (Number(ws) !== Number(expect.workspace))
                return false
        }
        if (expect.hasOwnProperty("floating") && !!c.floating !== !!expect.floating)
            return false
        if (expect.absent)
            return false
        return true
    }
    if (expect.absent)
        return true
    return false
}

function fidelityFor(action, apps) {
    if (!action)
        return "exact"
    if (action.type === "close") {
        if (apps && apps.isMultiWindow && apps.isMultiWindow(action.appId))
            return "best-effort"
        return "best-effort"
    }
    if (action.type === "move" || action.type === "resize") {
        var floating = action.floating || (action.before && action.before.floating) || (action.after && action.after.floating)
        if (!floating)
            return "workspace-only"
        return "exact"
    }
    return "exact"
}

function shouldRecord(action, apps, extraExclusions) {
    if (!action || action.type === "open")
        return false
    if (action.type === "move" || action.type === "resize") {
        var floating = action.floating || (action.before && action.before.floating)
        if (!floating)
            return false
    }
    if (apps && apps.isExcluded && apps.isExcluded(action.appId, extraExclusions))
        return false
    return true
}

function allInverseTypes() {
    return ["close", "move", "resize", "workspace", "float", "fullscreen"]
}
