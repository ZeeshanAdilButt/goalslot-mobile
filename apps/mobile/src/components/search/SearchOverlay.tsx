// The "go anywhere" search — the top search button (mounted in
// app/(app)/_layout.tsx, stacked directly under the floating hamburger)
// converts into this full search bar when tapped, rather than pushing a new
// screen. See search-index.ts for what's indexed and its matching rules.
//
// SCOPE, FIRST PASS: navigates to screens/sections only (Settings, Reports,
// Coach AI, every drawer destination) — not a specific goal, task or note by
// name. Real content search would mean querying live user data instead of a
// fixed list, which is a bigger, separate piece of work; this pass covers
// exactly what the feature request named explicitly ("setting reports ai
// coach other settings everything"), and content search is deferred, not
// silently dropped.
//
// DELIBERATELY NOT a React Native <Modal>. A Modal renders in its own native
// window/layer, above every plain view in the tree — including
// <ConnectivityPill/> (mounted in the root app/_layout.tsx, after <Slot/>,
// specifically so it always wins the paint order — see
// tracking-banner-store.ts's header) and <GlobalTrackingBanner/>'s
// tap-through-to-Timer pill. A Modal search overlay would silently sit on
// top of both, hiding the exact two things the feature request calls out by
// name ("doesn't hide things like top pop up when we are offline or when
// timer is working"). Built as a plain absolutely-positioned overlay instead
// — the same non-Modal pattern AppDrawer.tsx already uses for the same
// reason — and mounted in _layout.tsx BEFORE <GlobalTrackingBanner/> and the
// hamburger row, so both keep painting on top of this by plain mount order,
// the same mechanism that already keeps the drawer from covering them.
//
// The search bar's own top edge additionally clears below both the
// hamburger/search-button cluster AND the tracking banner's *measured*
// height (via useTrackingBannerHeight, the same store <ConnectivityPill/>
// reads) — belt-and-braces so the bar's own content never renders directly
// under either, not just "technically not hiding it".

import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { Icon } from "@/components/ui/Icon";
import { useTrackingBannerHeight } from "@/lib/tracking-banner-store";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";
import { filterSearchItems, getSearchItems, type SearchHref, type SearchItem } from "./search-index";

/** Hamburger row's own footprint: marginTop spacing.sm + 40pt button — mirrors _layout.tsx's hamburgerButton. */
const HAMBURGER_ROW_HEIGHT = spacing.sm + 40;
/** Search trigger row directly below it — see _layout.tsx's searchTriggerButton. */
const TRIGGER_ROW_HEIGHT = spacing.sm + 40;
const BUTTON_CLUSTER_HEIGHT = HAMBURGER_ROW_HEIGHT + TRIGGER_ROW_HEIGHT;

export interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (href: SearchHref) => void;
}

export function SearchOverlay({ open, onClose, onNavigate }: SearchOverlayProps) {
  const insets = useSafeAreaInsets();
  const trackingBannerHeight = useTrackingBannerHeight((state) => state.height);
  const [query, setQuery] = useState("");
  const inputRef = useRef<TextInput>(null);

  // Focuses on the OPENING edge only (mirrors TrackingPicker's
  // wasVisibleRef), so re-renders while already open don't keep stealing
  // focus back from a result row a screen reader user has moved to.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (justOpened) {
      // Same reasoning as TrackingPicker's slide-in Modal: focusing before
      // the mount/animation settles can be a no-op on Android.
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  const items = useMemo(() => getSearchItems(), []);
  const results = useMemo(() => filterSearchItems(items, query), [items, query]);
  const searching = query.trim().length > 0;

  // Grouped browse view when there's no query — same section order as
  // DrawerContent's NAV_GROUPS, so this reads as the same app the drawer
  // shows rather than a second, differently-organized index of it.
  const groups = useMemo(() => {
    if (searching) return null;
    const ordered: { label: string | null; rows: SearchItem[] }[] = [];
    for (const item of results) {
      const label = item.group ?? null;
      const last = ordered[ordered.length - 1];
      if (last && last.label === label) {
        last.rows.push(item);
      } else {
        ordered.push({ label, rows: [item] });
      }
    }
    return ordered;
  }, [results, searching]);

  const clearSearch = () => setQuery("");

  const handleClose = () => {
    clearSearch();
    onClose();
  };

  const handleSelect = (href: SearchHref) => {
    onNavigate(href);
    handleClose();
  };

  if (!open) return null;

  const barTop =
    insets.top +
    Math.max(BUTTON_CLUSTER_HEIGHT, trackingBannerHeight > 0 ? trackingBannerHeight + spacing.sm : 0) +
    spacing.sm;

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(120)}
      style={StyleSheet.absoluteFill}
    >
      <Pressable
        style={styles.backdrop}
        onPress={handleClose}
        accessibilityRole="button"
        accessibilityLabel="Close search"
      />
      <SafeAreaView style={styles.fill} edges={["left", "right", "bottom"]} pointerEvents="box-none">
        <View style={[styles.searchBarWrap, { marginTop: barTop }]}>
          <View style={styles.searchRow}>
            <Icon name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search settings, reports, coach…"
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search the app"
              accessibilityHint="Searches every screen and section, including Settings sub-sections"
            />
            {searching ? (
              <Pressable
                onPress={clearSearch}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={spacing.md}
              >
                <Icon name="close" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel search"
            hitSlop={spacing.sm}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.results}
          contentContainerStyle={styles.resultsContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {results.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Nothing matches “{query.trim()}”</Text>
              <Text style={styles.emptyBody}>
                Search covers every screen and settings section — try a shorter word.
              </Text>
            </View>
          ) : searching ? (
            results.map((item) => <ResultRow key={item.id} item={item} onPress={() => handleSelect(item.href)} />)
          ) : (
            groups?.map((group, index) => (
              <View key={group.label ?? `group-${index}`}>
                {group.label ? <Text style={styles.sectionLabel}>{group.label}</Text> : null}
                {group.rows.map((item) => (
                  <ResultRow key={item.id} item={item} onPress={() => handleSelect(item.href)} />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  );
}

function ResultRow({ item, onPress }: { item: SearchItem; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.label}. ${item.description}`}
    >
      <View style={styles.rowIcon}>
        <Icon name={item.icon} size={18} color={colors.foreground} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.label}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {item.description}
        </Text>
      </View>
      <Icon name="chevron" size={16} color={colors.mutedForegroundLight} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
  },
  searchBarWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  searchRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    ...shadows.subtle,
  },
  searchInput: {
    flex: 1,
    // 16pt keeps iOS from zooming the field on focus — matches TrackingPicker's searchInput.
    fontSize: 16,
    color: colors.foreground,
    paddingVertical: spacing.sm,
  },
  cancelButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
  },
  cancelText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.primaryDark,
  },
  results: {
    flex: 1,
  },
  resultsContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.mutedForeground,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  emptyState: {
    gap: spacing.sm,
    paddingTop: spacing.xxl,
  },
  emptyTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  emptyBody: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: minTouchTarget + spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  rowPressed: {
    backgroundColor: colors.secondary,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowSubtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
});
