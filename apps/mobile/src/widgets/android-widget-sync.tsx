// Android counterpart to ios-widget-sync.ts: pushes a redraw of the
// home-screen widget on demand, rather than waiting for the next scheduled
// one.
//
// WHY THIS EXISTS. `app.json`'s `updatePeriodMillis` (30 min) and the
// ADD/RESIZE lifecycle events are the ONLY things that were redrawing the
// widget. Starting a timer in the app changed nothing the widget could see,
// so a running session took up to half an hour to appear on the home screen
// — reported as "I am actually tracking time now, but it's not showing any
// of that". Android also can't be poked from outside the app: the
// APPWIDGET_UPDATE broadcast is refused for anything but the system
// (`SecurityException: not allowed to send broadcast ... from unknown
// caller` on One UI), so the update has to be requested in-process, which is
// what `requestWidgetUpdate` does.
//
// This runs INSIDE the foregrounded app, unlike widget-task-handler.tsx
// which runs as a headless task — but it deliberately calls exactly the same
// loaders, so the widget renders identically no matter which path drew it.

import { requestWidgetUpdate } from "react-native-android-widget";

import { TodayWidget } from "./TodayWidget";
import { loadWidgetTrackingState, loadWidgetViewState } from "./widget-data";

/** Must match the `name` in app.json's `react-native-android-widget` plugin config. */
const WIDGET_NAME = "TodayWidget";

/**
 * Redraws every placed copy of the Today widget with current data. Safe to
 * call when no widget is on the home screen (the library's `widgetNotFound`
 * path just no-ops) and safe to call on iOS, where it returns immediately —
 * see `syncWidgets` in ./widget-sync.ts for the platform gate.
 */
export async function syncAndroidWidget(): Promise<void> {
  const [state, tracking] = await Promise.all([loadWidgetViewState(), loadWidgetTrackingState()]);
  await requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: (info) => <TodayWidget state={state} tracking={tracking} heightDp={info.height} />,
    // Nothing to clean up — the periodic update is declared in the manifest
    // (`updatePeriodMillis`), not something this module scheduled.
    widgetNotFound: () => undefined,
  });
}
