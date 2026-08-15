// Deep-links into Android's own battery-optimization settings.
//
// WHY this exists at all: the "sound"-key fix in notifications.ts and the
// SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM permissions in app.json make
// scheduleNotificationAsync ask Android's AlarmManager for an EXACT,
// Doze-surviving alarm (setExactAndAllowWhileIdle) — but that is a request
// the OS is still free to defer or drop entirely once the app itself has
// been put to sleep. Samsung's One UI ships its own battery manager on top
// of stock Android Doze ("Settings > Battery > Background usage limits >
// Sleeping apps" / "Put unused apps to sleep"), and it is well documented to
// silently delay or skip exactly this kind of scheduled alarm for apps the
// user hasn't explicitly excluded — regardless of how correctly the app
// itself scheduled the alarm. There is nothing in expo-notifications' JS API
// that can check or change this (see the module's own Kotlin source: only
// `canScheduleExactAlarms()`/`setExactAndAllowWhileIdle` are used, neither of
// which touches OEM battery management), so this is the one lever the app
// actually has: send the user straight to the OS screen where they can
// exempt GoalSlot themselves.
//
// `android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS` opens the general
// list of every app's battery-optimization status — deliberately NOT
// `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (the direct per-app "allow"
// dialog), which needs a `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` manifest
// permission that Play Store policy restricts to apps whose core function IS
// battery management. The list screen needs no special permission, works
// identically on every OEM skin, and is where Samsung surfaces its own
// "Sleeping apps" exclusions too, so one tap gets a Samsung user to the
// right place regardless of which battery feature is actually responsible.
import { Linking, Platform } from "react-native";

const IGNORE_BATTERY_OPTIMIZATION_SETTINGS_ACTION = "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS";

/**
 * Opens the OS battery-optimization list on Android; a harmless no-op on iOS
 * (Apple gives apps no equivalent lever, and background app refresh is
 * already covered by its own OS-level toggle, not something this app can
 * deep-link to more specifically than Settings itself).
 *
 * Never throws — this is called from a settings row's `onPress`, where the
 * worst acceptable outcome is "nothing happened," not an unhandled
 * rejection. If the specific battery-list intent isn't resolvable on some
 * OEM variant, falling back to the app's own settings page still gets the
 * user one tap closer (most OEMs surface a per-app battery control there
 * too).
 */
export async function openBatteryOptimizationSettings(): Promise<void> {
  if (Platform.OS !== "android") return;

  try {
    await Linking.sendIntent(IGNORE_BATTERY_OPTIMIZATION_SETTINGS_ACTION);
    return;
  } catch (error) {
    console.warn(
      "[battery-optimization] could not open the battery-optimization list, falling back to app settings",
      error,
    );
  }

  // Separate try/catch: a failure here must not become an unhandled
  // rejection either — see the "never throws" contract above.
  try {
    await Linking.openSettings();
  } catch (error) {
    console.warn("[battery-optimization] could not open app settings either", error);
  }
}
