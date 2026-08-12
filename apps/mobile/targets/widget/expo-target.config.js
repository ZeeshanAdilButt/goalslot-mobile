/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "widget",
  name: "GoalSlotWidget",
  bundleIdentifier: "io.goalslot.mobile.widget",
  deploymentTarget: "17.0",
  entitlements: {
    "com.apple.security.application-groups": ["group.io.goalslot.mobile"],
  },
  colors: {
    $accent: "#F2CC0D",
  },
  frameworks: ["SwiftUI", "WidgetKit"],
};
