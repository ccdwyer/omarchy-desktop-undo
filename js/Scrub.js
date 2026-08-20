.pragma library

// Serialized target-driven scrub. Only one desired cursor exists.
// The service enqueues a single undo/redo after each confirmation.

var desiredTarget = -1
var presentCursor = -1
var pendingCloseAction = ""
var active = false

function snapshot() {
    return {
        desiredTarget: desiredTarget,
        presentCursor: presentCursor,
        pendingCloseAction: pendingCloseAction,
        active: active
    }
}

function reset() {
    desiredTarget = -1
    presentCursor = -1
    pendingCloseAction = ""
    active = false
}

function setDesired(target, entryCount, currentCursor) {
    var count = Number(entryCount) || 0
    var t = Number(target)
    if (isNaN(t))
        return snapshot()
    if (t < 0)
        t = 0
    if (t > count)
        t = count
    if (!active) {
        active = true
        presentCursor = count
        if (desiredTarget < 0)
            desiredTarget = currentCursor === undefined ? count : Number(currentCursor)
    }
    desiredTarget = t
    return snapshot()
}

function requestCommit() {
    if (!active)
        return snapshot()
    pendingCloseAction = "commit"
    return snapshot()
}

function requestCancel() {
    if (!active)
        return snapshot()
    pendingCloseAction = "cancel"
    if (presentCursor >= 0)
        desiredTarget = presentCursor
    return snapshot()
}

function nextDirection(currentCursor) {
    if (!active)
        return ""
    var cur = Number(currentCursor)
    if (isNaN(cur))
        return ""
    if (cur === desiredTarget)
        return "at-target"
    if (cur > desiredTarget)
        return "undo"
    return "redo"
}

function atTargetAndIdle(currentCursor, busy) {
    return active && !busy && Number(currentCursor) === desiredTarget
}

function dismissKind() {
    return pendingCloseAction
}
