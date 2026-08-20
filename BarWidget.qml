import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "js/Journal.js" as Journal
import "js/Config.js" as Config

BarWidget {
  id: root
  moduleName: "io.github.chris.desktop-undo"

  property int depth: 0
  property int redoDepth: 0

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

  function refresh() {
    var snap = Journal.snapshot()
    root.depth = snap.depth
    root.redoDepth = snap.redoDepth
  }

  visible: root.depth > 0 || !root.hideAtZero
  implicitWidth: visible ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  Timer {
    interval: 250
    running: true
    repeat: true
    onTriggered: root.refresh()
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.depth > 0 ? ("↩ " + root.depth) : "↩"
    tooltipText: root.depth > 0
                 ? (root.depth + " action" + (root.depth === 1 ? "" : "s") + " to undo")
                 : "Desktop Undo — nothing yet"
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.LeftButton)
        root.summonOverlay()
      else if (buttonCode === Qt.RightButton)
        Quickshell.execDetached(["omarchy-shell", "shell", "call", root.moduleName, "undo", ""])
    }
  }

  Component.onCompleted: root.refresh()
}
