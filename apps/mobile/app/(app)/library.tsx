// Library: browse curated community templates, mirroring goal-slot-web's
// `features/library/components/library-page.tsx`. Read-only list -> detail
// push, same "pushed, not tabbed" shape as Mentees (mentees.tsx +
// mentee/[id].tsx) rather than Notes' drag-reorderable tree — there is no
// reordering, nesting, or inline editing here, just a list card whose tap
// pushes into a rich detail screen (see library/[id].tsx).
//
// A template is a self-contained, curator-authored bundle
// (schedule/goals/tasks, each independently optional) that the API can
// materialize into the signed-in user's account — see
// packages/shared/src/types/template.ts and goal-slot-api's
// templates.service.ts. Nothing here writes anything; import only happens
// from the detail screen's own bottom sheet.
//
// Search is deliberately omitted for v1: the curated set is small (see
// goal-slot-api's APPROVED_TEMPLATES), so a category filter row is enough to
// narrow it, and web's own search box duplicates that same filtering on a
// short list. Add it back if the catalog grows past a screen or two.

import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { type TemplateCategory, type TemplateSummary } from "@goalslot/shared";

import { EmptyState, QueryErrorState, SkeletonListItem } from "@/components";
import { ListCard, MetaChip, ScreenHeader, StatusPill } from "@/components/lists";
import { HiddenTabBackButton, useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { hiddenTabBackDestination } from "@/lib/hidden-tab-routes";
import { Icon } from "@/components/ui/Icon";
import { useScreenView } from "@/hooks/useScreenView";
import { templateQueries } from "@/lib/queries";
import { colors, spacing, typography } from "@/theme/tokens";

type CategoryFilter = "all" | TemplateCategory;

/** Same five categories goal-slot-api's TemplateCategory union carries — see templates.data.ts. */
const CATEGORY_TABS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "schedule", label: "Schedule" },
  { id: "habits", label: "Habits" },
  { id: "goals", label: "Goals" },
  { id: "notes", label: "Notes" },
  { id: "journal", label: "Journal" },
];

const SKELETON_ROWS = 4;

export default function LibraryScreen() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [category, setCategory] = useState<CategoryFilter>("all");

  const templatesQuery = useQuery(templateQueries.list());

  useScreenView("library");

  // Drawer-only entry point (see DrawerContent's Workspace group), same
  // hidden-tab shape as Mentees — see that screen's identical note for why
  // Today, not router.back(), is the destination.
  useHiddenTabBackHandler(hiddenTabBackDestination("library"));

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);

  const featured = useMemo(
    () => (category === "all" ? templates.filter((t) => t.featured) : []),
    [templates, category],
  );

  const filtered = useMemo(() => {
    if (category === "all") return templates;
    return templates.filter((t) => t.categories.includes(category));
  }, [templates, category]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await templatesQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [templatesQuery]);

  const openTemplate = useCallback((id: string) => {
    router.push(`/library/${id}`);
  }, []);

  let body: React.ReactNode;

  if (templatesQuery.isPending) {
    body = (
      <View style={styles.listContent}>
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          <SkeletonListItem key={index} />
        ))}
      </View>
    );
  } else if (templatesQuery.isError && templates.length === 0) {
    body = (
      <QueryErrorState
        error={templatesQuery.error}
        message="Couldn't load the library."
        onRetry={() => void templatesQuery.refetch()}
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyState
        emphasis="hero"
        iconName="library"
        message={templates.length === 0 ? "Nothing in the library yet" : "No templates match"}
        description={
          templates.length === 0
            ? "Curated schedules, habit packs, and goal frameworks will show up here."
            : "Try a different category."
        }
      />
    );
  } else {
    body = (
      <FlatList
        data={filtered}
        keyExtractor={(template) => template.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.mutedForeground} />
        }
        ListHeaderComponent={
          featured.length > 0 ? (
            <View style={styles.featuredSection}>
              <View style={styles.featuredHeading}>
                <Icon name="sparkles" size={14} color={colors.primaryText} />
                <Text style={styles.featuredHeadingText}>Featured</Text>
              </View>
              {featured.map((template) => (
                <TemplateRow key={template.id} template={template} onPress={() => openTemplate(template.id)} />
              ))}
              <View style={styles.featuredDivider} />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <TemplateRow
            template={item}
            index={featured.length > 0 ? undefined : index}
            onPress={() => openTemplate(item.id)}
          />
        )}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <HiddenTabBackButton label="Today" destination="/" />
      <ScreenHeader
        title="Library"
        eyebrow="Community templates"
        subtitle="Hand-picked schedules, habit packs, and goal frameworks. Import only what you want."
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterRowContent}
        accessibilityRole="tablist"
      >
        {CATEGORY_TABS.map((tab) => {
          const selected = tab.id === category;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setCategory(tab.id)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              hitSlop={4}
            >
              <StatusPill label={tab.label} tone={selected ? "brand" : "muted"} showDot={false} />
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.body}>{body}</View>
    </SafeAreaView>
  );
}

function TemplateRow({
  template,
  index,
  onPress,
}: {
  template: TemplateSummary;
  index?: number;
  onPress: () => void;
}) {
  const counts: { icon: "schedule" | "goals" | "tasks"; label: string }[] = [];
  if (template.blockCount > 0) counts.push({ icon: "schedule", label: `${template.blockCount} blocks` });
  if (template.goalCount > 0) counts.push({ icon: "goals", label: `${template.goalCount} goals` });
  if (template.taskCount > 0) counts.push({ icon: "tasks", label: `${template.taskCount} tasks` });

  return (
    <ListCard index={index} onPress={onPress} style={styles.card} accessibilityLabel={template.name}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {template.name}
        </Text>
        {template.featured ? <Icon name="sparkles" size={16} color={colors.primaryText} /> : null}
      </View>
      <Text style={styles.cardDescription} numberOfLines={2}>
        {template.description}
      </Text>
      <Text style={styles.cardSource}>by {template.source}</Text>
      {counts.length > 0 ? (
        <View style={styles.metaRow}>
          {counts.map((c) => (
            <MetaChip key={c.icon} icon={c.icon} label={c.label} />
          ))}
        </View>
      ) : null}
    </ListCard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
  },
  filterRow: {
    flexGrow: 0,
    marginTop: spacing.sm,
  },
  filterRowContent: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  featuredSection: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  featuredHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  featuredHeadingText: {
    ...typography.label,
    fontWeight: "700",
    color: colors.primaryText,
  },
  featuredDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
  },
  card: {
    marginBottom: 0,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
    flex: 1,
  },
  cardDescription: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  cardSource: {
    ...typography.caption,
    color: colors.mutedForegroundLight,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
});
