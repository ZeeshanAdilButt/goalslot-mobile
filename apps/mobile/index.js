// Custom entry point, replacing the default `"main": "expo-router/entry"`
// in package.json (see the DEVIATION note in the task report for why this
// one field had to change alongside it).
//
// WHY this file has to exist, and why the registration below can't instead
// live inside `app/_layout.tsx`: the widget's background task
// (`src/widgets/widget-task-handler.tsx`) is invoked by Android as a
// *headless* JS task — a fresh JS instance with no Activity, spun up to
// redraw the widget while the app itself is not open. In that mode,
// `expo-router/entry` still runs (it's the "main" module, so its top-level
// code always executes), but `registerRootComponent` only *registers* the
// root component for native to mount LATER via `runApplication` — headless
// tasks never call `runApplication`, so the component is never rendered.
// `expo-router` resolves the route tree (and therefore requires
// `app/_layout.tsx` and everything under `app/`) lazily, from inside that
// render, via `require.context` — so in headless mode `app/_layout.tsx`
// literally never executes, and anything registered from inside it (a
// headless task included) would never run in the exact case this widget
// needs it most. The registration below sits at this file's own top level
// instead, which — as the bundle's entry module — always executes on every
// load, headless or not.
import "expo-router/entry";

import { registerWidgetTaskHandler } from "react-native-android-widget";

import { widgetTaskHandler } from "./src/widgets/widget-task-handler";

registerWidgetTaskHandler(widgetTaskHandler);
