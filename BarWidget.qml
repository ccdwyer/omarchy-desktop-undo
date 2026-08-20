import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "js/Journal.js" as Journal
import "js/Config.js" as Config
import "js/Binds.js" as Binds

BarWidget {
  id: root
  moduleName: "io.github.chris.desktop-undo"

  property int depth: 0
  property int redoDepth: 0
  property bool offerBinds: false
  property string offerNote: ""

  readonly property bool hideAtZero: {
    if (typeof setting === "function")
      return Config.boolFrom(setting("hideChipAtZero", true), true)
    return Config.hideChipAtZeroFrom(root.settings)
  }

  readonly property bool opened: false

  function open() { root.summonOverlay() }
  function close() {}
  function toggle() { root.summonOverlay() }

  function summonOverlay() {
    Quickshell.execDetached(["omarchy-shell", "shell", "summon", root.moduleName, "{}"])
  }

  function undoLast() {
    Quickshell.execDetached(["omarchy-shell", root.moduleName, "undo", ""])
  }

  function refresh() {
    var snap = Journal.snapshot()
    root.depth = snap.depth
    root.redoDepth = snap.redoDepth
    var offer = Binds.offer || {}
    root.offerBinds = !!offer.needed
    root.offerNote = String(offer.note || "Add Super+Z undo")
  }

  function installBinds() {
    Quickshell.execDetached(["omarchy-shell", root.moduleName, "installBinds", ""])
  }

  visible: root.depth > 0 || !root.hideAtZero || root.offerBinds
  implicitWidth: visible ? row.implicitWidth : 0
  implicitHeight: row.implicitHeight

  Timer {
    interval: 250
    running: true
    repeat: true
    onTriggered: root.refresh()
  }

  Row {
    id: row
    spacing: Style.space(4)

    WidgetButton {
      id: button
      bar: root.bar
      text: root.depth > 0 ? ("↩ " + root.depth) : "↩"
      tooltipText: root.depth > 0
                   ? (root.depth + " action" + (root.depth === 1 ? "" : "s") + " to undo")
                   : "Desktop Undo — nothing yet"
      onPressed: function(buttonCode) {
        if (buttonCode === Qt.LeftButton)
          root.summonOverlay()
        else if (buttonCode === Qt.RightButton)
          root.undoLast()
      }
    }

    WidgetButton {
      visible: root.offerBinds
      bar: root.bar
      text: "keys"
      tooltipText: root.offerNote.length ? root.offerNote : "Add Super+Z / Super+Y keybindings (skips combos you already use)"
      onPressed: function(buttonCode) {
        if (buttonCode === Qt.LeftButton)
          root.installBinds()
      }
    }
  }

  Component.onCompleted: root.refresh()
}
