import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "js/Journal.js" as Journal
import "js/Config.js" as Config

BarWidget {
  id: root
  moduleName: "io.github.chris.desktop-undo"

  property int depth: 0
  property int redoDepth: 0
  property bool hideAtZero: true

  readonly property var undoService: {
    if (bar && bar.shell && typeof bar.shell.firstPartyServiceFor === "function") {
      var s = bar.shell.firstPartyServiceFor(root.moduleName)
      if (s)
        return s
    }
    if (bar && bar.shell && typeof bar.shell.serviceFor === "function")
      return bar.shell.serviceFor(root.moduleName)
    return null
  }

  readonly property bool opened: false

  function open() { root.summonOverlay() }
  function close() {}
  function toggle() { root.summonOverlay() }

  function summonOverlay() {
    if (undoService && typeof undoService.openTimeline === "function") {
      undoService.openTimeline()
      return
    }
    if (bar && bar.shell && typeof bar.shell.summon === "function") {
      bar.shell.summon(root.moduleName, "{}")
      return
    }
    Quickshell.execDetached(["omarchy-shell", "shell", "summon", root.moduleName, "{}"])
  }

  function refresh() {
    var snap = Journal.snapshot()
    root.depth = snap.depth
    root.redoDepth = snap.redoDepth
    root.hideAtZero = Config.hideChipAtZero
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
      else if (buttonCode === Qt.RightButton && root.undoService && typeof root.undoService.undo === "function")
        root.undoService.undo()
    }
  }

  Component.onCompleted: root.refresh()
}
