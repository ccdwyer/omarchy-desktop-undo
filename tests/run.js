#!/usr/bin/env node
"use strict"

const fs = require("fs")
const path = require("path")
const vm = require("vm")
const assert = require("assert")

const ROOT = path.resolve(__dirname, "..")
const JS = path.join(ROOT, "js")
const FIX = path.join(__dirname, "fixtures")

function loadEngine(file) {
  const src = fs
    .readFileSync(path.join(JS, file), "utf8")
    .replace(/^\.pragma library\s*\n/, "")
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    String,
    Number,
    Array,
    Object,
    parseInt,
    isNaN,
    exports: {},
    module: { exports: {} }
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: file })
  const exported = {}
  for (const key of Object.keys(sandbox)) {
    if (["console", "Date", "Math", "JSON", "String", "Number", "Array", "Object", "parseInt", "isNaN", "exports", "module"].indexOf(key) >= 0)
      continue
    exported[key] = sandbox[key]
  }
  return exported
}

const Apps = loadEngine("Apps.js")
const Parser = loadEngine("Parser.js")
const Diff = loadEngine("Diff.js")
const Ops = loadEngine("Ops.js")
const Journal = loadEngine("Journal.js")
const Executor = loadEngine("Executor.js")
const Config = loadEngine("Config.js")
const Scrub = loadEngine("Scrub.js")
const Relaunch = loadEngine("Relaunch.js")
const Binds = loadEngine("Binds.js")

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    Journal.reset()
    Scrub.reset()
    fn()
    passed += 1
    process.stdout.write("ok  " + name + "\n")
  } catch (err) {
    failed += 1
    process.stderr.write("FAIL " + name + "\n" + (err && err.stack ? err.stack : err) + "\n")
  }
}

function fixture(name) {
  return fs.readFileSync(path.join(FIX, name), "utf8")
}

function jsonFix(name) {
  return JSON.parse(fixture(name))
}

test("parser: openwindow splits class and comma-rich title", () => {
  const events = Parser.parseStream(fixture("socket2-openwindow.txt"))
  const open = events.filter((e) => e.name === "openwindow")[0]
  assert.strictEqual(open.fields.address, "0x64cea2525760")
  assert.strictEqual(open.fields.class, "kitty")
  assert.ok(open.fields.title.indexOf("projects/demo") >= 0)
  assert.strictEqual(open.action, true)
})

test("parser: closewindow address", () => {
  const ev = Parser.parseLine(fixture("socket2-closewindow.txt").trim())
  assert.strictEqual(ev.name, "closewindow")
  assert.strictEqual(ev.fields.address, "0x64cea2525760")
})

test("parser: movewindowv2 workspace id", () => {
  const events = Parser.parseStream(fixture("socket2-movewindowv2.txt"))
  const v2 = events.filter((e) => e.name === "movewindowv2")[0]
  assert.strictEqual(v2.fields.workspaceId, 4)
  assert.strictEqual(v2.fields.address, "0x64cea2525760")
})

test("parser: changefloatingmode 0/1", () => {
  const events = Parser.parseStream(fixture("socket2-changefloatingmode.txt"))
  assert.strictEqual(events[0].fields.floating, 1)
  assert.strictEqual(events[1].fields.floating, 0)
})

test("parser: fullscreen payload is 0/1 with no address", () => {
  const events = Parser.parseStream(fixture("socket2-fullscreen.txt"))
  const fs = events.filter((e) => e.name === "fullscreen")
  assert.strictEqual(fs[0].fields.state, 1)
  assert.strictEqual(fs[1].fields.state, 0)
  assert.ok(!fs[0].fields.address)
})

test("parser: unknown events log-and-skip, titles may contain commas", () => {
  const events = Parser.parseStream(fixture("socket2-unknown.txt"))
  const unknown = events.filter((e) => e.kind === "unknown")
  assert.ok(unknown.length >= 1)
  unknown.forEach((e) => assert.strictEqual(e.action, false))
  const open = events.filter((e) => e.name === "openwindow")[0]
  assert.strictEqual(open.fields.class, "firefox")
  assert.ok(open.fields.title.indexOf("commas") >= 0)
})

test("parser: eventMatchesExpected consumes matching inverse", () => {
  const ev = Parser.parseLine("movewindowv2>>64cea2525760,1,1")
  assert.ok(Parser.eventMatchesExpected(ev, { name: "movewindowv2", address: "0x64cea2525760" }))
  assert.ok(!Parser.eventMatchesExpected(ev, { name: "closewindow", address: "0x64cea2525760" }))
})

test("diff: close is missing-from-after", () => {
  const before = jsonFix("clients-tiled.json")
  const after = jsonFix("clients-empty.json")
  const actions = Diff.diff(before, after, { name: "closewindow", address: "0x64cea2525760" })
  assert.strictEqual(actions[0].type, "close")
  assert.strictEqual(actions[0].appId, "kitty")
})

test("diff: floating move is pixel geometry", () => {
  const before = jsonFix("clients-floating.json")
  const after = jsonFix("clients-floating-moved.json")
  const actions = Diff.diff(before, after, { name: "geometry" })
  const move = actions.filter((a) => a.type === "move")[0]
  assert.ok(move)
  assert.strictEqual(move.before.x, 80)
  assert.strictEqual(move.after.x, 400)
  assert.strictEqual(move.floating, true)
})

test("diff: workspace send", () => {
  const before = jsonFix("clients-tiled.json")
  const after = jsonFix("clients-workspace-4.json")
  const actions = Diff.diff(before, after, { name: "movewindowv2", address: "0x64cea2525760" })
  assert.strictEqual(actions[0].type, "workspace")
  assert.strictEqual(actions[0].after.workspace, 4)
})

test("diff: fullscreen via clients fields, not event address", () => {
  const before = jsonFix("clients-tiled.json")
  const after = jsonFix("clients-fullscreen.json")
  const actions = Diff.diff(before, after, { name: "fullscreen" })
  const fs = actions.filter((a) => a.type === "fullscreen")[0]
  assert.ok(fs)
  assert.strictEqual(fs.after.fullscreen, 2)
  assert.strictEqual(fs.address, "0x64cea2525760")
})

test("shouldRecord: tiled geometry is not a journal entry", () => {
  const before = jsonFix("clients-tiled.json")
  const moved = JSON.parse(JSON.stringify(before))
  moved[0].at = [400, 400]
  const actions = Diff.diff(before, moved, { name: "geometry" })
  const move = actions.filter((a) => a.type === "move")[0]
  assert.ok(move)
  assert.strictEqual(Ops.shouldRecord(move, Apps, []), false)
})

test("shouldRecord: exclusions skip 1password", () => {
  const action = { type: "workspace", appId: "1Password", address: "0x1" }
  assert.strictEqual(Ops.shouldRecord(action, Apps, []), false)
})

test("apps: terminals vs multi-window labels", () => {
  assert.ok(Apps.isTerminal("kitty"))
  assert.ok(Apps.isMultiWindow("firefox"))
  assert.strictEqual(Apps.labelForType("close", "best-effort", true), "reopen")
  assert.strictEqual(Apps.glyphForType("workspace"), "⬒")
  assert.strictEqual(Apps.glyphForType("close"), "↺")
})

test("ops: every type has a non-empty inverse except tiled skip", () => {
  const types = Ops.allInverseTypes()
  const floatingBefore = { address: "0x1", x: 10, y: 20, w: 100, h: 80, floating: true, workspace: 1, fullscreen: 0, fullscreenClient: 0 }
  const floatingAfter = { address: "0x1", x: 40, y: 50, w: 120, h: 90, floating: true, workspace: 2, fullscreen: 2, fullscreenClient: 2 }
  types.forEach((type) => {
    const steps = Ops.inverseSteps({
      type,
      address: "0x1",
      appId: "kitty",
      before: floatingBefore,
      after: floatingAfter,
      multiWindow: false
    })
    assert.ok(steps.length > 0, type + " missing inverse")
    if (type !== "close") {
      steps.forEach((s) => {
        if (s.kind !== "skip")
          assert.ok(s.dispatcher, type + " missing dispatcher")
      })
    }
  })
})

test("ops: fullscreen uses fullscreenstate, never toggle", () => {
  const steps = Ops.inverseSteps({
    type: "fullscreen",
    address: "0x1",
    before: { fullscreen: 0, fullscreenClient: 0, workspace: 1 },
    after: { fullscreen: 2, fullscreenClient: 2 }
  })
  assert.strictEqual(steps[0].dispatcher, "fullscreenstate")
  assert.ok(steps[0].arg.indexOf("0 0") === 0)
  assert.ok(steps[0].arg.indexOf("address:0x1") >= 0)
})

test("ops: close of firefox is reopen, no geometry", () => {
  const steps = Ops.inverseSteps({
    type: "close",
    address: "0xabc00001",
    appId: "firefox",
    multiWindow: true,
    before: { workspace: 2, x: 1, y: 2, w: 3, h: 4, floating: false }
  })
  assert.strictEqual(steps.length, 1)
  assert.strictEqual(steps[0].kind, "relaunch")
  const restore = Ops.closeRestoreSteps({
    type: "close",
    address: "0xabc00001",
    appId: "firefox",
    multiWindow: true,
    before: { workspace: 2, x: 1, y: 2, w: 3, h: 4, floating: false }
  }, "0xdeadbeef")
  assert.strictEqual(restore.length, 0)
})

test("ops: close restore waits for live address, never the dead one", () => {
  const entry = {
    type: "close",
    address: "0xold",
    appId: "kitty",
    multiWindow: false,
    before: { workspace: 3, x: 10, y: 20, w: 200, h: 100, floating: true }
  }
  const queued = Ops.inverseSteps(entry)
  assert.strictEqual(queued.length, 1)
  assert.strictEqual(queued[0].kind, "relaunch")
  queued.forEach((s) => {
    assert.ok(!s.arg || String(s.arg).indexOf("0xold") < 0)
  })
  const restore = Ops.closeRestoreSteps(entry, "0xnew")
  assert.ok(restore.length >= 1)
  restore.forEach((s) => {
    assert.ok(String(s.arg).indexOf("0xnew") >= 0, s.arg)
    assert.ok(String(s.arg).indexOf("0xold") < 0, s.arg)
  })
})

test("ops: workspace inverse is movetoworkspacesilent", () => {
  const steps = Ops.inverseSteps({
    type: "workspace",
    address: "0x64cea2525760",
    before: { workspace: 1 },
    after: { workspace: 4 }
  })
  assert.strictEqual(steps[0].dispatcher, "movetoworkspacesilent")
  assert.ok(steps[0].arg.indexOf("1,address:0x64cea2525760") === 0)
})

test("journal: undo/redo cursor and redo truncation", () => {
  Journal.push({ type: "move", address: "0x1", appId: "kitty" })
  Journal.push({ type: "workspace", address: "0x1", appId: "kitty" })
  Journal.push({ type: "float", address: "0x1", appId: "kitty" })
  assert.strictEqual(Journal.depth(), 3)
  Journal.undo()
  Journal.undo()
  assert.strictEqual(Journal.depth(), 1)
  assert.strictEqual(Journal.redoDepth(), 2)
  Journal.push({ type: "move", address: "0x1", appId: "kitty" })
  assert.strictEqual(Journal.depth(), 2)
  assert.strictEqual(Journal.redoDepth(), 0)
  assert.strictEqual(Journal.peekUndo().type, "move")
})

test("journal: ring drops oldest and strips relaunch", () => {
  for (var i = 0; i < 55; i++) {
    Journal.push({
      type: "move",
      address: "0x" + i.toString(16),
      appId: "kitty",
      relaunch: { cwd: "/tmp/" + i, argv: ["kitty"] }
    })
  }
  const snap = Journal.snapshot()
  assert.strictEqual(snap.entries.length, 50)
  assert.strictEqual(Journal.fuzzInvariant(), "ok")
})

test("journal: serialize never includes environ", () => {
  Journal.push({
    type: "close",
    address: "0x1",
    relaunch: { cwd: "/tmp", argv: ["kitty"], environ: { SECRET: "nope" } }
  })
  const raw = Journal.serialize()
  assert.ok(raw.indexOf("SECRET") < 0)
  assert.ok(raw.indexOf("environ") < 0)
})

test("journal: load round-trip", () => {
  Journal.push({ type: "move", address: "0xabc", appId: "kitty" })
  const dumped = Journal.serialize()
  Journal.reset()
  assert.ok(Journal.load(dumped))
  assert.strictEqual(Journal.peekUndo().address, "0xabc")
})

test("executor: matching event consumes pending and suppresses record", () => {
  const st = Executor.create()
  Executor.enqueue(st, [{ dispatcher: "movetoworkspacesilent", arg: "1,address:0x1", expect: { name: "movewindowv2", address: "0x1" } }], {})
  const pending = Executor.beginNext(st, 1000)
  assert.ok(pending)
  const parsed = Parser.parseLine("movewindowv2>>0x1,1,1")
  assert.ok(Executor.shouldSuppressRecord(st, parsed, Parser.eventMatchesExpected))
  assert.strictEqual(Executor.isBusy(st), false)
})

test("executor: timeout is a failure and drops the rest of the queue", () => {
  const st = Executor.create()
  Executor.enqueue(st, [{ dispatcher: "setfloating", arg: "address:0x1", expect: { name: "changefloatingmode" } }], { batchId: "a" })
  Executor.enqueue(st, [{ dispatcher: "settiled", arg: "address:0x1", expect: { name: "changefloatingmode" } }], { batchId: "b" })
  Executor.beginNext(st, 0)
  const timed = Executor.tick(st, 501)
  assert.ok(timed)
  assert.strictEqual(timed.reason, "timeout")
  assert.strictEqual(timed.confirmed, false)
  assert.strictEqual(st.queue.length, 0)
  assert.strictEqual(Executor.isBusy(st), false)
})

test("executor: skip-only inverse still queues a noop batch", () => {
  const st = Executor.create()
  assert.ok(Executor.enqueue(st, [{ kind: "skip", dispatcher: null }], { direction: "undo", batchId: "skippy" }))
  assert.strictEqual(st.queue[0].step.kind, "noop")
})

test("executor: fail aborts remaining steps", () => {
  const st = Executor.create()
  Executor.enqueue(st, [
    { dispatcher: "movetoworkspacesilent", arg: "1,address:0x1", expect: { name: "movewindowv2" } },
    { dispatcher: "setfloating", arg: "address:0x1", expect: { name: "changefloatingmode" } }
  ], { batchId: "one" })
  Executor.beginNext(st, 0)
  const finished = Executor.fail(st, "hyprctl:1")
  assert.strictEqual(finished.confirmed, false)
  assert.strictEqual(st.queue.length, 0)
  assert.strictEqual(Executor.batchRemaining(st, "one"), 0)
})

test("executor: clients-j confirmation", () => {
  const st = Executor.create()
  Executor.enqueue(st, [{
    dispatcher: "movewindowpixel",
    arg: "exact 80 80,address:0x64cea2525760",
    expectClients: { address: "0x64cea2525760", x: 80, y: 80 }
  }], {})
  Executor.beginNext(st, 0)
  assert.ok(Executor.onClients(st, jsonFix("clients-floating.json"), Ops.clientsMatch))
})

test("fuzz: 500 random actions leave journal uncorrupted", () => {
  const types = Ops.allInverseTypes()
  const log = []
  for (var i = 0; i < 500; i++) {
    const roll = i % 7
    if (roll === 5 && Journal.depth() > 0) {
      Journal.undo()
      log.push("undo")
    } else if (roll === 6 && Journal.redoDepth() > 0) {
      Journal.redo()
      log.push("redo")
    } else {
      Journal.push({
        type: types[i % types.length],
        address: "0x" + ((i % 13) + 1).toString(16),
        appId: i % 11 === 0 ? "firefox" : "kitty",
        before: { workspace: (i % 9) + 1, x: i, y: i, w: 100, h: 100, floating: i % 2 === 0, fullscreen: 0, fullscreenClient: 0 },
        after: { workspace: ((i + 1) % 9) + 1, x: i + 4, y: i + 4, w: 120, h: 120, floating: i % 2 === 1, fullscreen: 0, fullscreenClient: 0 }
      })
      log.push("push")
    }
    const inv = Journal.fuzzInvariant(log)
    assert.strictEqual(inv, "ok", "corruption at i=" + i + " " + inv)
  }
  assert.ok(Journal.snapshot().entries.length <= 50)
})

test("ops table 100% type coverage for dispatch strings", () => {
  const types = Ops.allInverseTypes()
  types.forEach((type) => {
    const entry = {
      type,
      address: "0x64cea2525760",
      appId: "kitty",
      before: { address: "0x64cea2525760", x: 10, y: 20, w: 200, h: 100, floating: true, workspace: 3, fullscreen: 0, fullscreenClient: 0 },
      after: { address: "0x64cea2525760", x: 30, y: 40, w: 220, h: 120, floating: false, workspace: 4, fullscreen: 2, fullscreenClient: 2 },
      multiWindow: false
    }
    const inv = Ops.inverseSteps(entry)
    const red = Ops.redoSteps(entry)
    assert.ok(inv.length, type + " inverse empty")
    assert.ok(red.length, type + " redo empty")
    inv.concat(red).forEach((step) => {
      if (step.kind === "skip" || step.kind === "relaunch")
        return
      const s = Ops.dispatchString(step)
      if (step.dispatcher)
        assert.ok(s.indexOf(step.dispatcher) === 0, s)
      const lua = Ops.luaDispatch(step)
      assert.ok(lua.indexOf("hl.dsp.") === 0, type + " lua: " + lua)
    })
  })
})

test("ops lua dispatch maps pixel move and exec for hypr 0.56", () => {
  const move = Ops.inverseSteps({
    type: "move",
    address: "0x64cea2525760",
    before: { x: 10, y: 20, w: 200, h: 100, floating: true },
    after: { x: 30, y: 40, w: 200, h: 100, floating: true }
  })[0]
  const s = Ops.luaDispatch(move)
  assert.ok(s.indexOf("hl.dsp.window.move({ x = 10, y = 20, relative = false") === 0, s)
  assert.ok(s.indexOf('window = "address:0x64cea2525760"') >= 0, s)
  assert.strictEqual(
    Ops.luaExecCmd("env FOO=1 true", 4),
    'hl.dsp.exec_cmd("env FOO=1 true", { workspace = "4" })'
  )
})

test("binds: empty live list offers preferred combos", () => {
  const p = Binds.plan([])
  assert.strictEqual(p.needed, true)
  assert.strictEqual(p.toAdd.length, 3)
  assert.strictEqual(p.toAdd[0].keys, "SUPER + Z")
  assert.ok(Binds.luaBlock(p.toAdd).indexOf("o.bind(\"SUPER + Z\"") === 0)
})

test("binds: skips occupied combos and uses an alternate", () => {
  const live = [
    { modmask: 64, key: "Z", dispatcher: "exec", arg: "other", description: "Full screen" }
  ]
  const p = Binds.plan(live)
  assert.strictEqual(p.needed, true)
  const undo = p.toAdd.filter((x) => x.desc === "Desktop undo")[0]
  assert.ok(undo)
  assert.strictEqual(undo.chosen, "SUPER + ALT + Z")
  assert.ok(p.note.indexOf("SUPER + ALT + Z") >= 0)
})

test("binds: already-ours hides the offer", () => {
  const live = [
    { modmask: 64, key: "Z", dispatcher: "__lua", arg: "15", description: "Desktop undo" }
  ]
  const p = Binds.plan(live)
  assert.strictEqual(p.needed, false)
  assert.strictEqual(p.already, 1)
})

test("settings: extra exclusions come from host inline settings", () => {
  var excl = Config.extraExclusionsFrom({ extraExclusions: "secret-app, other" })
  assert.ok(excl.indexOf("secret-app") >= 0)
  assert.ok(excl.indexOf("other") >= 0)
  assert.strictEqual(Config.hideChipAtZeroFrom({ hideChipAtZero: false }), false)
  assert.strictEqual(Config.hideChipAtZeroFrom({}), true)
  assert.ok(Apps.isExcluded("secret-app", excl))
})

test("diff: drag coalesce keeps the first before", () => {
  const start = jsonFix("clients-floating.json")
  const mid = JSON.parse(JSON.stringify(start))
  mid[0].at = [200, 90]
  const end = jsonFix("clients-floating-moved.json")
  const first = Diff.diff(start, mid, { name: "geometry" }).filter((a) => a.type === "move")[0]
  const second = Diff.diff(mid, end, { name: "geometry" }).filter((a) => a.type === "move")[0]
  const coalesced = Diff.coalesceDrag(Diff.coalesceDrag(null, first), second)
  assert.strictEqual(coalesced.before.x, 80)
  assert.strictEqual(coalesced.before.y, 80)
  assert.strictEqual(coalesced.after.x, 400)
  assert.strictEqual(coalesced.after.y, 120)
})

test("executor: retarget rewrites queued restoration addresses", () => {
  const st = Executor.create()
  Executor.enqueue(st, [{
    dispatcher: "movewindowpixel",
    arg: "exact 10 20,address:0xold",
    expectClients: { address: "0xold", x: 10, y: 20 }
  }], {})
  Executor.retarget(st, "0xold", "0xnew", Ops.rewriteAddress)
  assert.strictEqual(st.queue[0].step.arg, "exact 10 20,address:0xnew")
  assert.strictEqual(st.queue[0].step.expectClients.address, "0xnew")
})

test("scrub: one desired target, next step is a single undo or redo", () => {
  Journal.push({ type: "move", address: "0x1" })
  Journal.push({ type: "move", address: "0x2" })
  Journal.push({ type: "move", address: "0x3" })
  assert.strictEqual(Journal.snapshot().cursor, 3)
  Scrub.setDesired(1, 3, 3)
  assert.strictEqual(Scrub.nextDirection(3), "undo")
  assert.strictEqual(Scrub.snapshot().presentCursor, 3)
  Scrub.setDesired(0, 3, 3)
  assert.strictEqual(Scrub.nextDirection(3), "undo")
  assert.strictEqual(Scrub.snapshot().desiredTarget, 0)
  Journal.undo()
  assert.strictEqual(Scrub.nextDirection(2), "undo")
  Journal.undo()
  Journal.undo()
  assert.strictEqual(Scrub.nextDirection(0), "at-target")
})

test("scrub: pending dismiss ignores later setDesired", () => {
  Journal.push({ type: "move", address: "0x1" })
  Journal.push({ type: "move", address: "0x2" })
  Scrub.setDesired(0, 2, 2)
  assert.strictEqual(Scrub.snapshot().desiredTarget, 0)
  Scrub.requestCommit()
  Scrub.setDesired(2, 2, 2)
  assert.strictEqual(Scrub.snapshot().desiredTarget, 0)
  assert.strictEqual(Scrub.dismissKind(), "commit")
})

test("scrub: cancel retargets the saved present; commit is deferred", () => {
  Journal.push({ type: "float", address: "0x1" })
  Journal.push({ type: "float", address: "0x2" })
  Scrub.setDesired(0, 2, 2)
  Scrub.requestCommit()
  assert.strictEqual(Scrub.dismissKind(), "commit")
  assert.strictEqual(Scrub.nextDirection(2), "undo")
  Scrub.requestCancel()
  assert.strictEqual(Scrub.snapshot().desiredTarget, 2)
  assert.strictEqual(Scrub.dismissKind(), "cancel")
  assert.strictEqual(Scrub.nextDirection(2), "at-target")
})

test("relaunch: missing metadata is unavailable, class is not an executable", () => {
  assert.strictEqual(Relaunch.argvFor({ type: "close", appId: "kitty" }), null)
  assert.strictEqual(Relaunch.unavailableReason({ type: "close", appId: "kitty" }), "relaunch unavailable")
  assert.deepStrictEqual(
    Relaunch.argvFor({ relaunch: { argv: ["/usr/bin/kitty", "--class", "demo"] } }),
    ["/usr/bin/kitty", "--class", "demo"]
  )
})

test("journal: firstRunShown persists in journal state, not a config file", () => {
  assert.strictEqual(Journal.snapshot().firstRunShown, false)
  Journal.markFirstRunShown()
  const dumped = Journal.serialize()
  assert.ok(dumped.indexOf("firstRunShown") >= 0)
  Journal.reset()
  assert.ok(Journal.load(dumped))
  assert.strictEqual(Journal.snapshot().firstRunShown, true)
})

const summary = passed + " passed, " + failed + " failed"
process.stdout.write(summary + "\n")
if (failed)
  process.exit(1)
