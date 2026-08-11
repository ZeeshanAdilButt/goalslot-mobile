// Headless-JS entry point react-native-android-widget invokes for every
// widget lifecycle event (add / periodic update / resize / click / delete).
// Registered from the app's entry point (see ../../index.js's header
// comment for why registration has to happen there and not inside
// app/_layout.tsx) so it runs on every bundle load, including the headless
// one Android uses to redraw the widget while the app itself isn't open.
//
// This is a SEPARATE JS instance from the foregrounded app — see
// widget-data.ts's header comment. It must not assume any React tree,
// navigation state, or in-memory query cache exists.

import { registerWidgetTaskHandler, type WidgetTaskHandlerProps } from "react-native-android-widget";

import { TodayWidget } from "./TodayWidget";
import { loadWidgetViewState } from "./widget-data";

export async function widgetTaskHandler({ widgetAction, renderWidget }: WidgetTaskHandlerProps): Promise<void> {
  switch (widgetAction) {
    // These three are the only actions that need fresh content: a widget
    // was just placed on the home screen, Android's periodic timer fired
    // (`updatePeriodMillis` in app.json), or the widget was resized (same
    // content, needs a redraw to fit).
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED": {
      const state = await loadWidgetViewState();
      renderWidget(<TodayWidget state={state} />);
      return;
    }

    // WIDGET_CLICK opens the app entirely natively via the tapped element's
    // own `clickAction: "OPEN_URI"` (see TodayWidget.tsx) — no JS work
    // needed. WIDGET_DELETED has nothing left to draw (the instance is
    // gone; `renderWidget` no-ops for it internally anyway).
    case "WIDGET_CLICK":
    case "WIDGET_DELETED":
    default:
      return;
  }
}

registerWidgetTaskHandler(widgetTaskHandler);
