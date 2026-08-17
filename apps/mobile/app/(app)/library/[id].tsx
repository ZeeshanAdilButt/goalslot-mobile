// Template detail: one level down from the Library list, mirroring
// goal-slot-web's `features/library/components/template-detail-page.tsx`.
// Full preview (long description, goals grid, weekly schedule, starter tasks
// grouped by goal) plus two actions — Import (opens ImportTemplateSheet) and
// Sync, a separate tasks-only re-sync for a template the user already
// imported (see goal-slot-api's templates.service.ts syncTasks). This is
// deliberately a SECOND screen, not a modal over the list: web's own split
// (LibraryPage -> TemplateDetailPage -> ImportDialog) is preview-then-import
// with a real detail step in between, never one-tap.
//
// Routed as a hidden Tabs.Screen (see app/(app)/_layout.tsx) with the tab bar
// hidden while focused — same "pushed, not tabbed" shape as mentee/[id].tsx,
// whose header this one is structurally closest to (a custom back-chevron
// header rather than ScreenHeader, since this screen needs an in-app back
// target that Library, not Today, owns).

import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

import { type TemplateGoal, type TemplateScheduleBlock, type TemplateTask } from "@goalslot/shared";

import { LoadingState, QueryErrorState } from "@/components";
import { FormattedText } from "@/components/ui/FormattedText";
import { Icon } from "@/components/ui/Icon";
import { StatusPill, MetaChip } from "@/components/lists";
import { ImportTemplateSheet } from "@/components/library/ImportTemplateSheet";
import { useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { hiddenTabBackDestination } from "@/lib/hidden-tab-routes";
import { Button } from "@/components/ui/Button";
import { useScreenView } from "@/hooks/useScreenView";
import { apiClient, notify } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { taskQueries, templateQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, iconSize, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

const CATEGORY_LABEL: Record<string, string> = {
  schedule: "Schedule",
  habits: "Habits",
  goals: "Goals",
  notes: "Notes",
  journal: "Journal",
};

const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Week starts Monday for display, same order web's detail page renders in. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Same grouping web's template-detail-page.tsx does: tasks bucketed by the goal they point at, unresolved ones last. */
function groupTasksByGoal(
  goals: TemplateGoal[],
  tasks: TemplateTask[],
): { goal: TemplateGoal | null; tasks: TemplateTask[] }[] {
  const byRef = new Map<string, TemplateTask[]>();
  const unlinked: TemplateTask[] = [];
  for (const task of tasks) {
    if (task.goalRef && goals.some((g) => g.ref === task.goalRef)) {
      const arr = byRef.get(task.goalRef) ?? [];
      arr.push(task);
      byRef.set(task.goalRef, arr);
    } else {
      unlinked.push(task);
    }
  }
  const out: { goal: TemplateGoal | null; tasks: TemplateTask[] }[] = [];
  for (const goal of goals) {
    const arr = byRef.get(goal.ref);
    if (arr && arr.length > 0) out.push({ goal, tasks: arr });
  }
  if (unlinked.length > 0) out.push({ goal: null, tasks: unlinked });
  return out;
}

function blocksByDay(schedule: TemplateScheduleBlock[]): Map<number, TemplateScheduleBlock[]> {
  const map = new Map<number, TemplateScheduleBlock[]>();
  for (const block of schedule) {
    const arr = map.get(block.dayOfWeek) ?? [];
    arr.push(block);
    map.set(block.dayOfWeek, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return map;
}

export default function TemplateDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const templateId = typeof params.id === "string" ? params.id : "";

  const [syncing, setSyncing] = useState(false);
  const importSheetRef = useRef<BottomSheetModal>(null);

  useScreenView("library-detail");

  // Detail routes never fall back to Today — Library is the only way in.
  useHiddenTabBackHandler(hiddenTabBackDestination("library/[id]"));

  const templateQuery = useQuery({ ...templateQueries.detail(templateId), enabled: templateId.length > 0 });

  const template = templateQuery.data;
  const byDay = useMemo(() => blocksByDay(template?.schedule ?? []), [template]);
  const taskGroups = useMemo(
    () => groupTasksByGoal(template?.goals ?? [], template?.tasks ?? []),
    [template],
  );

  const handleSync = useCallback(async () => {
    if (!template || syncing) return;
    setSyncing(true);
    try {
      const response = await apiClient.templates.sync(template.id);
      if (!response.data.matched) {
        notify("Import this template first — sync is for templates you've already imported.", "error");
        return;
      }
      if (response.data.tasksAdded === 0) {
        notify("Already up to date. No new tasks.", "success");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
      const noun = response.data.tasksAdded === 1 ? "task" : "tasks";
      const skippedNote = response.data.skipped > 0 ? `, skipped ${response.data.skipped}` : "";
      notify(`Added ${response.data.tasksAdded} new ${noun}${skippedNote}`, "success");
    } catch (err) {
      notify(getErrorMessage(err, "Sync failed. Try again."), "error");
    } finally {
      setSyncing(false);
    }
  }, [template, syncing]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.replace("/library")}
          hitSlop={12}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to Library"
        >
          <Icon name="chevron-left" size={iconSize.lg} color={colors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
          {template?.name ?? "Template"}
        </Text>
      </View>

      {templateQuery.isPending ? (
        <LoadingState fullScreen message="Loading template..." />
      ) : templateQuery.isError || !template ? (
        <QueryErrorState
          error={templateQuery.error}
          message="Couldn't load this template."
          onRetry={() => void templateQuery.refetch()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.badgeRow}>
            {template.featured ? (
              <View style={styles.featuredBadge}>
                <Icon name="sparkles" size={12} color={colors.foreground} />
                <Text style={styles.featuredBadgeText}>Featured</Text>
              </View>
            ) : null}
            {template.categories.map((category) => (
              <StatusPill key={category} label={CATEGORY_LABEL[category] ?? category} tone="muted" showDot={false} />
            ))}
          </View>

          <Text style={styles.sourceLine}>by {template.source}</Text>
          <Text style={styles.description}>{template.description}</Text>

          <View style={styles.actionsRow}>
            <Button
              label="Import to my account"
              variant="brand"
              onPress={() => importSheetRef.current?.present()}
              style={styles.actionButton}
            />
            <Button
              label="Sync"
              icon="refresh"
              variant="secondary"
              loading={syncing}
              onPress={() => void handleSync()}
              accessibilityLabel={`Sync from ${template.source}`}
              style={styles.actionButton}
            />
          </View>

          <View style={styles.countsRow}>
            <MetaChip icon="schedule" label={`${template.schedule?.length ?? 0} blocks`} />
            <MetaChip icon="goals" label={`${template.goals?.length ?? 0} goals`} />
            <MetaChip icon="tasks" label={`${template.tasks?.length ?? 0} tasks`} />
          </View>

          {template.longDescription ? (
            <Section title="About this template">
              <FormattedText text={template.longDescription} style={styles.longDescriptionText} />
            </Section>
          ) : null}

          {template.goals && template.goals.length > 0 ? (
            <Section title="Goals you would get">
              <View style={styles.goalsGrid}>
                {template.goals.map((goal) => (
                  <View key={goal.ref} style={styles.goalCard}>
                    <View style={styles.goalCardHeader}>
                      <View style={[styles.goalDot, { backgroundColor: goal.color }]} />
                      <Text style={styles.goalTitle} numberOfLines={1}>
                        {goal.title}
                      </Text>
                    </View>
                    {goal.description ? (
                      <Text style={styles.goalDescription} numberOfLines={3}>
                        {goal.description}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {template.schedule && template.schedule.length > 0 ? (
            <Section title="Weekly schedule preview">
              {DAY_ORDER.map((day) => {
                const items = byDay.get(day) ?? [];
                if (items.length === 0) return null;
                return (
                  <View key={day} style={styles.dayCard}>
                    <Text style={styles.dayCardTitle}>{DAY_NAME[day]}</Text>
                    {items.map((block, index) => {
                      const goal = template.goals?.find((g) => g.ref === block.goalRef);
                      return (
                        <View key={`${block.startTime}-${index}`} style={styles.blockRow}>
                          <Text style={styles.blockTime}>{block.startTime}</Text>
                          <Text style={styles.blockTitle} numberOfLines={1}>
                            {block.title}
                          </Text>
                          {goal ? <View style={[styles.blockDot, { backgroundColor: goal.color }]} /> : null}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </Section>
          ) : null}

          {template.tasks && template.tasks.length > 0 ? (
            <Section title="Starter tasks">
              {taskGroups.map(({ goal, tasks }) => (
                <View key={goal?.ref ?? "unlinked"} style={styles.taskGroup}>
                  <View style={styles.taskGroupHeader}>
                    {goal ? (
                      <>
                        <View style={[styles.goalDot, { backgroundColor: goal.color }]} />
                        <Text style={styles.taskGroupTitle}>{goal.title}</Text>
                      </>
                    ) : (
                      <Text style={styles.taskGroupTitleMuted}>Unlinked</Text>
                    )}
                    <Text style={styles.taskGroupCount}>
                      {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
                    </Text>
                  </View>
                  {tasks.map((task, index) => (
                    <View key={`${task.title}-${index}`} style={styles.taskRow}>
                      <Icon name="check" size={14} color={colors.mutedForeground} />
                      <View style={styles.taskBody}>
                        <Text style={styles.taskTitle}>{task.title}</Text>
                        {task.description ? (
                          <Text style={styles.taskDescription}>{task.description}</Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </Section>
          ) : null}

          <ImportTemplateSheet ref={importSheetRef} template={template} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    marginLeft: -spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...typography.title,
    flex: 1,
    color: colors.foreground,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  featuredBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  featuredBadgeText: {
    ...typography.label,
    fontWeight: "700",
    color: colors.foreground,
  },
  sourceLine: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  description: {
    ...typography.body,
    color: colors.foreground,
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionButton: {
    flex: 1,
  },
  countsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  section: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    fontWeight: "700",
    color: colors.mutedForeground,
  },
  longDescriptionText: {
    ...typography.bodySmall,
    color: colors.foreground,
  },
  goalsGrid: {
    gap: spacing.sm,
  },
  goalCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  goalCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  goalDot: {
    width: 14,
    height: 14,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: colors.border,
  },
  goalTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
    flex: 1,
  },
  goalDescription: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  dayCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  dayCardTitle: {
    ...typography.label,
    fontWeight: "700",
    color: colors.mutedForeground,
  },
  blockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  blockTime: {
    ...typography.caption,
    fontVariant: ["tabular-nums"],
    color: colors.mutedForeground,
    width: 48,
  },
  blockTitle: {
    ...typography.bodySmall,
    color: colors.foreground,
    flex: 1,
  },
  blockDot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
  },
  taskGroup: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  taskGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.secondary,
  },
  taskGroupTitle: {
    ...typography.label,
    fontWeight: "700",
    color: colors.foreground,
    flex: 1,
  },
  taskGroupTitleMuted: {
    ...typography.label,
    fontWeight: "700",
    color: colors.mutedForeground,
    flex: 1,
  },
  taskGroupCount: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  taskBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  taskTitle: {
    ...typography.bodySmall,
    color: colors.foreground,
  },
  taskDescription: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
});
