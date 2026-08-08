// Self-contained slide-out navigation drawer, rendered as an overlay on top
// of the existing <Tabs> navigator in app/(app)/_layout.tsx (see that file
// for how it's mounted and opened).
//
// Why this instead of expo-router's built-in `Drawer` (from
// "expo-router/drawer"): that's a real file-based navigator, but nesting it
// around the tab bar the standard way requires moving the five tab screens
// (app/(app)/index.tsx, schedule.tsx, goals.tsx, tasks.tsx, timer.tsx) into a
// new `(tabs)/` route-group directory — route groups don't change the URL,
// so deep links would survive, but it's still a file move on every one of
// those five files. Three of them (schedule.tsx, goals.tsx, tasks.tsx) are
// being actively edited by other agents on sibling worktree branches right
// now, and a rename on this branch racing an edit on theirs is exactly the
// kind of collision this task's "don't touch screen files" constraint exists
// to prevent. Building the drawer as an overlay sidesteps that entirely: it
// only touches app/(app)/_layout.tsx and files under this directory, the
// <Tabs> navigator is untouched, and every link below is a normal
// `router.push` to an existing route, so nothing about how screens are
// reached changes.
//
// Mechanically this is a translateX panel (react-native-reanimated) plus a
// fade-in backdrop, both driven off the `open` prop. A short pan gesture
// (react-native-gesture-handler — already wrapped at the app root in
// app/_layout.tsx via GestureHandlerRootView, so no extra setup needed here)
// lets the panel be swiped closed; tapping the backdrop or the ✕ in
// DrawerContent do the same via `onClose`. No new dependency was needed for
// any of this — both libraries were already installed.

import { useEffect } from "react";
import { Pressable, StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { colors, shadows } from "@/theme/tokens";
import { DrawerContent, type DrawerContentProps } from "./DrawerContent";

const ANIMATION_MS = 220;
// Fraction of the drawer's width a swipe has to cross (or a fast-enough
// flick, checked via velocity below) before it counts as "close" rather than
// snapping back open.
const CLOSE_DRAG_RATIO = 0.33;
const CLOSE_FLICK_VELOCITY = 800;
const MAX_DRAWER_WIDTH = 320;
const DRAWER_WIDTH_RATIO = 0.84;

export interface AppDrawerProps extends Omit<DrawerContentProps, "onRequestClose"> {
  open: boolean;
  onClose: () => void;
}

export function AppDrawer({ open, onClose, pathname, onNavigate }: AppDrawerProps) {
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = Math.min(MAX_DRAWER_WIDTH, windowWidth * DRAWER_WIDTH_RATIO);

  const translateX = useSharedValue(-drawerWidth);

  // Drives the open/close animation from React state. Swipe-driven closes
  // (below) update `translateX` directly and then call `onClose`, which
  // flips `open` to false — at that point this effect re-runs but the value
  // is already at `-drawerWidth`, so `withTiming` is a no-op distance-wise.
  useEffect(() => {
    translateX.value = withTiming(open ? 0 : -drawerWidth, { duration: ANIMATION_MS });
  }, [open, drawerWidth, translateX]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-drawerWidth, 0], [0, 1], Extrapolation.CLAMP),
  }));

  const pan = Gesture.Pan()
    // Only claims the gesture once the drag is clearly horizontal, so a
    // vertical swipe (scrolling the nav list) isn't hijacked into a
    // drawer-close.
    .activeOffsetX([-10, 10])
    .onChange((event) => {
      translateX.value = Math.min(0, Math.max(-drawerWidth, translateX.value + event.changeX));
    })
    .onEnd((event) => {
      const shouldClose =
        translateX.value < -drawerWidth * CLOSE_DRAG_RATIO || event.velocityX < -CLOSE_FLICK_VELOCITY;
      translateX.value = withTiming(shouldClose ? -drawerWidth : 0, { duration: ANIMATION_MS }, (finished) => {
        "worklet";
        if (finished && shouldClose) {
          runOnJS(onClose)();
        }
      });
    });

  return (
    <>
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[styles.backdrop, backdropStyle]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close navigation menu"
        />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          pointerEvents={open ? "auto" : "none"}
          style={[styles.panel, { width: drawerWidth }, panelStyle]}
        >
          <DrawerContent pathname={pathname} onNavigate={onNavigate} onRequestClose={onClose} />
        </Animated.View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.card,
    ...shadows.fab,
  },
});
