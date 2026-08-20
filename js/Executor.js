.pragma library

// Transaction state machine. Each undo/redo/scrub step dispatches, then
// waits for the expected socket2 event or a clients-j confirmation.
// Self-generated events are consumed by the pending transaction so they
// never re-enter the journal.

var TIMEOUT_MS = 500

function create() {
    return {
        queue: [],
        pending: null,
        busy: false,
        lastError: "",
        generation: 0
    }
}

function isBusy(state) {
    return !!(state && (state.busy || (state.pending && !state.pending.done)))
}

function enqueue(state, steps, meta) {
    if (!state || !steps || !steps.length)
        return false
    var info = meta || {}
    if (!info.batchId)
        info.batchId = "b-" + (state.generation + 1) + "-" + Date.now()
    var added = 0
    for (var i = 0; i < steps.length; i++) {
        if (steps[i] && steps[i].kind === "skip")
            continue
        state.queue.push({
            step: steps[i],
            meta: info,
            enqueuedAt: Date.now()
        })
        added += 1
    }
    if (added === 0) {
        state.queue.push({
            step: { kind: "noop" },
            meta: info,
            enqueuedAt: Date.now()
        })
        added = 1
    }
    state.busy = state.queue.length > 0 || !!state.pending
    return added > 0 || !!state.pending
}

function beginNext(state, now) {
    if (!state)
        return null
    if (state.pending && !state.pending.done)
        return null
    if (!state.queue.length) {
        state.busy = false
        state.pending = null
        return null
    }
    var item = state.queue.shift()
    var step = item.step
    state.generation += 1
    var timeout = (step && step.timeoutMs) || TIMEOUT_MS
    var t = now === undefined || now === null ? Date.now() : now
    state.pending = {
        id: state.generation,
        step: step,
        meta: item.meta || {},
        startedAt: t,
        timeoutAt: t + timeout,
        done: false,
        confirmed: false
    }
    state.busy = true
    return state.pending
}

function completePending(state, reason) {
    if (!state || !state.pending)
        return null
    var finished = state.pending
    finished.done = true
    finished.confirmed = reason === "event" || reason === "clients" || reason === "dispatch"
    finished.reason = reason
    state.lastFinished = finished
    state.pending = null
    if (!state.queue.length)
        state.busy = false
    return finished
}

function onEvent(state, parsed, matchFn) {
    if (!state || !state.pending || !parsed)
        return false
    var expect = state.pending.step && state.pending.step.expect
    if (!expect)
        return false
    var ok = matchFn ? matchFn(parsed, expect) : _defaultMatch(parsed, expect)
    if (!ok)
        return false
    completePending(state, "event")
    return true
}

function onClients(state, snapshot, matchFn) {
    if (!state || !state.pending)
        return false
    var expect = state.pending.step && state.pending.step.expectClients
    if (!expect)
        return false
    var ok = matchFn ? matchFn(snapshot, expect) : false
    if (!ok)
        return false
    completePending(state, "clients")
    return true
}

function tick(state, now) {
    if (!state || !state.pending)
        return null
    var t = now === undefined || now === null ? Date.now() : now
    if (t < state.pending.timeoutAt)
        return null
    return fail(state, "timeout")
}

function fail(state, reason) {
    if (!state)
        return null
    var finished = state.pending
    if (finished) {
        finished.done = true
        finished.confirmed = false
        finished.reason = reason || "fail"
    } else {
        finished = {
            done: true,
            confirmed: false,
            reason: reason || "fail",
            meta: {},
            step: null
        }
    }
    state.lastFinished = finished
    state.lastError = reason || "fail"
    state.pending = null
    state.queue = []
    state.busy = false
    return finished
}

function cancel(state) {
    if (!state)
        return
    state.queue = []
    state.pending = null
    state.busy = false
}

function batchRemaining(state, batchId) {
    if (!state || !batchId)
        return 0
    var n = 0
    if (state.pending && state.pending.meta && state.pending.meta.batchId === batchId)
        n += 1
    var q = state.queue || []
    for (var i = 0; i < q.length; i++) {
        if (q[i].meta && q[i].meta.batchId === batchId)
            n += 1
    }
    return n
}

function _defaultMatch(parsed, expect) {
    if (!parsed || !expect)
        return false
    if (expect.name && parsed.name !== expect.name)
        return false
    if (expect.address && parsed.fields && parsed.fields.address) {
        if (String(parsed.fields.address).toLowerCase() !== String(expect.address).toLowerCase())
            return false
    }
    return true
}

function shouldSuppressRecord(state, parsed, matchFn) {
    if (!state || !parsed)
        return false
    if (state.pending && onEvent(state, parsed, matchFn))
        return true
    return false
}

function retarget(state, oldAddr, newAddr, rewriteFn) {
    if (!state || !oldAddr || !newAddr)
        return 0
    var n = 0
    function apply(step) {
        if (!step || !rewriteFn)
            return
        rewriteFn(step, oldAddr, newAddr)
        n += 1
    }
    if (state.pending)
        apply(state.pending.step)
    var q = state.queue || []
    for (var i = 0; i < q.length; i++)
        apply(q[i].step)
    return n
}
