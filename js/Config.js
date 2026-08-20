.pragma library

var VERSION = 1

var hideChipAtZero = true
var firstRunShown = false
var extraExclusions = []
var revision = 0

function snapshot() {
    return {
        version: VERSION,
        hideChipAtZero: hideChipAtZero,
        firstRunShown: firstRunShown,
        extraExclusions: extraExclusions.slice(),
        revision: revision
    }
}

function load(raw) {
    var data = raw
    if (typeof raw === "string") {
        try {
            data = JSON.parse(raw)
        } catch (e) {
            return false
        }
    }
    if (!data || typeof data !== "object")
        return false
    if (data.hideChipAtZero !== undefined)
        hideChipAtZero = !!data.hideChipAtZero
    if (data.firstRunShown !== undefined)
        firstRunShown = !!data.firstRunShown
    extraExclusions = []
    var list = data.extraExclusions || data.excludeAppIds || []
    for (var i = 0; i < list.length; i++) {
        if (list[i])
            extraExclusions.push(String(list[i]))
    }
    revision += 1
    return true
}

function serialize() {
    return JSON.stringify({
        version: VERSION,
        hideChipAtZero: hideChipAtZero,
        firstRunShown: firstRunShown,
        extraExclusions: extraExclusions
    }, null, 2)
}

function markFirstRunShown() {
    firstRunShown = true
    revision += 1
}

function setHideChipAtZero(value) {
    hideChipAtZero = !!value
    revision += 1
}
