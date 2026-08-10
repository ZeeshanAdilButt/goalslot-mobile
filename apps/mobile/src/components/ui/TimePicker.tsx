// A wheel-style time picker producing/consuming the app's canonical "HH:mm"
// (24h) string — the exact format ScheduleBlock.startTime/endTime and the
// shared `timeToMinutes`/`minutesToTime` helpers already use (see
// packages/shared/src/scheduling/time.ts), so callers never convert.
//
// WHY hand-built instead of @react-native-community/datetimepicker: that's a
// native module, which means adding it now would force every worktree in
// this session's build back through the Windows native rebuild — the exact
// MAX_PATH/JDK toolchain fight this session already burned hours on (see
// DECISIONS.md's build-fix notes and the .npmrc `node-linker=hoisted` fix).
// A pure-JS wheel needs nothing beyond ScrollView, which every screen using
// this already ships. Trading a native picker's platform chrome for zero
// rebuild risk is the right call here.
//
// Three synced wheel columns (hour 1-12, minute :00/:05/.../:55, AM/PM) is
// the iOS/Android-familiar shape users already expect from a time picker,
// rather than inventing a stepper UI nobody's seen before.

import { forwardRef, useCallback, useEffect, useMemo, useRef } from "react";
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { colors, radii, spacing, typography } from "@/theme";

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
// Padding rows above/below so the first/last real value can still center
// under the selection window.
const PAD_COUNT = Math.floor(VISIBLE_ITEMS / 2);

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12
const MINUTES_5 = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,...,55
const MERIDIEMS = ["AM", "PM"] as const;

export interface TimePickerProps {
  /** "HH:mm", 24h — same string ScheduleBlock.startTime/endTime store. */
  value: string;
  onChange: (time: string) => void;
}

export function parseValue(value: string): { hour12: number; minuteIndex: number; meridiem: "AM" | "PM" } {
  const [hStr, mStr] = value.split(":");
  const h24Raw = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  // Snap to the nearest 5-minute stop so a value produced elsewhere (e.g. an
  // exact "09:37" from an API) still lands on a real wheel row instead of
  // silently rounding down without visual confirmation. `Math.round(58/5)`
  // is 12, which is a whole hour, not a valid MINUTES_5 index — that must
  // roll into the next hour rather than wrapping back to :00 of the SAME
  // hour (e.g. "09:58" is much closer to 10:00 than to 9:00; silently
  // showing "9:00" would be wrong by nearly an hour). `% 24` at the end
  // handles the wheel's own boundary, "23:58" rolling to "00:00".
  const roundedMinuteSteps = Math.round(m / 5);
  const minuteIndex = roundedMinuteSteps % 12;
  const h24 = (h24Raw + Math.floor(roundedMinuteSteps / 12)) % 24;
  const meridiem: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour12, minuteIndex, meridiem };
}

export function toTimeString(hour12: number, minuteIndex: number, meridiem: "AM" | "PM"): string {
  let h24 = hour12 % 12;
  if (meridiem === "PM") h24 += 12;
  const mins = MINUTES_5[minuteIndex] ?? 0;
  return `${h24.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

export function TimePicker({ value, onChange }: TimePickerProps) {
  const { hour12, minuteIndex, meridiem } = useMemo(() => parseValue(value), [value]);

  const hourRef = useRef<ScrollView>(null);
  const minuteRef = useRef<ScrollView>(null);
  const meridiemRef = useRef<ScrollView>(null);

  // Scroll each wheel to match the derived position — on mount, and whenever
  // `value` changes for any reason (a parent resetting the form, or the
  // user's own scroll: `emit` below calls `onChange` only after momentum
  // ends, so by the time this effect re-runs from that the wheel is already
  // sitting at the target offset and the resulting scrollTo is a no-op, not
  // a visible re-snap). scrollTo, not a controlled `contentOffset`, since
  // ScrollView doesn't support the latter for scroll position the way a
  // controlled <input> would.
  useEffect(() => {
    hourRef.current?.scrollTo({ y: (hour12 - 1) * ITEM_HEIGHT, animated: false });
    minuteRef.current?.scrollTo({ y: minuteIndex * ITEM_HEIGHT, animated: false });
    meridiemRef.current?.scrollTo({ y: (meridiem === "AM" ? 0 : 1) * ITEM_HEIGHT, animated: false });
  }, [hour12, minuteIndex, meridiem]);

  const emit = useCallback(
    (next: { hour12?: number; minuteIndex?: number; meridiem?: "AM" | "PM" }) => {
      const time = toTimeString(
        next.hour12 ?? hour12,
        next.minuteIndex ?? minuteIndex,
        next.meridiem ?? meridiem,
      );
      void Haptics.selectionAsync();
      onChange(time);
    },
    [hour12, minuteIndex, meridiem, onChange],
  );

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.selectionWindow} />
      <Wheel
        ref={hourRef}
        items={HOURS_12.map(String)}
        selectedIndex={hour12 - 1}
        onSettle={(i) => emit({ hour12: HOURS_12[i] })}
      />
      <Text style={styles.separator}>:</Text>
      <Wheel
        ref={minuteRef}
        items={MINUTES_5.map((m) => m.toString().padStart(2, "0"))}
        selectedIndex={minuteIndex}
        onSettle={(i) => emit({ minuteIndex: i })}
      />
      <Wheel
        ref={meridiemRef}
        items={[...MERIDIEMS]}
        selectedIndex={meridiem === "AM" ? 0 : 1}
        onSettle={(i) => emit({ meridiem: MERIDIEMS[i] })}
        narrow
      />
    </View>
  );
}

interface WheelProps {
  items: string[];
  selectedIndex: number;
  onSettle: (index: number) => void;
  narrow?: boolean;
}

// forwardRef so the parent can imperatively re-sync scroll position without
// this wheel needing to know why (external value change vs internal drag).
const Wheel = forwardRef<ScrollView, WheelProps>(function Wheel({ items, selectedIndex, onSettle, narrow }, ref) {
  const padded = useMemo(() => {
    const blank = Array.from({ length: PAD_COUNT }, () => "");
    return [...blank, ...items, ...blank];
  }, [items]);

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      onSettle(clamped);
    },
    [items.length, onSettle],
  );

  return (
    <ScrollView
      ref={ref}
      style={[styles.wheel, narrow && styles.wheelNarrow]}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      onMomentumScrollEnd={handleMomentumEnd}
      // Android doesn't always fire onMomentumScrollEnd for a slow drag that
      // stops without any fling — onScrollEndDrag covers that case too.
      onScrollEndDrag={handleMomentumEnd}
    >
      {padded.map((label, i) => {
        const itemIndex = i - PAD_COUNT;
        const isSelected = itemIndex === selectedIndex;
        return (
          <View key={i} style={styles.item}>
            <Text style={[styles.itemText, isSelected && styles.itemTextSelected]}>{label}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    height: WHEEL_HEIGHT,
  },
  selectionWindow: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    top: PAD_COUNT * ITEM_HEIGHT,
    height: ITEM_HEIGHT,
    borderRadius: radii.control,
    backgroundColor: colors.muted,
  },
  wheel: {
    width: 64,
    height: WHEEL_HEIGHT,
  },
  wheelNarrow: {
    width: 52,
  },
  item: {
    height: ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  itemText: {
    fontSize: typography.size.lg,
    color: colors.mutedForeground,
  },
  itemTextSelected: {
    color: colors.foreground,
    fontWeight: typography.weight.bold,
  },
  separator: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.foreground,
    marginHorizontal: spacing.xs,
  },
});
