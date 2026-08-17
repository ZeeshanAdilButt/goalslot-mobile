// Settings. A grouped list of rows, each opening a detail sheet — the phone
// shape of dw-time-web's eight-tab settings page
// (dw-time-web/src/app/dashboard/settings/page.tsx), which puts a persistent
// sidebar next to a detail pane. There is room for one pane here, so the
// sidebar becomes the screen and the pane becomes a sheet. The row
// primitives and the sheets live in src/components/settings.
//
// What each of web's eight tabs became, and why:
//
//   profile       ported. `PUT /users/profile` takes `{ name, avatar }`; name
//                 is editable, email is read-only because no route changes it.
//   appearance    dropped. Web hides this tab too (see the comment on its
//                 TABS array) — the theme is not wired up on either platform.
//                 Mobile used to ship a segmented control here whose own
//                 helper text admitted it did nothing; it and its store field
//                 are gone (src/lib/settings-store.ts).
//   categories    linked. app/(app)/categories.tsx already manages categories
//                 AND labels; a second copy inside Settings would be a second
//                 thing to keep in step.
//   billing       read-only plan badge, no purchase path. Not an oversight —
//                 see the "Plan" row below.
//   security      ported. The two-step emailed-OTP password change. SSO
//                 accounts get an explanation instead, since the API rejects
//                 a password change on them.
//   data          partially ported. Delete account, with web's type-the-word
//                 gate. There is no account data-export endpoint on the API
//                 (only a time-report export, which belongs to Reports), so
//                 nothing here pretends to offer one.
//   integrations  ported as "AI provider key" — the BYOK credential the Coach
//                 runs on, which is exactly the thing a user discovers is
//                 missing while holding their phone.
//   coach-profile ported. Three free-text/choice fields; cheap to port and
//                 the kind of reflective writing people do on a phone.
//
// Logout stays the load-bearing one: useAuth().logout() existed since the
// auth provider was built and nothing called it until this screen shipped.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import * as Updates from "expo-updates";

import type { NotificationPermissionStatus } from "@goalslot/shared";

import { ScreenHeader } from "@/components/lists";
import {
  AiKeySheet,
  ChangePasswordSheet,
  CoachProfileSheet,
  DeleteAccountSheet,
  EditProfileSheet,
  SettingsRow,
  SettingsSection,
} from "@/components/settings";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useScreenView } from "@/hooks/useScreenView";
import { getErrorMessage } from "@/lib/get-error-message";
import { createPushRegistrationPort, syncPushRegistration } from "@/lib/push-registration";
import { showToast } from "@/lib/toast-store";
import { checkForUpdateAndReload } from "@/lib/updates";
import { useCapabilities } from "@/providers/capabilities-provider";
import { useAuth } from "@/providers/auth-provider";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";
import { useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { hiddenTabBackDestination } from "@/lib/hidden-tab-routes";

// The three screens that were cut from the tab bar (see app/(app)/_layout.tsx)
// but still need a way in. The navigation drawer is the primary route to them
// now; these stay because "Categories" is one of web's own settings tabs, and
// dropping the row would make Settings look like it lost a feature.
const MORE_LINKS: { href: "/categories" | "/reports" | "/journal"; label: string; description: string }[] = [
  { href: "/categories", label: "Categories & labels", description: "The colors your goals and tasks group by" },
  { href: "/reports", label: "Reports", description: "Weekly stats and trends" },
  { href: "/journal", label: "Journal", description: "Your daily writing entries" },
];

type SheetName = "profile" | "password" | "coach-profile" | "ai-key" | "delete-account";

const PLAN_LABELS: Record<string, string> = {
  FREE: "Free",
  BASIC: "Basic",
  PRO: "Pro",
};

/**
 * Plan limits arrive as `null` for the unlimited tiers, not as a big number:
 * the API computes them as JS `Infinity` and `JSON.stringify(Infinity)` is
 * `null`. Rendering that raw would read as "0 goals" to anyone on Pro.
 */
function formatLimit(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "Unlimited" : String(value);
}

// Read-only build info for the "About" row below. Every field here has a
// legitimate reason to be missing (a local dev build has no EAS commit hash,
// an Expo Go session has no android.versionCode/ios.buildNumber) so each one
// falls back to "—" rather than rendering "undefined" or crashing the row.
// Platform-specific: app.json sets android.versionCode (a number) and
// ios.buildNumber (a string) separately, so reading only the Android field
// left this row permanently "—" on iOS devices.
const appVersion = Constants.expoConfig?.version ?? "—";
const platformBuildNumber =
  Platform.OS === "ios" ? Constants.expoConfig?.ios?.buildNumber : Constants.expoConfig?.android?.versionCode;
const buildNumber = platformBuildNumber !== undefined ? String(platformBuildNumber) : "—";
// Read defensively, not just cast: this crashed in production as
// `TypeError: undefined is not a function` on `.slice` — `extra.gitCommitHash`
// is typed `string | null` in app.config.js, but that's a build-time TS
// assertion, not a runtime guarantee. Confirmed via a source-mapped device
// crash log pointing straight at the old `gitCommitHash.slice(0, 7)` call:
// whatever actually lands in the embedded/OTA manifest here, a non-string
// truthy value (seen on both iOS and Android, since this runs at module load
// for every user) must fall back to "dev" instead of calling a method that
// doesn't exist on it.
const rawGitCommitHash = Constants.expoConfig?.extra?.gitCommitHash;
// Short enough to sit on one settings row, long enough to be unambiguous
// against a `git log --oneline` on the machine that built it. Every build
// shipped so far is local (gradlew/xcodebuild directly, never a real EAS
// cloud build), so this is unset on every real install — "dev" read as an
// unfinished-looking label to the actual people now using this app, so an
// absent hash reads as "Beta" instead. The precise, always-accurate answer
// to "what's actually running" lives in the "Live update" row below this
// one (expo-updates' own runtime state), not here.
const shortCommit = typeof rawGitCommitHash === "string" && rawGitCommitHash.length > 0
  ? rawGitCommitHash.slice(0, 7)
  : null;
const aboutValue = `${appVersion} (${buildNumber})`;
const aboutDescription = shortCommit ? `Build ${shortCommit}` : "Beta";

// The single most reliable answer to "am I actually on the latest fix" —
// unlike the row above, which only reflects the NATIVE binary's build time,
// this reflects whichever JS bundle is genuinely running RIGHT NOW,
// embedded or fetched over the air. `Updates.updateId`/`createdAt` are set
// by expo-updates itself at launch, not by anything this app computes, so
// they can't drift from reality the way a manually-read build stamp can.
const updateValue = Updates.isEmbeddedLaunch
  ? "Embedded build"
  : (Updates.updateId?.slice(0, 8) ?? "Unknown");
const updateDescription = Updates.isEmbeddedLaunch
  ? "No update fetched yet — running the code baked into this install"
  : Updates.createdAt
    ? `Published ${Updates.createdAt.toLocaleString()}`
    : "Update time unknown";

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { notifications } = useCapabilities();
  const router = useRouter();

  const [openSheet, setOpenSheet] = useState<SheetName | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionStatus | null>(null);
  const [pendingLogout, setPendingLogout] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const closeSheet = useCallback(() => setOpenSheet(null), []);

  // The "Live update" row used to be read-only — informational, no
  // `onPress`, no chevron. That's exactly why tapping it visibly did
  // nothing: not a bug in the row, but a real gap given how much today's
  // testing has hinged on "am I actually on the latest code" — a manual
  // check is a genuinely useful action to put there instead of leaving it
  // inert. `checkForUpdateAsync` alone only asks the server; an available
  // update still has to be fetched and the app reloaded to actually run it.
  const handleCheckForUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const status = await checkForUpdateAndReload(() =>
        showToast("Downloading the latest update…", "success"),
      );
      if (status === "unavailable") {
        showToast("Updates aren't available in this build.", "error");
      } else if (status === "up-to-date") {
        showToast("You're already on the latest update.", "success");
      }
      // "updated" reloads the app before execution gets back here.
    } catch (err) {
      showToast(getErrorMessage(err, "Couldn't check for an update."), "error");
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  useScreenView("settings");
  useHiddenTabBackHandler(hiddenTabBackDestination("settings"));

  // Re-read on every focus rather than once on mount. Granting notifications
  // means leaving for the OS settings app and coming back, and the row has to
  // be right when the user returns — this screen is the one place they'll
  // look to check whether it worked.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void notifications.getPermissionStatus().then((status) => {
        if (!cancelled) setPermission(status);
      });
      return () => {
        cancelled = true;
      };
    }, [notifications]),
  );

  // Permission is requested from this screen too (the Notifications row
  // below), and remote push can only register once it exists — so mirror
  // notification-settings.tsx and sync the device's push token the moment
  // the grant lands, instead of leaving it until the next cold start. Both
  // screens do this rather than one, because either can be where the user
  // says yes. The sync is idempotent, so the overlap costs nothing.
  useEffect(() => {
    if (permission !== "granted" || !user?.id) return;
    void syncPushRegistration(user.id, createPushRegistrationPort());
  }, [permission, user?.id]);

  // Two different jobs share this one row, gated on whether permission is
  // settled yet. Not settled: this IS the permission control — request it,
  // or (once already declined) send the user to the OS settings that are now
  // the only way to flip it. Settled and granted: there's nothing left to
  // request, so tapping opens the notification-settings screen where the
  // rest of the notification preferences (schedule alarms, timer nudges)
  // actually live. Previously onPress was simply `undefined` in the granted
  // case — a chevron-less, handler-less row that looked like every other
  // settings row but did nothing when tapped, which is the exact "many
  // things in settings are unclickable" bug this fixes.
  const handleNotificationsPress = useCallback(async () => {
    if (permission === "granted") {
      router.push("/notification-settings");
      return;
    }
    if (permission === "denied") {
      // iOS only ever shows the system prompt once. After a decline the only
      // way back is the device's own settings, so send them there rather than
      // firing a request that raises nothing.
      await Linking.openSettings();
      return;
    }
    const granted = await notifications.requestPermission();
    setPermission(granted ? "granted" : await notifications.getPermissionStatus());
  }, [notifications, permission, router]);

  // Destructive from the user's point of view — they land back on the login
  // screen — so it needs a confirm step rather than firing on one stray tap.
  // No analytics event: "loggedOut" isn't in the v1 AnalyticsEventMap
  // (packages/shared/src/growth/index.ts).
  const confirmLogout = useCallback(() => setPendingLogout(true), []);

  const isSso = user?.userType === "SSO";
  const plan = user?.plan ?? "FREE";
  const planLabel = PLAN_LABELS[plan] ?? plan;

  const notificationsValue =
    permission === "granted" ? "On" : permission === "denied" ? "Blocked" : permission ? "Off" : "—";
  const notificationsDescription =
    permission === "granted"
      ? "Tap to manage schedule alarms and timer nudges."
      : permission === "denied"
        ? "Turned off in your device settings. Tap to open them."
        : "Tap to allow schedule reminders and timer nudges.";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <ScreenHeader eyebrow="Account" title="Settings" subtitle="Your profile, security and preferences." />

        <SettingsSection title="Profile">
          <SettingsRow
            label={user?.name || "Add your name"}
            description={user?.email || undefined}
            onPress={() => setOpenSheet("profile")}
            accessibilityLabel={`Edit profile. ${user?.name || "No name set"}, ${user?.email ?? ""}`}
            leading={
              // Decorative — the initial repeats the name in the row's own
              // label, so announcing it again would just be noise.
              <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Text style={styles.avatarInitial}>
                  {(user?.name || user?.email || "?").charAt(0).toUpperCase()}
                </Text>
              </View>
            }
          />
          {/* Web's Billing tab, reduced to the one thing that is safe to show
              in a native app. Apple's rules forbid an iOS app from pointing
              users at an outside purchase flow for digital content, and this
              product's only upgrade path is a Stripe checkout page on the
              web. Displaying the plan you already have is fine; a button that
              takes you somewhere to buy one is not. So: no upgrade CTA, no
              "email us to switch" link (web has one — it does not belong
              here), no external URL. Cancelling and upgrading happen on the
              web app. */}
          <SettingsRow
            label="Plan"
            icon="credit-card"
            value={user?.unlimitedAccess ? `${planLabel} · Unlimited` : planLabel}
            description={`${formatLimit(user?.limits?.maxGoals)} goals · ${formatLimit(
              user?.limits?.maxTasksPerDay,
            )} tasks a day`}
            divider={false}
          />
        </SettingsSection>

        <SettingsSection
          title="Notifications"
          footnote="Schedule alarms and how often the timer nudges you both live one tap in, once notifications are on."
        >
          <SettingsRow
            label="Notifications"
            icon={permission === "granted" ? "bell" : "bell-off"}
            value={notificationsValue}
            description={notificationsDescription}
            onPress={() => void handleNotificationsPress()}
            // Announces as a link once there's a real destination (granted),
            // and as a button while it's still the permission control itself.
            isLink={permission === "granted"}
            accessibilityHint={
              permission === "denied" ? "Opens your device settings for this app" : undefined
            }
            divider={false}
          />
        </SettingsSection>

        <SettingsSection title="Security">
          {isSso ? (
            <SettingsRow
              label="Single sign-on"
              icon="shield"
              description="Your password is managed by your SSO provider. Change it there."
              divider={false}
            />
          ) : (
            <SettingsRow
              label="Change password"
              icon="shield"
              description="We'll email you a code to confirm it's you."
              onPress={() => setOpenSheet("password")}
              divider={false}
            />
          )}
        </SettingsSection>

        <SettingsSection
          title="Coach"
          footnote="Without your own key the coach runs on a small shared allowance."
        >
          <SettingsRow
            label="Coach profile"
            icon="sparkles"
            description="Your why, and any context the coach should respect."
            onPress={() => setOpenSheet("coach-profile")}
          />
          <SettingsRow
            label="AI provider key"
            icon="key-round"
            description="Bring your own OpenAI, Anthropic, Gemini or OpenRouter key."
            onPress={() => setOpenSheet("ai-key")}
          />
          {/* The two rows above configure the coach; this is where you use
              it. Settings routes to the existing screen rather than growing
              a chat of its own. */}
          <SettingsRow
            label="Open Coach"
            icon="coach"
            description="Chat with your coach about this week."
            isLink
            onPress={() => router.push("/coach")}
            divider={false}
          />
        </SettingsSection>

        <SettingsSection title="More">
          {MORE_LINKS.map((link, index) => (
            // `router.push` rather than `<Link asChild>`: asChild clones the
            // child into expo-router's Slot and injects its own `onPress`,
            // `href` and a ref, which needs the child to be a forwardRef that
            // tolerates unknown props. SettingsRow is neither, and the
            // navigation drawer already navigates this way
            // (src/components/navigation/DrawerContent.tsx).
            <SettingsRow
              key={link.href}
              label={link.label}
              description={link.description}
              isLink
              onPress={() => router.push(link.href)}
              divider={index < MORE_LINKS.length - 1}
            />
          ))}
        </SettingsSection>

        <SettingsSection
          title="Data & privacy"
          footnote="Exporting your account data isn't available yet — the API has no endpoint for it. Time reports can be exported from the web app."
        >
          <SettingsRow
            label="Delete account"
            icon="trash"
            description="Permanently removes your account and everything in it."
            destructive
            onPress={() => setOpenSheet("delete-account")}
            accessibilityHint="Opens a confirmation you have to type into"
            divider={false}
          />
        </SettingsSection>

        <SettingsSection style={styles.logoutSection}>
          <SettingsRow
            label="Log out"
            icon="logout"
            destructive
            onPress={confirmLogout}
            divider={false}
            chevron={false}
          />
        </SettingsSection>

        {/* "GoalSlot" below is read-only — no onPress, no chevron, no sheet.
            "Live update" is not: it used to be read-only too, which is
            exactly why tapping it visibly did nothing (a real, reported
            confusion) — it now runs a manual update check. */}
        <SettingsSection title="About">
          <SettingsRow
            label="GoalSlot"
            icon="info"
            value={aboutValue}
            description={aboutDescription}
          />
          <SettingsRow
            label="Live update"
            icon="refresh"
            value={checkingUpdate ? "Checking…" : updateValue}
            description={updateDescription}
            onPress={() => void handleCheckForUpdate()}
            disabled={checkingUpdate}
            accessory={checkingUpdate ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : undefined}
            accessibilityHint="Checks for a newer version and applies it if one is available"
            divider={false}
          />
        </SettingsSection>
      </ScrollView>

      <EditProfileSheet visible={openSheet === "profile"} onClose={closeSheet} />
      <ChangePasswordSheet visible={openSheet === "password"} onClose={closeSheet} />
      <CoachProfileSheet visible={openSheet === "coach-profile"} onClose={closeSheet} />
      <AiKeySheet visible={openSheet === "ai-key"} onClose={closeSheet} />
      <DeleteAccountSheet visible={openSheet === "delete-account"} onClose={closeSheet} />

      <ConfirmDialog
        visible={pendingLogout}
        title="Log out?"
        description="You'll need to sign in again to access your schedule."
        confirmLabel="Log out"
        destructive
        onConfirm={() => {
          setPendingLogout(false);
          void logout();
        }}
        onCancel={() => setPendingLogout(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.subtle,
  },
  avatarInitial: {
    color: colors.primaryForeground,
    fontSize: typography.body.fontSize,
    fontWeight: "700",
  },
  logoutSection: {
    marginBottom: spacing.md,
  },
});
