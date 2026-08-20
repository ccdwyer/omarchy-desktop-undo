.pragma library

// Resolve the argv used to undo a close. Window class is never treated as
// an executable; missing probe metadata is "relaunch unavailable".

function argvFor(entry) {
    if (!entry)
        return null
    var r = entry.relaunch
    if (!r)
        return null
    if (r.argv && r.argv.length)
        return r.argv
    if (r.windowArgv && r.windowArgv.length)
        return r.windowArgv
    return null
}

function unavailableReason(entry) {
    if (argvFor(entry) && argvFor(entry).length)
        return ""
    return "relaunch unavailable"
}
