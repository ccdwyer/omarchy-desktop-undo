.pragma library

// Host settings adapter. Values come from the inline shell.json entry
// (injected as `settings` / `setting()`). This module never persists.

var DEFAULTS = {
    hideChipAtZero: true,
    extraExclusions: ""
}

function parseExclusions(value) {
    var out = []
    if (value === undefined || value === null || value === "")
        return out
    if (typeof value !== "string" && value.length !== undefined) {
        for (var i = 0; i < value.length; i++) {
            if (value[i])
                out.push(String(value[i]))
        }
        return out
    }
    var parts = String(value).split(",")
    for (var j = 0; j < parts.length; j++) {
        var item = parts[j].replace(/^\s+|\s+$/g, "")
        if (item)
            out.push(item)
    }
    return out
}

function boolFrom(value, fallback) {
    if (value === undefined || value === null || value === "")
        return !!fallback
    if (value === true || value === false)
        return value
    var s = String(value).toLowerCase()
    if (s === "true" || s === "1" || s === "yes")
        return true
    if (s === "false" || s === "0" || s === "no")
        return false
    return !!fallback
}

function read(settings, key, fallback) {
    if (settings && settings[key] !== undefined && settings[key] !== null && settings[key] !== "")
        return settings[key]
    if (fallback !== undefined)
        return fallback
    return DEFAULTS[key]
}

function extraExclusionsFrom(settings) {
    return parseExclusions(read(settings, "extraExclusions", DEFAULTS.extraExclusions))
}

function hideChipAtZeroFrom(settings) {
    return boolFrom(read(settings, "hideChipAtZero", DEFAULTS.hideChipAtZero), DEFAULTS.hideChipAtZero)
}
