import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "js/Journal.js" as Journal
import "js/Apps.js" as Apps
import "js/Scrub.js" as Scrub

Item {
  id: root

  property var shell: null
  property var manifest: null
  property var pluginRegistry: null
  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || ""
  property bool opened: false
  property int selectedIndex: 0
  property int liveCursor: 0
  property int liveCount: 0
  property var cards: []
  property bool firstRun: false
  property bool previewHint: false
  property bool pendingDismiss: false
  property string pluginId: "io.github.chris.desktop-undo"

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  property color accent: Color.accent
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int cardWidth: Style.space(148)
  property int cardHeight: Style.space(168)

  readonly property bool reduceMotion: {
    try {
      if (Style && Style.reduceMotion)
        return true
    } catch (e) {}
    try {
      if (Quickshell.env("OMARCHY_REDUCED_MOTION") === "1")
        return true
    } catch (e2) {}
    return false
  }
  readonly property int motionMs: reduceMotion ? 0 : 150

  function open(payloadJson) {
    root.opened = true
    root.refresh()
    root.firstRun = !Journal.snapshot().firstRunShown
    try {
      var payload = payloadJson && String(payloadJson).length ? JSON.parse(payloadJson) : {}
      if (payload && payload.firstRun)
        root.firstRun = true
    } catch (e) {}
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    if (!root.opened)
      return
    var snap = Journal.snapshot()
    if (Scrub.active || snap.cursor !== snap.entries.length) {
      root.pendingDismiss = true
      root.callService("cancel", "")
      return
    }
    root.opened = false
    root.pendingDismiss = false
  }

  function toggle() {
    if (root.opened)
      root.close()
    else
      root.open("{}")
  }

  function serviceRef() {
    if (pluginRegistry && typeof pluginRegistry.serviceFor === "function") {
      var a = pluginRegistry.serviceFor(root.pluginId)
      if (a)
        return a
    }
    if (shell && typeof shell.serviceFor === "function") {
      var b = shell.serviceFor(root.pluginId)
      if (b)
        return b
    }
    if (shell && typeof shell.firstPartyServiceFor === "function") {
      var c = shell.firstPartyServiceFor(root.pluginId)
      if (c)
        return c
    }
    return null
  }

  // `omarchy-shell shell call <id> <method> <arg>` invokes methods on this
  // overlay (the panel loader), not the service. Keep the service methods
  // here so Super+Z and the bar chip reach the journal. Call QML methods by
  // name — `svc[method]` does not see them.
  function callService(method, arg) {
    var payload = arg === undefined || arg === null ? "" : String(arg)
    var svc = root.serviceRef()
    var fn = null
    if (svc) {
      if (method === "undo") fn = svc.undo
      else if (method === "redo") fn = svc.redo
      else if (method === "scrubTo") fn = svc.scrubTo
      else if (method === "commit") fn = svc.commit
      else if (method === "cancel") fn = svc.cancel
      else if (method === "markFirstRun") fn = svc.markFirstRun
      else if (method === "status") fn = svc.status
      else if (method === "journal") fn = svc.journal
      else if (method === "ping") fn = svc.ping
    }
    if (typeof fn === "function") {
      try {
        var result = fn(payload)
        return result === undefined || result === null ? "ok" : String(result)
      } catch (e) {
        console.warn("desktop-undo overlay service call failed", method, e)
        return "error"
      }
    }
    Quickshell.execDetached(["omarchy-shell", root.pluginId, method, payload])
    return "queued"
  }

  function undo(arg) { return root.callService("undo", arg) }
  function redo(arg) { return root.callService("redo", arg) }
  function scrubTo(arg) { return root.callService("scrubTo", arg) }
  function commit(arg) { return root.callService("commit", arg) }
  function cancel(arg) { return root.callService("cancel", arg) }
  function ping(arg) { return "ok" }
  function status(arg) { return root.callService("status", arg) }
  function journal(arg) { return root.callService("journal", arg) }

  function refresh() {
    var snap = Journal.snapshot()
    var scrub = Scrub.snapshot()
    root.liveCount = snap.entries.length
    root.liveCursor = (scrub.active && scrub.desiredTarget >= 0) ? scrub.desiredTarget : snap.cursor
    if (root.pendingDismiss && !scrub.active && snap.cursor === snap.entries.length) {
      root.opened = false
      root.pendingDismiss = false
    }
    var list = []
    for (var i = 0; i < snap.entries.length; i++) {
      var e = snap.entries[i]
      list.push({
        entryId: e.id || String(i),
        type: e.type,
        title: e.title || e.appId || "window",
        appId: e.appId || "",
        glyph: e.glyph || Apps.glyphForType(e.type),
        headline: Apps.titleForType(e.type),
        label: e.label || Apps.labelForType(e.type, e.fidelity, e.multiWindow),
        fidelity: e.fidelity || "exact",
        undone: i >= snap.cursor
      })
    }
    root.cards = list
    root.selectedIndex = Math.max(0, root.liveCursor - 1)
    if (list.length === 0)
      root.selectedIndex = 0
  }

  function dismissFirstRun() {
    Journal.markFirstRunShown()
    root.firstRun = false
    root.callService("markFirstRun", "")
  }

  function scrubBy(delta) {
    if (root.cards.length === 0)
      return
    var next = root.liveCursor + delta
    if (next < 0)
      next = 0
    if (next > root.liveCount)
      next = root.liveCount
    root.callService("scrubTo", String(next))
    Qt.callLater(root.refresh)
  }

  function commitAndClose() {
    root.pendingDismiss = true
    root.callService("commit", "")
    Qt.callLater(root.refresh)
  }

  function escapeOut() {
    if (root.firstRun) {
      root.dismissFirstRun()
      return
    }
    root.pendingDismiss = true
    root.callService("cancel", "")
    Qt.callLater(root.refresh)
  }

  Timer {
    interval: root.opened ? 80 : 400
    running: root.opened
    repeat: true
    onTriggered: root.refresh()
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "desktop-undo"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
      opacity: root.opened ? 1 : 0
      Behavior on opacity { NumberAnimation { duration: root.motionMs } }
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.escapeOut()
    }

    BorderSurface {
      id: film
      width: Math.min(Style.space(980), panel.width - Style.gapsOut * 2)
      height: Math.min(Style.space(280), panel.height - Style.gapsOut * 2)
      radius: root.cornerRadius
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      anchors.bottomMargin: Style.gapsOut + Style.space(24)
      color: root.background
      borderSpec: root.borderSpec
      opacity: root.opened ? 1 : 0
      scale: root.opened ? 1 : 0.98
      Behavior on opacity { NumberAnimation { duration: root.motionMs } }
      Behavior on scale { NumberAnimation { duration: root.motionMs } }

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true
        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            root.escapeOut()
            event.accepted = true
          } else if (event.key === Qt.Key_Left) {
            root.scrubBy(-1)
            event.accepted = true
          } else if (event.key === Qt.Key_Right) {
            root.scrubBy(1)
            event.accepted = true
          } else if (event.key === Qt.Key_Home) {
            root.callService("scrubTo", "0")
            event.accepted = true
          } else if (event.key === Qt.Key_End) {
            root.callService("scrubTo", String(root.liveCount))
            event.accepted = true
          } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            if (root.firstRun)
              root.dismissFirstRun()
            else
              root.commitAndClose()
            event.accepted = true
          } else if (event.key === Qt.Key_Z && (event.modifiers & Qt.ControlModifier)) {
            root.scrubBy((event.modifiers & Qt.ShiftModifier) ? 1 : -1)
            event.accepted = true
          }
        }
      }

      Column {
        anchors.fill: parent
        anchors.margins: Style.spacing.panelPadding
        spacing: Style.spacing.md

        Row {
          width: parent.width
          spacing: Style.space(12)

          Text {
            text: "Desktop Undo"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
            font.bold: true
            anchors.verticalCenter: parent.verticalCenter
          }

          Text {
            text: root.cards.length === 0
                  ? "empty"
                  : (root.liveCursor + " / " + root.liveCount + "  ·  Enter commits  ·  Esc restores")
            color: root.foreground
            opacity: 0.62
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            anchors.verticalCenter: parent.verticalCenter
          }
        }

        Item {
          width: parent.width
          height: parent.height - Style.space(48)

          ListView {
            id: strip
            anchors.fill: parent
            orientation: ListView.Horizontal
            spacing: Style.space(10)
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            model: root.cards
            visible: root.cards.length > 0
            highlightMoveDuration: root.motionMs
            preferredHighlightBegin: width / 2 - root.cardWidth / 2
            preferredHighlightEnd: width / 2 + root.cardWidth / 2
            highlightRangeMode: ListView.ApplyRange

            delegate: BorderSurface {
              id: card
              required property int index
              required property string type
              required property string title
              required property string appId
              required property string glyph
              required property string headline
              required property string label
              required property string fidelity
              required property bool undone

              width: root.cardWidth
              height: root.cardHeight
              radius: Style.spacing.labelGap
              color: {
                if (index === root.liveCursor - 1 && !undone)
                  return Style.selectedFillFor(root.foreground, root.accent)
                if (undone)
                  return "transparent"
                return Style.normalFillFor(root.foreground, root.accent)
              }
              borderSpec: index === root.liveCursor - 1
                ? Border.controlSpec("focus", root.foreground, root.accent)
                : Border.controlSpec("normal", root.foreground, root.accent)
              opacity: undone ? 0.42 : 1

              Column {
                anchors.fill: parent
                anchors.margins: Style.space(12)
                spacing: Style.space(8)

                Row {
                  width: parent.width
                  spacing: Style.space(8)

                  Image {
                    id: appIcon
                    width: Style.space(22)
                    height: Style.space(22)
                    source: card.appId ? "image://icon/" + card.appId : ""
                    fillMode: Image.PreserveAspectFit
                    asynchronous: true
                    visible: status === Image.Ready
                  }

                  Text {
                    text: card.glyph
                    color: index === root.liveCursor - 1 ? root.selectedText : root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.heading
                    visible: appIcon.status !== Image.Ready
                  }

                  Text {
                    text: card.headline
                    color: index === root.liveCursor - 1 ? root.selectedText : root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    font.bold: true
                    elide: Text.ElideRight
                    width: parent.width - Style.space(30)
                  }
                }

                Text {
                  width: parent.width
                  text: card.title
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                  wrapMode: Text.NoWrap
                  maximumLineCount: 2
                }

                Text {
                  width: parent.width
                  text: card.label === "reopen"
                        ? "reopen · best-effort"
                        : (card.fidelity === "workspace-only" ? "workspace only" : card.label)
                  color: root.accent
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }
              }

              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                  root.callService("scrubTo", String(card.index + 1))
                  Qt.callLater(root.refresh)
                }
                onDoubleClicked: root.commitAndClose()
              }
            }
          }

          Column {
            anchors.centerIn: parent
            spacing: Style.space(8)
            visible: root.cards.length === 0

            Text {
              width: film.width - Style.space(40)
              horizontalAlignment: Text.AlignHCenter
              text: "Nothing to undo yet — go break something."
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
            }

            Text {
              width: film.width - Style.space(40)
              horizontalAlignment: Text.AlignHCenter
              text: "Super+Z undo · Super+Y redo · Super+Shift+Z timeline"
              color: root.foreground
              opacity: 0.6
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }
          }
        }
      }
    }

    BorderSurface {
      visible: root.firstRun && root.opened
      width: Math.min(Style.space(520), panel.width - Style.gapsOut * 2)
      height: firstRunCol.implicitHeight + Style.spacing.panelPadding * 2
      radius: root.cornerRadius
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.top: parent.top
      anchors.topMargin: Style.gapsOut + Style.space(32)
      color: root.background
      borderSpec: root.borderSpec
      z: 20

      Column {
        id: firstRunCol
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: Style.spacing.panelPadding
        spacing: Style.space(10)

        Text {
          text: "Keybinds"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.heading
          font.bold: true
        }

        Text {
          width: parent.width
          text: "Desktop Undo does not write Hyprland config. Bind these yourself (snippet in the README):\n\nSuper+Z   undo\nSuper+Y   redo\nSuper+Shift+Z   timeline\n\nThe bar chip always opens this overlay if a bind collides."
          color: root.foreground
          wrapMode: Text.WordWrap
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }

        Text {
          text: "Enter / click anywhere on this card to dismiss"
          color: root.accent
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }

      MouseArea {
        anchors.fill: parent
        onClicked: root.dismissFirstRun()
      }
    }
  }
}
