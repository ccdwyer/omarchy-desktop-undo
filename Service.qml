import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import "js/Journal.js" as Journal
import "js/Parser.js" as Parser
import "js/Diff.js" as Diff
import "js/Ops.js" as Ops
import "js/Executor.js" as Executor
import "js/Apps.js" as Apps
import "js/Config.js" as Config

Item {
  id: root

  property var shell: null
  property var manifest: null
  property var pluginRegistry: null
  property var settings: ({})
  property bool hideChipAtZero: true
  property string extraExclusions: ""
  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || ""

  readonly property string pluginId: "io.github.chris.desktop-undo"
  readonly property string pluginDir: {
    var u = String(Qt.resolvedUrl("."))
    if (u.indexOf("file://") === 0)
      u = u.slice(7)
    if (u.length > 1 && u.charAt(u.length - 1) === "/")
      u = u.slice(0, u.length - 1)
    return u
  }
  readonly property string home: Quickshell.env("HOME") || "/tmp"
  readonly property string stateHome: {
    var xdg = Quickshell.env("XDG_STATE_HOME")
    if (xdg && xdg.length)
      return xdg + "/desktop-undo"
    return home + "/.local/state/desktop-undo"
  }
  readonly property string journalPath: stateHome + "/journal.json"
  readonly property string probeBin: pluginDir + "/bin/undo-probe"
  readonly property string probeSh: pluginDir + "/compat/undo-probe.sh"

  property string probeCmd: probeSh
  property bool probeIsBinary: false
  property bool probeReady: false
  property bool hyprlandEventsLive: false
  property bool socketWanted: true
  property int socketBackoffMs: 250
  property string hyprVersion: ""
  property string lastActiveAddress: ""
  property var lastClients: []
  property var lastStableClients: []
  property var openCache: ({})
  property var tx: Executor.create()
  property var pendingRelaunch: null
  property var dragDirty: ({})
  property bool dragging: false
  property bool hydrating: true
  property bool journalLoaded: false
  property int bootProbesLeft: 0
  property var bootBuffer: []
  property string lastStatus: "starting"
  property int journalRevision: 0
  property int journalDepth: 0
  property int journalRedoDepth: 0
  property var overlayEntries: []
  property bool scrubbing: false
  property int scrubAnchor: -1

  readonly property int debounceMs: 150
  readonly property int pollMs: 250
  readonly property int idlePollMs: 1000

  function publish() {
    var snap = Journal.snapshot()
    root.journalRevision = snap.revision
    root.journalDepth = snap.depth
    root.journalRedoDepth = snap.redoDepth
    root.overlayEntries = snap.entries
  }

  function quote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'"
  }

  function uuid() {
    return Date.now().toString(16) + "-" + Math.floor(Math.random() * 0xffffffff).toString(16)
  }

  function probeCommand() {
    if (root.probeIsBinary)
      return root.probeBin
    return root.probeSh
  }

  function hostSettings() {
    var s = {
      hideChipAtZero: root.hideChipAtZero,
      extraExclusions: root.extraExclusions
    }
    var injected = root.settings
    if (injected && typeof injected === "object") {
      if (injected.hideChipAtZero !== undefined)
        s.hideChipAtZero = injected.hideChipAtZero
      if (injected.extraExclusions !== undefined)
        s.extraExclusions = injected.extraExclusions
    }
    return s
  }

  function exclusions() {
    return Config.extraExclusionsFrom(root.hostSettings())
  }

  function applyHostSettings() {
    root.hideChipAtZero = Config.hideChipAtZeroFrom(root.hostSettings())
    var raw = Config.read(root.hostSettings(), "extraExclusions", "")
    root.extraExclusions = typeof raw === "string" ? raw : (raw && raw.length ? raw.join(",") : "")
  }

  onSettingsChanged: root.applyHostSettings()

  function summonOverlay(payload) {
    var body = payload || "{}"
    if (shell && typeof shell.summon === "function") {
      shell.summon(root.pluginId, body)
      return "ok"
    }
    Quickshell.execDetached(["omarchy-shell", "shell", "summon", root.pluginId, body])
    return "ok"
  }

  function dispatchHypr(request) {
    if (!request)
      return false
    try {
      Hyprland.dispatch(request)
      return true
    } catch (e) {
      enqueueWork(["hyprctl", "dispatch"].concat(String(request).split(" ")), null)
      return true
    }
  }

  function enqueueWork(command, done) {
    workQueue.push({ command: command, done: done || null })
    runWork()
  }

  property var workQueue: []
  property var workCurrent: null

  function runWork() {
    if (workProc.running || root.workCurrent)
      return
    if (!workQueue.length)
      return
    root.workCurrent = workQueue.shift()
    workProc.command = root.workCurrent.command
    workProc.running = true
  }

  function requestClients(reason, trigger) {
    enqueueWork(["hyprctl", "-j", "clients"], function(text) {
      root.onClientsJson(text, reason, trigger)
    })
  }

  function onClientsJson(text, reason, trigger) {
    var clients = Diff.parseClients(text)
    if (!clients)
      clients = []
    var previous = root.lastClients
    root.lastClients = clients

    if (reason === "boot") {
      root.lastStableClients = clients
      root.seedOpenCache(clients)
      return
    }

    if (root.hydrating) {
      root.bootBuffer.push({ reason: reason, trigger: trigger || {}, previous: previous, clients: clients })
      return
    }

    if (Executor.isBusy(root.tx)) {
      if (root.tx.pending && root.tx.pending.step && root.tx.pending.step.expectClients) {
        if (Executor.onClients(root.tx, clients, Ops.clientsMatch)) {
          root.kickExecutor()
          return
        }
      }
    }

    if (reason === "event") {
      var actions = Diff.diff(previous, clients, trigger || {})
      root.ingestActions(actions, trigger || {}, previous, clients)
    }

    if (reason === "poll") {
      root.trackGeometry(previous, clients)
      if (!root.hyprlandEventsLive) {
        var polled = Diff.diff(previous, clients, { name: "poll-state" })
        root.ingestActions(polled, { name: "poll-state" }, previous, clients)
      }
    }
  }

  function trackGeometry(previous, clients) {
    var actions = Diff.diff(previous, clients, { name: "geometry" })
    var dirty = false
    for (var i = 0; i < actions.length; i++) {
      if (actions[i].type === "move" || actions[i].type === "resize") {
        if (actions[i].floating || (actions[i].before && actions[i].before.floating)) {
          dirty = true
          var addr = actions[i].address
          root.dragDirty[addr] = Diff.coalesceDrag(root.dragDirty[addr], actions[i])
        }
      }
    }
    if (dirty) {
      root.dragging = true
      pollTimer.interval = root.pollMs
      debounceTimer.restart()
    }
  }

  function ingestActions(actions, trigger, previous, clients) {
    if (!actions || !actions.length)
      return
    for (var i = 0; i < actions.length; i++) {
      var action = actions[i]
      if (trigger && trigger.name && !Diff.relevantForTrigger(action, trigger))
        continue
      if (action.type === "open") {
        root.cacheOpen(action, clients)
        root.maybeMatchCookie(action)
        continue
      }
      if (Executor.isBusy(root.tx) && !root.scrubbing)
        continue
      if (!Ops.shouldRecord(action, Apps, root.exclusions()))
        continue
      root.recordAction(action)
    }
  }

  function cacheOpen(action, clients) {
    var client = Diff.findActive(clients, action.address)
    var pid = client ? Number(client.pid) || 0 : 0
    var rec = {
      address: action.address,
      appId: action.appId,
      title: action.title,
      pid: pid,
      state: action.after,
      relaunch: null
    }
    var cache = root.openCache
    cache[action.address] = rec
    root.openCache = cache
    if (pid > 0)
      root.probePid(pid, action.address, false)
  }

  function seedOpenCache(clients) {
    var cache = {}
    var probes = 0
    var list = clients || []
    for (var i = 0; i < list.length; i++) {
      var st = Diff.captureState(list[i])
      if (!st || !st.address)
        continue
      cache[st.address] = {
        address: st.address,
        appId: st.appId,
        title: st.title,
        pid: st.pid,
        state: st,
        relaunch: null
      }
      if (st.pid > 0) {
        probes += 1
        root.probePid(st.pid, st.address, true)
      }
    }
    root.openCache = cache
    root.bootProbesLeft = probes
    if (probes === 0)
      root.finishBoot()
    else
      bootTimeout.restart()
  }

  function finishBoot() {
    if (!root.hydrating)
      return
    root.hydrating = false
    bootTimeout.stop()
    var buffered = root.bootBuffer
    root.bootBuffer = []
    for (var i = 0; i < buffered.length; i++) {
      var item = buffered[i]
      if (item.reason === "event")
        root.ingestActions(Diff.diff(item.previous, item.clients, item.trigger), item.trigger, item.previous, item.clients)
      else if (item.reason === "poll") {
        root.trackGeometry(item.previous, item.clients)
        if (!root.hyprlandEventsLive) {
          var polled = Diff.diff(item.previous, item.clients, { name: "poll-state" })
          root.ingestActions(polled, { name: "poll-state" }, item.previous, item.clients)
        }
      }
    }
    root.lastStatus = "ready"
  }

  function probePid(pid, address, boot) {
    enqueueWork([root.probeCommand(), "pid", String(pid)], function(text) {
      var info = null
      try {
        info = JSON.parse(String(text || "").trim() || "{}")
      } catch (e) {
        info = null
      }
      if (info && info.ok) {
        var rec = root.openCache[address]
        if (rec) {
          rec.relaunch = {
            cwd: info.cwd || "",
            argv: info.windowArgv && info.windowArgv.length ? info.windowArgv : (info.argv || []),
            cmdline: info.windowCmdline || info.cmdline || "",
            shellPid: info.shellPid || pid,
            windowPid: pid
          }
          var cache = root.openCache
          cache[address] = rec
          root.openCache = cache
        }
      }
      if (boot) {
        root.bootProbesLeft = Math.max(0, root.bootProbesLeft - 1)
        if (root.bootProbesLeft === 0)
          root.finishBoot()
      }
    })
  }

  function recordAction(action) {
    var cached = root.openCache[action.address] || {}
    var multi = Apps.isMultiWindow(action.appId)
    var fidelity = Ops.fidelityFor(action, Apps)
    if (action.type === "close" && multi)
      fidelity = "best-effort"
    var entry = {
      type: action.type,
      timestamp: Date.now(),
      address: action.address,
      appId: action.appId,
      title: action.title,
      before: action.before,
      after: action.after,
      fidelity: fidelity,
      multiWindow: multi,
      label: Apps.labelForType(action.type, fidelity, multi),
      glyph: Apps.glyphForType(action.type),
      relaunch: null
    }
    if (action.type === "close") {
      entry.relaunch = cached.relaunch ? JSON.parse(JSON.stringify(cached.relaunch)) : null
      if (!entry.before && cached.state)
        entry.before = cached.state
    }
    Journal.push(entry)
    root.publish()
    persistTimer.restart()
    if (action.type === "close") {
      var cache = root.openCache
      delete cache[action.address]
      root.openCache = cache
    }
    root.lastStatus = "recorded:" + action.type
  }

  function handleLine(line) {
    var parsed = Parser.parseLine(line)
    if (!parsed)
      return
    root.handleParsed(parsed)
  }

  function handleParsed(parsed) {
    if (!parsed)
      return
    if (parsed.kind === "unknown") {
      if (parsed.name)
        console.log("desktop-undo: skip unknown event", parsed.name)
      return
    }
    root.hyprlandEventsLive = true
    if (parsed.name === "activewindowv2" && parsed.fields && parsed.fields.address)
      root.lastActiveAddress = parsed.fields.address

    if (Executor.shouldSuppressRecord(root.tx, parsed, Parser.eventMatchesExpected)) {
      root.kickExecutor()
      return
    }

    if (!Parser.isActionEvent(parsed))
      return

    var trigger = {
      name: parsed.name,
      address: parsed.fields.address || "",
      className: parsed.fields["class"] || "",
      state: parsed.fields.state,
      floating: parsed.fields.floating
    }
    if (parsed.name === "fullscreen" && !trigger.address)
      trigger.address = root.lastActiveAddress

    Qt.callLater(function() {
      root.requestClients("event", trigger)
    })
  }

  function kickExecutor() {
    if (Executor.tick(root.tx, Date.now())) {
      // timed out; continue the queue
    }
    var pending = Executor.beginNext(root.tx, Date.now())
    if (!pending)
      return
    root.executeStep(pending)
  }

  function executeStep(pending) {
    var step = pending.step
    if (!step)
      return
    if (step.kind === "relaunch")
      root.executeRelaunch(pending)
    else
      dispatchHypr(Ops.dispatchString(step))
    confirmTimer.restart()
    clientsConfirmTimer.restart()
  }

  function executeRelaunch(pending) {
    var entry = pending.meta && pending.meta.entry
    if (!entry) {
      Executor.completePending(root.tx, "timeout")
      root.kickExecutor()
      return
    }
    var cookie = uuid()
    var relaunch = entry.relaunch || {}
    var cwd = relaunch.cwd || root.home
    var argv = relaunch.argv && relaunch.argv.length ? relaunch.argv : [entry.appId || "true"]
    var ws = entry.before ? Number(entry.before.workspace || 1) : 1
    var cmd = "[workspace " + ws + " silent] env DESKTOP_UNDO_COOKIE=" + cookie + " sh -c " + quote("cd \"$1\" && shift && exec \"$@\"") + " sh " + quote(cwd)
    for (var i = 0; i < argv.length; i++)
      cmd += " " + quote(argv[i])
    root.pendingRelaunch = {
      cookie: cookie,
      appId: entry.appId,
      oldAddress: entry.address,
      entryId: entry.id,
      entry: entry,
      deadline: Date.now() + 5000,
      pids: []
    }
    dispatchHypr("exec " + cmd)
    cookieTimer.restart()
  }

  function finishRelaunch(newAddress, pid) {
    var pending = root.pendingRelaunch
    if (!pending)
      return
    var live = String(newAddress || "")
    if (!live && pid)
      live = Diff.addressForPid(root.lastClients, pid)
    if (live && pending.oldAddress && live !== pending.oldAddress) {
      Journal.replaceAddress(pending.oldAddress, live)
      Executor.retarget(root.tx, pending.oldAddress, live, Ops.rewriteAddress)
    }
    var entry = pending.entry
    root.pendingRelaunch = null
    cookieTimer.stop()
    if (root.tx.pending && root.tx.pending.step && root.tx.pending.step.kind === "relaunch")
      Executor.completePending(root.tx, "event")
    if (entry && live && !entry.multiWindow)
      Executor.enqueue(root.tx, Ops.closeRestoreSteps(entry, live), { entry: entry, direction: "undo" })
    root.kickExecutor()
  }

  function maybeMatchCookie(action) {
    var pending = root.pendingRelaunch
    if (!pending)
      return
    if (action.appId && pending.appId && String(action.appId).toLowerCase() !== String(pending.appId).toLowerCase())
      return
    var pid = action.after ? Number(action.after.pid) || 0 : 0
    var args = [root.probeCommand(), "cookie", pending.cookie]
    if (pid > 0)
      args.push(String(pid))
    enqueueWork(args, function(text) {
      var info = null
      try {
        info = JSON.parse(String(text || "").trim() || "{}")
      } catch (e) {
        info = null
      }
      if (!info || !info.found)
        return
      root.finishRelaunch(action.address, info.pid || pid)
    })
  }

  function runUndo() {
    if (Executor.isBusy(root.tx))
      return "busy"
    var entry = Journal.peekUndo()
    if (!entry)
      return "empty"
    Journal.undo()
    root.publish()
    persistTimer.restart()
    var steps = Ops.inverseSteps(entry)
    Executor.enqueue(root.tx, steps, { entry: entry, direction: "undo" })
    root.kickExecutor()
    root.lastStatus = "undo"
    return "ok"
  }

  function runRedo() {
    if (Executor.isBusy(root.tx))
      return "busy"
    var entry = Journal.peekRedo()
    if (!entry)
      return "empty"
    Journal.redo()
    root.publish()
    persistTimer.restart()
    var steps = Ops.redoSteps(entry)
    Executor.enqueue(root.tx, steps, { entry: entry, direction: "redo" })
    root.kickExecutor()
    root.lastStatus = "redo"
    return "ok"
  }

  function runScrubTo(index) {
    var target = Number(index)
    if (isNaN(target))
      return "bad-index"
    var current = Journal.snapshot().cursor
    if (target === current)
      return "ok"
    if (!root.scrubbing) {
      root.scrubbing = true
      root.scrubAnchor = Journal.snapshot().entries.length
    }
    var direction = target < current ? -1 : 1
    while (Journal.snapshot().cursor !== target) {
      if (direction < 0) {
        var u = Journal.peekUndo()
        if (!u)
          break
        Journal.undo()
        Executor.enqueue(root.tx, Ops.inverseSteps(u), { entry: u, direction: "undo" })
      } else {
        var r = Journal.peekRedo()
        if (!r)
          break
        Journal.redo()
        Executor.enqueue(root.tx, Ops.redoSteps(r), { entry: r, direction: "redo" })
      }
    }
    root.publish()
    persistTimer.restart()
    root.kickExecutor()
    return "ok"
  }

  function commitScrub() {
    root.scrubbing = false
    Journal.commitPresent()
    root.publish()
    persistTimer.restart()
    return "ok"
  }

  function cancelScrub() {
    if (!root.scrubbing)
      return runScrubTo(Journal.snapshot().entries.length)
    var present = Journal.snapshot().entries.length
    runScrubTo(present)
    root.scrubbing = false
    return "ok"
  }

  function persistNow() {
    if (root.hydrating)
      return
    journalFile.setText(Journal.serialize() + "\n")
    enqueueWork([root.probeCommand(), "secure", root.journalPath], null)
  }

  function statusJson() {
    var snap = Journal.snapshot()
    return JSON.stringify({
      id: root.pluginId,
      depth: snap.depth,
      redoDepth: snap.redoDepth,
      cursor: snap.cursor,
      busy: Executor.isBusy(root.tx),
      probe: root.probeCmd,
      probeIsBinary: root.probeIsBinary,
      hyprVersion: root.hyprVersion,
      socket: eventSock.connected || root.hyprlandEventsLive,
      status: root.lastStatus
    })
  }

  function undo(arg) { return root.runUndo() }
  function redo(arg) { return root.runRedo() }
  function scrubTo(arg) { return root.runScrubTo(Number(arg)) }
  function commit(arg) { return root.commitScrub() }
  function cancel(arg) { return root.cancelScrub() }
  function openTimeline(arg) { return root.summonOverlay("{}") }
  function ping(arg) { return "ok" }
  function status(arg) { return root.statusJson() }
  function journalJson(arg) { return Journal.serialize() }
  function markFirstRun(arg) {
    Journal.markFirstRunShown()
    persistTimer.restart()
    return "ok"
  }

  Process {
    id: workProc
    running: false
    stdout: StdioCollector {
      id: workOut
      waitForEnd: true
    }
    onExited: {
      var text = workOut.text
      var job = root.workCurrent
      root.workCurrent = null
      if (job && job.done) {
        try {
          job.done(text, exitCode)
        } catch (e) {
          console.warn("desktop-undo: work callback failed", e)
        }
      }
      root.runWork()
    }
  }

  Process {
    id: versionProc
    command: ["hyprctl", "-j", "version"]
    running: false
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        try {
          var v = JSON.parse(text)
          root.hyprVersion = String((v && (v.tag || v.version || v.commit)) || text).trim()
        } catch (e) {
          root.hyprVersion = String(text || "").trim()
        }
      }
    }
  }

  Process {
    id: probeWhichProc
    command: ["sh", "-c", "test -x \"$1\" && echo binary || echo missing", "sh", root.probeBin]
    running: false
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var out = String(text || "").trim()
        if (out === "binary") {
          root.probeIsBinary = true
          root.probeCmd = root.probeBin
        } else {
          root.probeIsBinary = false
          root.probeCmd = root.probeSh
        }
        root.probeReady = true
        enqueueWork([root.probeCommand(), "init-state", root.stateHome], function() {
          journalFile.reload()
        })
      }
    }
  }

  Socket {
    id: eventSock
    path: {
      try {
        if (Hyprland.eventSocketPath)
          return Hyprland.eventSocketPath
      } catch (e) {}
      var runtime = Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"
      var sig = Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE") || ""
      if (!sig)
        return ""
      return runtime + "/hypr/" + sig + "/.socket2.sock"
    }
    // Stay disconnected while Hyprland.rawEvent is alive so we do not
    // double-record. Fallback timer below opens this if rawEvent never fires.
    connected: false
    parser: SplitParser {
      onRead: function(data) {
        if (root.hyprlandEventsLive)
          return
        root.handleLine(data)
      }
    }
    onConnectedChanged: {
      if (connected) {
        root.socketBackoffMs = 250
        root.lastStatus = "socket-connected"
        reconnectTimer.stop()
      } else if (root.socketWanted && !root.hyprlandEventsLive) {
        reconnectTimer.interval = root.socketBackoffMs
        reconnectTimer.start()
      }
    }
    onError: {
      if (!root.hyprlandEventsLive) {
        reconnectTimer.interval = root.socketBackoffMs
        reconnectTimer.start()
      }
    }
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (!event)
        return
      root.hyprlandEventsLive = true
      if (eventSock.connected)
        eventSock.connected = false
      var line = String(event.name || "") + ">>" + String(event.data || "")
      root.handleLine(line)
    }
  }

  Timer {
    id: socketFallbackTimer
    interval: 2000
    repeat: false
    running: true
    onTriggered: {
      if (root.hyprlandEventsLive)
        return
      if (eventSock.path && eventSock.path.length > 0)
        eventSock.connected = root.socketWanted
    }
  }

  Timer {
    id: reconnectTimer
    interval: 250
    repeat: false
    onTriggered: {
      root.socketBackoffMs = Math.min(root.socketBackoffMs * 2, 5000)
      eventSock.connected = false
      Qt.callLater(function() {
        if (!root.hyprlandEventsLive)
          eventSock.connected = root.socketWanted
      })
    }
  }

  Timer {
    id: pollTimer
    interval: root.idlePollMs
    repeat: true
    running: true
    onTriggered: {
      if (root.dragging)
        interval = root.pollMs
      else
        interval = root.idlePollMs
      root.requestClients("poll", { name: "geometry" })
    }
  }

  Timer {
    id: debounceTimer
    interval: root.debounceMs
    repeat: false
    onTriggered: {
      var dirty = root.dragDirty
      root.dragDirty = ({})
      root.dragging = false
      var keys = []
      for (var k in dirty) {
        if (dirty.hasOwnProperty(k))
          keys.push(k)
      }
      for (var i = 0; i < keys.length; i++)
        root.recordAction(dirty[keys[i]])
      root.lastStableClients = root.lastClients
    }
  }

  Timer {
    id: confirmTimer
    interval: 80
    repeat: false
    onTriggered: {
      var timed = Executor.tick(root.tx, Date.now())
      if (timed)
        root.kickExecutor()
      else if (root.tx.pending)
        confirmTimer.restart()
    }
  }

  Timer {
    id: clientsConfirmTimer
    interval: 60
    repeat: false
    onTriggered: {
      if (root.tx.pending)
        root.requestClients("event", { name: "confirm" })
    }
  }

  Timer {
    id: persistTimer
    interval: 200
    repeat: false
    onTriggered: root.persistNow()
  }

  Timer {
    id: cookieTimer
    interval: 200
    repeat: true
    running: false
    onTriggered: {
      var pending = root.pendingRelaunch
      if (!pending) {
        stop()
        return
      }
      if (Date.now() > pending.deadline) {
        root.pendingRelaunch = null
        if (root.tx.pending && root.tx.pending.step && root.tx.pending.step.kind === "relaunch")
          Executor.completePending(root.tx, "timeout")
        root.kickExecutor()
        stop()
        return
      }
      enqueueWork([root.probeCommand(), "cookie", pending.cookie], function(text) {
        var info = null
        try {
          info = JSON.parse(String(text || "").trim() || "{}")
        } catch (e) {
          return
        }
        if (!info || !info.found)
          return
        var live = Diff.addressForPid(root.lastClients, info.pid)
        if (live) {
          root.finishRelaunch(live, info.pid)
          return
        }
        enqueueWork(["hyprctl", "-j", "clients"], function(raw) {
          var clients = Diff.parseClients(raw)
          if (clients && clients.length)
            root.lastClients = clients
          root.finishRelaunch(Diff.addressForPid(root.lastClients, info.pid), info.pid)
        })
      })
    }
  }

  FileView {
    id: journalFile
    path: root.journalPath
    atomicWrites: true
    printErrors: false
    watchChanges: false
    onLoaded: {
      Journal.load(text())
      root.journalLoaded = true
      root.publish()
    }
    onLoadFailed: {
      root.journalLoaded = true
      root.publish()
    }
    onSaved: enqueueWork([root.probeCommand(), "secure", root.journalPath], null)
  }

  Timer {
    id: bootTimeout
    interval: 1500
    repeat: false
    onTriggered: root.finishBoot()
  }

  IpcHandler {
    target: "io.github.chris.desktop-undo"

    function undo(arg: string): string { return root.runUndo() }
    function redo(arg: string): string { return root.runRedo() }
    function scrubTo(arg: string): string { return root.runScrubTo(Number(arg)) }
    function commit(arg: string): string { return root.commitScrub() }
    function cancel(arg: string): string { return root.cancelScrub() }
    function openTimeline(arg: string): string { return root.summonOverlay("{}") }
    function summon(arg: string): string { return root.summonOverlay("{}") }
    function ping(arg: string): string { return "ok" }
    function status(arg: string): string { return root.statusJson() }
    function journal(arg: string): string { return Journal.serialize() }
    function markFirstRun(arg: string): string { return root.markFirstRun(arg) }
  }

  Component.onCompleted: {
    root.applyHostSettings()
    probeWhichProc.running = true
    versionProc.running = true
    Qt.callLater(function() { root.requestClients("boot", {}) })
    root.publish()
  }
}
