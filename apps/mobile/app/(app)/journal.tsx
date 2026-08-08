// Journal: one-entry-per-day writing habit, simplified per DECISIONS.md #5/#6
// (Journal was cut from the v1 screen list, then reinstated in a lightweight
// form — no TipTap toolbar, no decorative chrome, no calendar widget). Date
// navigation is just back/forward arrows off "today"; the editor is a plain
// multiline TextInput; saving is an explicit button (not save-on-blur — a
// manual Save is the simpler, more predictable of the two options the task
// allowed, and it matches every other screen in this app using an explicit
// action rather than an implicit one). A scrollable "recent entries" list
// below the editor lets the user jump back into any of the last two weeks
// without a calendar.
//
// Optimistic-update-then-rollback follows goals.tsx's exact shape: snapshot
// the query about to be touched, patch it locally, call the live endpoint,
// then either invalidate (success) or restore the snapshot (failure) — no
// offline-outbox involved, same as every other v1 screen.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";

import { getLocalDateString, todayKey, type JournalEntry } from "@goalslot/shared";

import { EmptyState, ErrorState, Skeleton, SkeletonListItem } from "@/components";
import { apiClient } from "@/lib/api-client";
import { journalQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";

const RECENT_WINDOW_DAYS = 14;
const RECENT_SKELETON_ROWS = 4;

function addDays(dateKey: string, delta: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
  return getLocalDateString(date);
}

function formatDisplayDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export default function JournalScreen() {
  const analytics = useAnalytics();
  const today = useMemo(() => todayKey(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [draft, setDraft] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "journal" } });
    }, [analytics]),
  );

  const entryQuery = useQuery(journalQueries.byDate(selectedDate));
  const entryKey = useMemo(() => journalQueries.journalQueries.byDate(selectedDate), [selectedDate]);

  // Clear the draft immediately on date change so the previous day's text
  // doesn't flash while the new day's entry loads, then populate it once
  // that day's query has actually resolved (data stays `undefined` until
  // then; a day with no entry resolves to `null`, not undefined).
  useEffect(() => {
    setDraft("");
    setIsDirty(false);
  }, [selectedDate]);

  useEffect(() => {
    if (entryQuery.data !== undefined) {
      setDraft(entryQuery.data?.content ?? "");
      setIsDirty(false);
    }
  }, [entryQuery.data]);

  const recentRange = useMemo(
    () => ({ from: addDays(today, -(RECENT_WINDOW_DAYS - 1)), to: today }),
    [today],
  );
  const recentQuery = useQuery(journalQueries.list(recentRange));
  const recentEntries = useMemo(
    () => [...(recentQuery.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [recentQuery.data],
  );

  const handleSave = useCallback(async () => {
    const trimmedContent = draft;
    const previous = queryClient.getQueryData<JournalEntry | null>(entryKey);

    const optimisticEntry: JournalEntry = {
      id: previous?.id ?? `optimistic-${selectedDate}`,
      date: selectedDate,
      content: trimmedContent,
    };
    queryClient.setQueryData(entryKey, optimisticEntry);
    setIsSaving(true);

    try {
      const response = previous?.id
        ? await apiClient.journal.update(previous.id, { content: trimmedContent })
        : await apiClient.journal.create({ date: selectedDate, content: trimmedContent });

      queryClient.setQueryData(entryKey, response.data);
      void queryClient.invalidateQueries({ queryKey: journalQueries.journalQueries.all });
      setIsDirty(false);
      analytics.track({ name: "journalEntrySaved", payload: { date: selectedDate } });
    } catch {
      queryClient.setQueryData(entryKey, previous);
      Alert.alert("Couldn't save entry", "Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [analytics, draft, entryKey, selectedDate]);

  const goToPreviousDay = useCallback(() => setSelectedDate((date) => addDays(date, -1)), []);
  const goToNextDay = useCallback(() => setSelectedDate((date) => addDays(date, 1)), []);
  const goToToday = useCallback(() => setSelectedDate(today), [today]);
  const canGoForward = selectedDate < today;
  const isToday = selectedDate === today;

  const renderRecentItem = useCallback(
    ({ item }: { item: JournalEntry }) => (
      <Pressable
        style={[styles.recentRow, item.date === selectedDate && styles.recentRowActive]}
        onPress={() => setSelectedDate(item.date)}
        accessibilityRole="button"
        accessibilityLabel={`View entry from ${formatDisplayDate(item.date)}`}
      >
        <Text style={styles.recentRowDate}>{formatDisplayDate(item.date)}</Text>
        <Text style={styles.recentRowPreview} numberOfLines={1}>
          {item.content.trim() || "No content"}
        </Text>
      </Pressable>
    ),
    [selectedDate],
  );

  let editorContent: React.ReactNode;
  if (entryQuery.isPending) {
    editorContent = (
      <View style={styles.editorSkeleton} accessibilityLabel="Loading journal entry">
        <Skeleton height={18} width="55%" />
        <Skeleton height={140} style={styles.editorSkeletonBody} />
      </View>
    );
  } else if (entryQuery.isError) {
    editorContent = (
      <ErrorState message="Couldn't load this entry." onRetry={() => void entryQuery.refetch()} />
    );
  } else {
    editorContent = (
      <TextInput
        style={styles.textInput}
        multiline
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          setIsDirty(true);
        }}
        placeholder="Write about your day..."
        placeholderTextColor="#94A3B8"
        textAlignVertical="top"
        accessibilityLabel={`Journal entry for ${formatDisplayDate(selectedDate)}`}
        accessibilityHint="Multiline text field. Use the Save button below to save your changes."
      />
    );
  }

  let recentContent: React.ReactNode;
  if (recentQuery.isPending) {
    recentContent = (
      <View>
        {Array.from({ length: RECENT_SKELETON_ROWS }).map((_, index) => (
          <SkeletonListItem key={index} showLeading={false} />
        ))}
      </View>
    );
  } else if (recentQuery.isError) {
    recentContent = (
      <ErrorState message="Couldn't load recent entries." onRetry={() => void recentQuery.refetch()} />
    );
  } else if (recentEntries.length === 0) {
    recentContent = <EmptyState message="No journal entries yet — write today's to get started" />;
  } else {
    recentContent = (
      <FlashList
        data={recentEntries}
        keyExtractor={(item) => item.id}
        renderItem={renderRecentItem}
        contentContainerStyle={styles.recentListContent}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.dateNav}>
        <Pressable
          style={styles.navArrow}
          onPress={goToPreviousDay}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
        >
          <Text style={styles.navArrowText}>‹</Text>
        </Pressable>

        <Pressable
          style={styles.dateLabelWrap}
          onPress={goToToday}
          disabled={isToday}
          accessibilityRole="header"
          accessibilityLabel={`Journal date: ${formatDisplayDate(selectedDate)}${isToday ? ", today" : ""}`}
        >
          <Text style={styles.dateLabel} numberOfLines={1}>
            {isToday ? "Today" : formatDisplayDate(selectedDate)}
          </Text>
          {!isToday ? <Text style={styles.dateSublabel}>{formatDisplayDate(selectedDate)}</Text> : null}
        </Pressable>

        <Pressable
          style={styles.navArrow}
          onPress={goToNextDay}
          disabled={!canGoForward}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          accessibilityState={{ disabled: !canGoForward }}
        >
          <Text style={[styles.navArrowText, !canGoForward && styles.navArrowTextDisabled]}>›</Text>
        </Pressable>
      </View>

      <View style={styles.editorArea}>{editorContent}</View>

      <Pressable
        style={[styles.saveButton, (!isDirty || isSaving) && styles.saveButtonDisabled]}
        onPress={() => void handleSave()}
        disabled={!isDirty || isSaving}
        accessibilityRole="button"
        accessibilityLabel="Save journal entry"
        accessibilityState={{ disabled: !isDirty || isSaving }}
      >
        <Text style={styles.saveButtonText}>{isSaving ? "Saving…" : "Save"}</Text>
      </Pressable>

      <View style={styles.recentSection}>
        <Text style={styles.recentHeading}>Recent entries</Text>
        <View style={styles.recentListArea}>{recentContent}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  navArrow: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  navArrowText: {
    fontSize: 26,
    fontWeight: "400",
    color: "#1F2933",
  },
  navArrowTextDisabled: {
    color: "#CBD5E1",
  },
  dateLabelWrap: {
    flex: 1,
    alignItems: "center",
  },
  dateLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  dateSublabel: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  editorArea: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  editorSkeleton: {
    gap: 10,
  },
  editorSkeletonBody: {
    marginTop: 4,
  },
  textInput: {
    minHeight: 160,
    maxHeight: 260,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    padding: 12,
    fontSize: 15,
    color: "#0F172A",
  },
  saveButton: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#1F2933",
  },
  saveButtonDisabled: {
    backgroundColor: "#CBD5E1",
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
  recentSection: {
    flex: 1,
    marginTop: 20,
  },
  recentHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  recentListArea: {
    flex: 1,
  },
  recentListContent: {
    paddingVertical: 4,
  },
  recentRow: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
    gap: 2,
  },
  recentRowActive: {
    backgroundColor: "#F1F5F9",
  },
  recentRowDate: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  recentRowPreview: {
    fontSize: 12,
    color: "#64748B",
  },
});
