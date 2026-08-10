// The screen state the user sees most often before they have any data, so
// it carries more of the app's first impression than any populated screen
// does. Web's version (dw-time-web/src/components/ui/empty-state.tsx) is a
// 48px circle, a 16px title and a 14px line, centred in a `py-12` block —
// which works in a dashboard column that already has a sidebar, a header and
// neighbouring cards around it. Dropped into a full phone viewport with
// nothing else on screen, that same composition is a small grey dot floating
// in a void, which is exactly the feedback this component exists to answer.
//
// So the parts are web's (icon container -> title -> description -> action,
// same order, same roles), scaled and staged for a screen where this is the
// ONLY thing rendered:
//   - the icon container becomes artwork: an `xl` IconBadge on a drawn
//     backdrop of concentric rings and brand-yellow specks, so the centre of
//     the screen has structure instead of emptiness;
//   - the title steps from web's 16px to the `headline` role (20px), the
//     size at which a centred line reads as a heading on a phone;
//   - the action slot takes the real Button primitive, so a CTA here is the
//     same object as a CTA anywhere else in the app.
//
// Restraint on colour is deliberate: the rings are border-grey and only the
// specks and (optionally) the badge carry yellow. The composition is carried
// by structure and type, not by flooding the screen with the brand colour.

import type { ReactNode } from "react";
import { useEffect } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { Button, type ButtonVariant } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/Icon";
import { IconBadge, type IconBadgeTone } from "@/components/ui/IconBadge";
import { colors, motion, spacing, typography } from "@/theme/tokens";

export interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
  /**
   * Optional supporting copy shown under `message` in a smaller, muted
   * style — mirrors dw-time-web's EmptyState `title` + `description` split.
   * `message` alone already reads as a clear headline for every existing
   * caller, so this is opt-in rather than required.
   */
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Named icon for the illustration, e.g. `"tasks"` on an empty task list.
   * Prefer this over `icon` — it renders at the right size, in the right
   * colour for `tone`, with no work at the call site. `icon` still wins if
   * both are passed, so existing callers are unaffected.
   */
  iconName?: IconName;
  /** Illustration colour family. Neutral by default; `brand` for an inviting "create your first X". */
  tone?: IconBadgeTone;
  /** Icon for the primary action button (e.g. `"add"`). */
  actionIcon?: IconName;
  /** Defaults to `brand` — an empty state's CTA is the one thing on screen worth pressing. */
  actionVariant?: ButtonVariant;
  /** Optional lower-emphasis second action, rendered as a ghost button under the primary one. */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** Drops the drawn backdrop and tightens the padding — for an empty state inside a card or a section, not a whole screen. */
  compact?: boolean;
  /** `hero` enlarges the illustration for a screen whose whole body is this state. Ignored when `compact`. */
  emphasis?: "default" | "hero";
  style?: StyleProp<ViewStyle>;
  /** Anything extra below the actions (a hint, a link row). */
  footer?: ReactNode;
}

// Two stage sizes rather than one. The default has to work where this
// component is ALREADY used most often — inside a section of the Today
// screen, which renders three empty states stacked on one page — so a
// 200px composition repeated three times would be the opposite of the fix.
// `hero` is the full-screen version for a screen whose entire body is the
// empty state.
const STAGE_SIZE = { default: 140, hero: 200 } as const;

/**
 * Concentric rings + specks drawn behind the icon. Pure decoration, hidden
 * from assistive tech. The dashed outer ring reads as "space reserved for
 * something that isn't here yet", which is the message of the whole state.
 * Radii are expressed as fractions of the stage so both sizes stay in
 * proportion instead of needing two hand-tuned sets of numbers.
 */
function Backdrop({ size }: { size: number }) {
  const center = size / 2;
  return (
    <Svg width={size} height={size} style={styles.backdrop} pointerEvents="none">
      <Circle
        cx={center}
        cy={center}
        r={size * 0.47}
        stroke={colors.border}
        strokeWidth={1}
        strokeDasharray="3 7"
        fill="none"
      />
      <Circle cx={center} cy={center} r={size * 0.34} stroke={colors.border} strokeWidth={1} fill="none" />
      <Circle cx={center} cy={center} r={size * 0.22} fill={colors.secondary} opacity={0.55} />
      {/* Specks: the only yellow in the composition, and small enough to read
          as sparkle rather than as a second focal point. */}
      <Circle cx={center + size * 0.36} cy={center - size * 0.2} r={3.5} fill={colors.primary} />
      <Circle cx={center - size * 0.39} cy={center + size * 0.13} r={2.5} fill={colors.primary} opacity={0.7} />
      <Circle cx={center + size * 0.17} cy={center + size * 0.41} r={2} fill={colors.primary} opacity={0.5} />
    </Svg>
  );
}

export function EmptyState({
  message,
  icon,
  description,
  actionLabel,
  onAction,
  iconName,
  tone = "neutral",
  actionIcon,
  actionVariant = "brand",
  secondaryActionLabel,
  onSecondaryAction,
  compact = false,
  emphasis = "default",
  style,
  footer,
}: EmptyStateProps) {
  const stageSize = STAGE_SIZE[emphasis];
  // Rise-and-fade on mount. Written by hand rather than with Reanimated's
  // `entering=` layout animations because those are silently inert if the
  // Babel plugin's layout-animation support isn't enabled for a build, and a
  // state that renders at opacity 0 is a much worse failure than one that
  // renders without a flourish.
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withTiming(1, { duration: motion.duration.slow, easing: Easing.out(Easing.cubic) });
  }, [enter]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 12 }],
  }));

  const hasPrimaryAction = Boolean(actionLabel && onAction);
  const hasSecondaryAction = Boolean(secondaryActionLabel && onSecondaryAction);

  return (
    <Animated.View style={[styles.container, compact && styles.containerCompact, enterStyle, style]}>
      <View
        style={[
          styles.illustration,
          compact ? styles.illustrationCompact : { width: stageSize, height: stageSize },
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {compact ? null : <Backdrop size={stageSize} />}
        <IconBadge
          tone={tone}
          size={compact ? "lg" : "xl"}
          // The default glyph is an inbox rather than the GoalSlot mark: the
          // logo says "this is GoalSlot", which the user already knows, where
          // an inbox says "this list is empty", which is the actual message.
          name={icon ? undefined : (iconName ?? "inbox")}
        >
          {icon}
        </IconBadge>
      </View>

      <View style={styles.copy}>
        <Text style={styles.message}>{message}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>

      {hasPrimaryAction || hasSecondaryAction ? (
        <View style={styles.actions}>
          {hasPrimaryAction ? (
            <Button
              label={actionLabel as string}
              onPress={onAction}
              variant={actionVariant}
              icon={actionIcon}
              accessibilityLabel={actionLabel}
            />
          ) : null}
          {hasSecondaryAction ? (
            <Button
              label={secondaryActionLabel as string}
              onPress={onSecondaryAction}
              variant="ghost"
              size="sm"
              accessibilityLabel={secondaryActionLabel}
            />
          ) : null}
        </View>
      ) : null}

      {footer}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xxl,
  },
  containerCompact: {
    paddingVertical: spacing.xl,
  },
  illustration: {
    alignItems: "center",
    justifyContent: "center",
  },
  illustrationCompact: {
    marginBottom: spacing.lg,
  },
  backdrop: {
    position: "absolute",
  },
  copy: {
    alignItems: "center",
    gap: spacing.sm,
    // Caps the measure at roughly 45 characters — past that, centred copy
    // gets hard to track back to the start of the next line.
    maxWidth: 320,
    marginTop: spacing.sm,
  },
  message: {
    ...typography.headline,
    color: colors.foreground,
    textAlign: "center",
  },
  description: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
  },
  actions: {
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
});
