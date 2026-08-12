import ExpoModulesCore
import WidgetKit

// Bridges the app's own JS process to the WidgetKit extension process — the
// two never share memory (separate processes, same as the RN app and any
// other app extension), so the only channel between them is the shared
// App Group container. `setState` writes the JSON blob the widget's
// TimelineProvider reads on next redraw; `reload` asks WidgetKit to redraw
// now instead of waiting for its own timeline policy to fire.
public class WidgetBridgeModule: Module {
  static let appGroupId = "group.io.goalslot.mobile"
  static let stateKey = "widget_state"

  public func definition() -> ModuleDefinition {
    Name("WidgetBridge")

    Function("setState") { (json: String) -> Void in
      UserDefaults(suiteName: WidgetBridgeModule.appGroupId)?.set(json, forKey: WidgetBridgeModule.stateKey)
    }

    Function("reload") { () -> Void in
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }
  }
}
