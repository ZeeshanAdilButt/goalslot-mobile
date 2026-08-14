// The modal shell every Settings detail form opens in.
//
// Web gives each settings tab a whole pane next to a persistent sidebar
// (dw-time-web/src/app/dashboard/settings/page.tsx:67-107). A phone has room
// for one pane, so the eight-tab layout collapses to a list of rows and the
// detail opens over it. A sheet rather than a pushed route on purpose: these
// forms are all "open, change one thing, dismiss", and every new route under
// app/(app)/ has to be registered by hand in that folder's `_layout.tsx`,
// which several concurrent efforts are editing.
//
// Structure follows src/components/timer/TrackingPicker.tsx, the app's
// existing bottom sheet — `transparent` Modal, tap-swallowing backdrop,
// bottom inset applied by hand because a Modal renders outside the screen's
// SafeAreaView.
//
// Three things this adds over that one, all of them because these sheets
// contain text inputs and destructive actions rather than a list of choices:
//   - `KeyboardAvoidingView`, so a focused field near the bottom of a long
//     form (the delete-account confirmation, the API key field) is not left
//     under the keyboard.
//   - `accessibilityViewIsModal`, so VoiceOver/TalkBack stop at the sheet
//     instead of walking through to the Settings rows behind it.
//   - A `maxHeight` plus an internal ScrollView, so a form that outgrows the
//     screen scrolls rather than pushing its own submit button off-screen.

import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface SettingsSheetProps {
  visible: boolean;
  title: string;
  /** One muted line under the title explaining what this form does. */
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export function SettingsSheet({ visible, title, description, onClose, children }: SettingsSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        // Android does NOT resize the window for the keyboard here — that
        // only happens under adjustResize, which edge-to-edge (on unconditionally
        // once targeting SDK 35+) makes the OS ignore. "height" is what makes
        // this sheet actually move out from under the keyboard on Android too.
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
        >
          {/* Tap-swallower so presses inside the sheet don't dismiss it.
              `accessible={false}` keeps this wrapper out of the accessibility
              tree — as a Pressable it would otherwise be focusable and
              announce as an unlabelled "button" around the whole form. */}
          <Pressable
            accessible={false}
            accessibilityViewIsModal
            style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}
          >
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title} accessibilityRole="header">
                  {title}
                </Text>
                {description ? <Text style={styles.description}>{description}</Text> : null}
              </View>
              <Pressable
                onPress={onClose}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
              >
                <Icon name="close" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {children}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.lg,
    // Leaves the top of the screen visible so the sheet reads as layered over
    // Settings rather than as a new screen, and caps how far a long form can
    // grow before its ScrollView takes over.
    maxHeight: "88%",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
  },
  description: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  closeButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    // Pulled out to the sheet's edge so the 44pt target doesn't push the
    // title inward by its own padding.
    marginRight: -spacing.md,
    marginTop: -spacing.sm,
  },
  body: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
});
