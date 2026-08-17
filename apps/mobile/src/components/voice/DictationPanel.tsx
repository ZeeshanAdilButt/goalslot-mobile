// The visible half of continuous dictation: the four status panels
// (priming / listening / blocked / stopped) plus the always-mounted
// hold-to-record mic that starts a run.
//
// Lifted from app/(app)/journal.tsx, where this UI was designed and tuned,
// so a second dictation surface is the same thing rather than a lesser
// lookalike. Every non-obvious detail below came from a real problem on that
// screen and is worth keeping:
//
//  - The mic row is ALWAYS MOUNTED, collapsed to zero height rather than
//    unmounted once a run starts. The touch that began the hold is still down
//    at that instant, and unmounting the row under the finger orphans it in
//    the gesture recognizer.
//  - Collapsed-but-mounted must also disappear from the screen reader, or an
//    invisible "start dictation" button stays in the traversal order while
//    the real listening panel is what's on screen.
//  - `processing` renders the dot wave, not the listening caption: the beat
//    between a phrase ending and its transcript settling otherwise showed
//    caption text that had quietly gone stale.
//  - The "Stop listening" pill is persistent and always visible while
//    capturing — the obvious way out, not something to discover.
//
// Copy is passed in (`idleLabel`, `listeningPlaceholder`, the mic's
// accessibility strings) because that is the only part that is genuinely
// per-surface; the states, geometry and behaviour are not.

import { StyleSheet, Pressable, Text, View } from "react-native";

import { Icon } from "@/components/ui/Icon";
import { TypingIndicator } from "@/components/ui/TypingIndicator";
import { HoldToRecordMic } from "@/components/voice/HoldToRecordMic";
import { MicOrb } from "@/components/voice/MicOrb";
import type { VoiceCaptureState } from "@/hooks/useVoiceCapture";
import type { DictationMode } from "@/lib/dictation-loop";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme";

export interface DictationPanelProps {
  mode: DictationMode;
  voiceState: VoiceCaptureState;
  /** Overrides the default "stopped listening" copy — set when a run ended
   *  because writing a phrase failed rather than because of silence. */
  notice: string | null;
  /** Shown in the listening panel until the first interim transcript lands. */
  listeningPlaceholder: string;
  /** The invitation beside the idle mic. */
  idleLabel: string;
  micAccessibilityLabel: string;
  micAccessibilityHint: string;
  onBegin: () => void;
  onStop: () => void;
  onResume: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
}

export function DictationPanel({
  mode,
  voiceState,
  notice,
  listeningPlaceholder,
  idleLabel,
  micAccessibilityLabel,
  micAccessibilityHint,
  onBegin,
  onStop,
  onResume,
  onDismiss,
  onOpenSettings,
}: DictationPanelProps) {
  const isDictating = mode === "priming" || mode === "listening";

  return (
    <>
      {mode === "priming" ? (
        <View style={styles.voicePriming} accessibilityLiveRegion="polite">
          {/* The same animated dot wave Coach/voice.tsx use for "the system is
              working on something" — a bare string here read as frozen rather
              than as a brief, alive wait. */}
          <TypingIndicator size={6} />
          <Text style={styles.voicePrimingText}>Getting ready to listen…</Text>
        </View>
      ) : null}

      {mode === "listening" ? (
        <View style={styles.voicePanel} accessibilityLiveRegion="polite">
          <MicOrb
            status={voiceState.status}
            onPress={onStop}
            size={48}
            accessibilityLabel="Stop listening"
            accessibilityHint="Currently capturing what you say"
          />
          {voiceState.status === "processing" ? (
            <View style={styles.voiceCaptionRow}>
              <TypingIndicator size={6} />
            </View>
          ) : (
            <Text style={styles.voiceCaption} numberOfLines={3}>
              {voiceState.transcript.length > 0 ? voiceState.transcript : listeningPlaceholder}
            </Text>
          )}
          <Pressable
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel="Stop listening"
            style={({ pressed }) => [styles.stopPill, pressed && styles.stopPillPressed]}
          >
            <Text style={styles.stopPillText}>Stop listening</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === "blocked" ? (
        <View style={[styles.voiceNotice, styles.voiceNoticeBlocked]} accessibilityLiveRegion="polite">
          <Icon name="alert" size={18} color={colors.destructive} />
          <Text style={styles.voiceNoticeText}>
            {voiceState.message.length > 0 ? voiceState.message : "Couldn't start voice capture."}
          </Text>
          <View style={styles.voiceNoticeActions}>
            {voiceState.status === "permission-denied" ? (
              <Pressable
                onPress={onOpenSettings}
                accessibilityRole="button"
                accessibilityLabel="Open Settings to allow microphone access"
                style={({ pressed }) => [styles.voiceNoticeAction, pressed && styles.voiceNoticeActionPressed]}
              >
                <Text style={styles.voiceNoticeActionText}>Open Settings</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              style={({ pressed }) => [styles.voiceNoticeAction, pressed && styles.voiceNoticeActionPressed]}
            >
              <Text style={styles.voiceNoticeActionText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {mode === "soft-stopped" ? (
        <View style={styles.voiceNotice} accessibilityLiveRegion="polite">
          <Text style={styles.voiceNoticeText}>
            {notice ?? "Stopped listening — tap the mic to keep going, or just type."}
          </Text>
          <View style={styles.voiceNoticeActions}>
            <MicOrb status="idle" onPress={onResume} size={40} accessibilityLabel="Resume voice dictation" />
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              style={({ pressed }) => [styles.voiceNoticeAction, pressed && styles.voiceNoticeActionPressed]}
            >
              <Text style={styles.voiceNoticeActionText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* The manual entry point — the only path visible while inactive.
          A plain tap calls the same `onBegin` a deep link would; a HOLD adds
          release-to-stop and slide-up-to-lock (see HoldToRecordMic's header).
          ALWAYS mounted, collapsed rather than unmounted — see this file's
          header for why that is not optional. */}
      <View
        style={mode === "inactive" ? styles.voiceIdleRow : styles.voiceIdleRowHidden}
        accessibilityElementsHidden={mode !== "inactive"}
        importantForAccessibility={mode !== "inactive" ? "no-hide-descendants" : "auto"}
      >
        <HoldToRecordMic
          status={isDictating ? "listening" : "idle"}
          onHoldStart={onBegin}
          onCommit={onStop}
          onTogglePress={onBegin}
          size={40}
          accessibilityLabel={micAccessibilityLabel}
          accessibilityHint={micAccessibilityHint}
        />
        <Text style={styles.voiceIdleLabel}>{idleLabel}</Text>
      </View>
    </>
  );
}

// Shared chrome for the small status panels above, so the four states read as
// one family of "the mic wants your attention" surfaces rather than four
// slightly-different hand-rolled boxes. Individual entries still override
// colour where a state's meaning calls for it.
const VOICE_SURFACE = {
  marginHorizontal: spacing.lg,
  marginTop: spacing.sm,
  padding: spacing.md,
  borderRadius: radii.lg,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: colors.border,
  backgroundColor: colors.card,
  ...shadows.subtle,
} as const;

const styles = StyleSheet.create({
  voicePriming: {
    ...VOICE_SURFACE,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  voicePrimingText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    color: colors.mutedForeground,
  },
  // Brand-tinted invite, echoing the "brand-accented container" convention
  // documented in theme/foundation.ts rather than blending into the screen as
  // a plain unstyled row — this is the entry point into the feature.
  voiceIdleRow: {
    ...VOICE_SURFACE,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryMuted,
  },
  voiceIdleLabel: {
    flex: 1,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.primaryText,
  },
  // Same row, collapsed to nothing rather than unmounted. Zero height plus
  // clipped overflow makes it visually and spatially disappear without
  // touching whether the gesture recognizer inside it is still alive.
  voiceIdleRowHidden: {
    height: 0,
    minHeight: 0,
    overflow: "hidden",
    opacity: 0,
  },
  voicePanel: {
    ...VOICE_SURFACE,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  voiceCaption: {
    flex: 1,
    fontSize: typography.size.sm,
    lineHeight: 19,
    color: colors.foreground,
  },
  // Occupies the same flex:1 slot `voiceCaption` normally does, so swapping to
  // the dot wave during the `processing` beat doesn't shift the mic or the
  // Stop pill beside it.
  voiceCaptionRow: {
    flex: 1,
  },
  stopPill: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.destructive,
  },
  stopPillPressed: {
    opacity: 0.8,
  },
  stopPillText: {
    color: colors.destructiveForeground,
    fontWeight: typography.weight.semibold,
    fontSize: typography.size.xs,
  },
  voiceNotice: {
    ...VOICE_SURFACE,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  // "Blocked" (permission denied / unavailable) is a harder stop than
  // "soft-stopped" (just paused) — the destructive tint plus the alert icon
  // says so at a glance.
  voiceNoticeBlocked: {
    borderColor: colors.destructiveMuted,
    backgroundColor: colors.destructiveMuted,
  },
  voiceNoticeText: {
    flex: 1,
    fontSize: typography.size.xs,
    color: colors.mutedForeground,
  },
  voiceNoticeActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  voiceNoticeAction: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  voiceNoticeActionPressed: {
    opacity: 0.7,
  },
  voiceNoticeActionText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    color: colors.foreground,
    textDecorationLine: "underline",
  },
});
