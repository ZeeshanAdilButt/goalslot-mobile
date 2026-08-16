// Mentee-facing instructions list: what a mentor has assigned to the
// signed-in user, and the mark-complete action.
//
// This screen did not exist before. `GET /instructions/assigned-to-me` and
// `PATCH /instructions/:id/complete` were already live on the backend and
// already wired up client-side (packages/shared/src/api/instructions.ts,
// src/lib/queries.ts's `instructionsQueries.assignedToMe()`) — but nothing in
// the mobile app ever called them from the mentee's side. The only existing
// "Instructions" UI (components/mentees/AssignInstructionSheet.tsx,
// app/(app)/mentee/[id].tsx) is the MENTOR's view of what they assigned.
// There was nowhere for a mentee to read or complete an instruction, which is
// what a Today-screen card tapping through to would need. So this is a
// genuinely new screen, not a re-point to an existing one — reusing only
// existing endpoints, no backend change.
//
// Routed as a hidden tab (`href: null` in app/(app)/_layout.tsx), same
// "pushed, not tabbed" shape as mentee/[id].tsx and note/[id].tsx.

import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { hasResponse, type InstructionAssignedToMe } from "@goalslot/shared";

import { EmptyState, QueryErrorState, Skeleton } from "@/components";
import { StatusPill } from "@/components/lists";
import { HiddenTabBackButton, useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { Button } from "@/components/ui/Button";
import { useScreenView } from "@/hooks/useScreenView";
import { apiClient, notify } from "@/lib/api-client";
import { instructionsQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, radii, spacing, typography } from "@/theme/tokens";

function describeCompleteError(err: unknown): string {
  if (!hasResponse(err)) return "You're offline. Check your connection and try again.";
  return "Couldn't mark that complete. Try again.";
}

export default function InstructionsScreen() {
  useScreenView("instructions");
  // Today is the only entry point into this hidden tab.
  useHiddenTabBackHandler("/");

  const [completingId, setCompletingId] = useState<string | null>(null);

  const instructionsQuery = useQuery(instructionsQueries.assignedToMe());
  const instructions = useMemo(() => instructionsQuery.data ?? [], [instructionsQuery.data]);
  const pending = useMemo(
    () => instructions.filter((instruction) => instruction.status === "PENDING"),
    [instructions],
  );
  const done = useMemo(() => instructions.filter((instruction) => instruction.status === "DONE"), [instructions]);

  const isRefreshing = instructionsQuery.isFetching && !instructionsQuery.isPending;

  const handleComplete = useCallback(async (instruction: InstructionAssignedToMe) => {
    setCompletingId(instruction.id);
    try {
      await apiClient.instructions.complete(instruction.id);
      await queryClient.invalidateQueries({
        queryKey: instructionsQueries.instructionsQueries.assignedToMe(),
      });
      notify("Marked complete", "success");
    } catch (err) {
      notify(describeCompleteError(err), "error");
    } finally {
      setCompletingId(null);
    }
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <HiddenTabBackButton label="Today" destination="/" />
        <Text style={styles.headerTitle} accessibilityRole="header">
          Instructions
        </Text>
      </View>

      {instructionsQuery.isPending ? (
        <View style={styles.sectionPadded}>
          <Skeleton width="100%" height={72} borderRadius={radii.lg} />
          <Skeleton width="100%" height={72} borderRadius={radii.lg} />
        </View>
      ) : instructionsQuery.isError && !instructionsQuery.data ? (
        <QueryErrorState
          error={instructionsQuery.error}
          message="Couldn't load your instructions."
          onRetry={() => void instructionsQuery.refetch()}
        />
      ) : instructions.length === 0 ? (
        <EmptyState
          message="Nothing assigned yet"
          description="When a mentor assigns you an instruction, it'll show up here."
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void instructionsQuery.refetch()}
              accessibilityLabel="Pull to refresh"
            />
          }
        >
          {pending.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pending</Text>
              <View style={styles.list}>
                {pending.map((instruction) => (
                  <InstructionRow
                    key={instruction.id}
                    instruction={instruction}
                    onComplete={() => void handleComplete(instruction)}
                    completing={completingId === instruction.id}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {done.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Completed</Text>
              <View style={styles.list}>
                {done.map((instruction) => (
                  <InstructionRow key={instruction.id} instruction={instruction} onComplete={null} completing={false} />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function InstructionRow({
  instruction,
  onComplete,
  completing,
}: {
  instruction: InstructionAssignedToMe;
  onComplete: (() => void) | null;
  completing: boolean;
}) {
  const assignerName = instruction.assigner.name?.trim() || instruction.assigner.email;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{instruction.title}</Text>
          {instruction.note ? <Text style={styles.cardNote}>{instruction.note}</Text> : null}
          <Text style={styles.cardMeta}>From {assignerName}</Text>
        </View>
        <StatusPill
          label={instruction.status === "DONE" ? "Done" : "Pending"}
          tone={instruction.status === "DONE" ? "success" : "warning"}
        />
      </View>
      {onComplete ? (
        <Button
          label="Mark complete"
          variant="secondary"
          size="sm"
          onPress={onComplete}
          loading={completing}
          disabled={completing}
          style={styles.completeButton}
        />
      ) : null}
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
  headerTitle: {
    ...typography.title,
    color: colors.foreground,
  },
  sectionPadded: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  section: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.mutedForeground,
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.md,
  },
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing.xl,
    gap: spacing.md,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  cardBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  cardTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  cardNote: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  cardMeta: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: spacing.xxs,
  },
  completeButton: {
    alignSelf: "flex-start",
  },
});
