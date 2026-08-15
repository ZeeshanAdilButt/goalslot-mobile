// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed —
// same rationale as notifications.test.ts.
//
// Deliberately NOT `jest.mock("react-native", ...)` — spreading
// `jest.requireActual("react-native")` into a factory re-evaluates
// react-native's own index.js under jest-expo's preset in a way that trips
// over `TurboModuleRegistry.getEnforcing('DevMenu')` (a module the preset
// never registers, because nothing normally needs it), which fails the whole
// suite before a single test runs. `jest.spyOn` the real singleton's methods
// instead — same isolation, none of the re-require cost.
import { Linking, Platform } from "react-native";

import { openBatteryOptimizationSettings } from "./battery-optimization";

describe("openBatteryOptimizationSettings", () => {
  const originalPlatform = Platform.OS;

  function setPlatform(os: "ios" | "android") {
    Object.defineProperty(Platform, "OS", { value: os, configurable: true });
  }

  let sendIntentSpy: jest.SpyInstance;
  let openSettingsSpy: jest.SpyInstance;

  beforeEach(() => {
    sendIntentSpy = jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined);
    openSettingsSpy = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: originalPlatform, configurable: true });
    sendIntentSpy.mockRestore();
    openSettingsSpy.mockRestore();
  });

  it("is a no-op on iOS — Apple exposes no equivalent battery-exemption lever", async () => {
    setPlatform("ios");

    await openBatteryOptimizationSettings();

    expect(sendIntentSpy).not.toHaveBeenCalled();
    expect(openSettingsSpy).not.toHaveBeenCalled();
  });

  it("opens the OS battery-optimization list on Android", async () => {
    setPlatform("android");

    await openBatteryOptimizationSettings();

    expect(sendIntentSpy).toHaveBeenCalledWith("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
    expect(openSettingsSpy).not.toHaveBeenCalled();
  });

  it("falls back to the app's own settings page if the intent can't be resolved", async () => {
    setPlatform("android");
    sendIntentSpy.mockRejectedValue(new Error("no activity found to handle intent"));

    await openBatteryOptimizationSettings();

    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws — this is called from a settings row's onPress", async () => {
    setPlatform("android");
    sendIntentSpy.mockRejectedValue(new Error("boom"));
    openSettingsSpy.mockRejectedValue(new Error("also boom"));

    await expect(openBatteryOptimizationSettings()).resolves.toBeUndefined();
  });
});
