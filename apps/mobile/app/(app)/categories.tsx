// Categories & Labels management screen. Neither has a screen anywhere in
// the app today — useQuickAdd.ts silently resolves a "default" category
// behind the scenes (see resolveDefaultCategory there) but the user has no
// way to see, create, or delete their own categories/labels. This screen is
// the first one.
//
// Two independent sections, each following the same optimistic-update ->
// live call -> invalidate-or-rollback shape as goals.tsx/tasks.tsx: snapshot
// the list before mutating, patch the cache, invalidate on success, roll
// back + Alert.alert on failure. No offline outbox here (unlike
// useQuickAdd's three domains) — this screen isn't in that task's scope and
// create/delete here isn't part of the quick-add flow.
//
// Create forms are intentionally minimal: `CreateCategoryForm`/
// `CreateLabelForm` (packages/shared/src/types/{category,label}.ts) are the
// only fields collected — name, plus a fixed preset-swatch color picker (no
// color-picker dependency). Category.color is required by the type;
// Label.color is optional, so an unpicked label color is simply omitted
// from the payload.
//
// `isDefault` is surfaced read-only for both types. `UpdateCategoryForm`
// technically has an optional `isDefault` field, but there's no dedicated
// "set default" endpoint and no client-visible guarantee the server
// enforces "exactly one default" if it's flipped via a plain PUT — and
// `UpdateLabelForm` has no `isDefault` field at all, so the two types would
// behave inconsistently if only one got an editable toggle. Kept read-only
// on both until a real "set default" flow is designed.

import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { genId, type Category, type CreateCategoryForm, type CreateLabelForm, type Label } from "@goalslot/shared";

import { EmptyState, ErrorState, SkeletonListItem } from "@/components";
import { apiClient } from "@/lib/api-client";
import { categoryQueries, labelQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";

const SKELETON_ROWS = 3;

/** Small fixed swatch — no color-picker dependency, just tappable presets. */
const PRESET_COLORS = ["#EF4444", "#F97316", "#F59E0B", "#22C55E", "#0EA5E9", "#6366F1", "#A855F7", "#EC4899"];

/**
 * Pulls a server-side error message out of an axios-shaped error (the API
 * is NestJS; validation/conflict failures respond with `{ message: string |
 * string[] }`). Mirrors `hasResponse` in src/hooks/useQuickAdd.ts — avoids
 * importing axios's types directly since this app doesn't depend on axios
 * itself (only @goalslot/shared does).
 */
function extractErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string | string[] } } } | undefined)?.response?.data;
  if (!data?.message) return fallback;
  return Array.isArray(data.message) ? data.message.join(", ") : data.message;
}

export default function CategoriesScreen() {
  const analytics = useAnalytics();

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "categories" } });
    }, [analytics]),
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionHeading}>Categories</Text>
      <CategoriesSection />

      <Text style={styles.sectionHeading}>Labels</Text>
      <LabelsSection />
    </ScrollView>
  );
}

function CategoriesSection() {
  const { data, isPending, isError, refetch } = useQuery(categoryQueries.list());
  const listKey = categoryQueries.categoryQueries.listKey();

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [isSaving, setIsSaving] = useState(false);

  const resetForm = useCallback(() => {
    setName("");
    setColor(PRESET_COLORS[0]);
    setIsAdding(false);
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || isSaving) return;

    const payload: CreateCategoryForm = { name: trimmed, color };
    const optimisticId = genId();
    const previous = queryClient.getQueryData<Category[]>(listKey);
    const optimistic: Category = {
      id: optimisticId,
      userId: "",
      name: payload.name,
      value: payload.name.toLowerCase(),
      color: payload.color,
      isDefault: false,
      order: previous?.length ?? 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setIsSaving(true);
    queryClient.setQueryData<Category[]>(listKey, (existing) => [...(existing ?? []), optimistic]);

    try {
      await apiClient.categories.create(payload);
      void queryClient.invalidateQueries({ queryKey: categoryQueries.categoryQueries.all() });
      resetForm();
    } catch (err) {
      queryClient.setQueryData(listKey, previous);
      Alert.alert("Couldn't add category", extractErrorMessage(err, "Please try again."));
    } finally {
      setIsSaving(false);
    }
  }, [color, listKey, name, isSaving, resetForm]);

  const handleDelete = useCallback(
    (category: Category) => {
      Alert.alert("Delete category?", `"${category.name}" will be permanently removed.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const previous = queryClient.getQueryData<Category[]>(listKey);
              queryClient.setQueryData<Category[]>(listKey, (existing) =>
                (existing ?? []).filter((c) => c.id !== category.id),
              );

              try {
                await apiClient.categories.delete(category.id);
                void queryClient.invalidateQueries({ queryKey: categoryQueries.categoryQueries.all() });
              } catch (err) {
                queryClient.setQueryData(listKey, previous);
                Alert.alert("Couldn't delete category", extractErrorMessage(err, "Please try again."));
              }
            })();
          },
        },
      ]);
    },
    [listKey],
  );

  if (isPending) {
    return (
      <View>
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          <SkeletonListItem key={index} />
        ))}
      </View>
    );
  }

  if (isError) {
    return <ErrorState message="Couldn't load categories." onRetry={() => void refetch()} />;
  }

  return (
    <View style={styles.sectionBody}>
      {!data || data.length === 0 ? (
        <EmptyState message="No categories yet — add one" />
      ) : (
        data.map((category) => (
          <View key={category.id} style={styles.row}>
            <View style={[styles.colorDot, { backgroundColor: category.color }]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {category.name}
              </Text>
              {category.isDefault ? <Text style={styles.defaultBadge}>Default</Text> : null}
            </View>
            <TouchableOpacity
              onPress={() => handleDelete(category)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Delete "${category.name}" category`}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      {isAdding ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Category name"
            value={name}
            onChangeText={setName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void handleCreate()}
            accessibilityLabel="Category name"
          />
          <SwatchPicker selected={color} onSelect={(next) => setColor(next ?? PRESET_COLORS[0])} />
          <View style={styles.formActions}>
            <TouchableOpacity
              onPress={resetForm}
              accessibilityRole="button"
              accessibilityLabel="Cancel adding category"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, (!name.trim() || isSaving) && styles.saveButtonDisabled]}
              onPress={() => void handleCreate()}
              disabled={!name.trim() || isSaving}
              accessibilityRole="button"
              accessibilityLabel="Save category"
            >
              <Text style={styles.saveButtonText}>{isSaving ? "Saving…" : "Save"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.addRow}
          onPress={() => setIsAdding(true)}
          accessibilityRole="button"
          accessibilityLabel="Add category"
        >
          <Text style={styles.addRowText}>+ Add category</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function LabelsSection() {
  const { data, isPending, isError, refetch } = useQuery(labelQueries.list());
  const listKey = labelQueries.labelQueries.listKey();

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const resetForm = useCallback(() => {
    setName("");
    setColor(undefined);
    setIsAdding(false);
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || isSaving) return;

    const payload: CreateLabelForm = color ? { name: trimmed, color } : { name: trimmed };
    const optimisticId = genId();
    const previous = queryClient.getQueryData<Label[]>(listKey);
    const optimistic: Label = {
      id: optimisticId,
      name: payload.name,
      value: payload.name.toLowerCase(),
      color: payload.color ?? PRESET_COLORS[0],
      isDefault: false,
      order: previous?.length ?? 0,
    };

    setIsSaving(true);
    queryClient.setQueryData<Label[]>(listKey, (existing) => [...(existing ?? []), optimistic]);

    try {
      await apiClient.labels.create(payload);
      void queryClient.invalidateQueries({ queryKey: labelQueries.labelQueries.all() });
      resetForm();
    } catch (err) {
      queryClient.setQueryData(listKey, previous);
      Alert.alert("Couldn't add label", extractErrorMessage(err, "Please try again."));
    } finally {
      setIsSaving(false);
    }
  }, [color, listKey, name, isSaving, resetForm]);

  const handleDelete = useCallback(
    (label: Label) => {
      Alert.alert("Delete label?", `"${label.name}" will be permanently removed.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const previous = queryClient.getQueryData<Label[]>(listKey);
              queryClient.setQueryData<Label[]>(listKey, (existing) =>
                (existing ?? []).filter((l) => l.id !== label.id),
              );

              try {
                await apiClient.labels.delete(label.id);
                void queryClient.invalidateQueries({ queryKey: labelQueries.labelQueries.all() });
              } catch (err) {
                queryClient.setQueryData(listKey, previous);
                Alert.alert("Couldn't delete label", extractErrorMessage(err, "Please try again."));
              }
            })();
          },
        },
      ]);
    },
    [listKey],
  );

  if (isPending) {
    return (
      <View>
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          <SkeletonListItem key={index} />
        ))}
      </View>
    );
  }

  if (isError) {
    return <ErrorState message="Couldn't load labels." onRetry={() => void refetch()} />;
  }

  return (
    <View style={styles.sectionBody}>
      {!data || data.length === 0 ? (
        <EmptyState message="No labels yet — add one" />
      ) : (
        data.map((label) => (
          <View key={label.id} style={styles.row}>
            <View style={[styles.colorDot, { backgroundColor: label.color || "#94A3B8" }]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {label.name}
              </Text>
              {label.isDefault ? <Text style={styles.defaultBadge}>Default</Text> : null}
            </View>
            <TouchableOpacity
              onPress={() => handleDelete(label)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Delete "${label.name}" label`}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      {isAdding ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Label name"
            value={name}
            onChangeText={setName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void handleCreate()}
            accessibilityLabel="Label name"
          />
          <SwatchPicker selected={color} onSelect={setColor} allowClear />
          <View style={styles.formActions}>
            <TouchableOpacity onPress={resetForm} accessibilityRole="button" accessibilityLabel="Cancel adding label">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, (!name.trim() || isSaving) && styles.saveButtonDisabled]}
              onPress={() => void handleCreate()}
              disabled={!name.trim() || isSaving}
              accessibilityRole="button"
              accessibilityLabel="Save label"
            >
              <Text style={styles.saveButtonText}>{isSaving ? "Saving…" : "Save"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.addRow}
          onPress={() => setIsAdding(true)}
          accessibilityRole="button"
          accessibilityLabel="Add label"
        >
          <Text style={styles.addRowText}>+ Add label</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

interface SwatchPickerProps {
  selected: string | undefined;
  onSelect: (color: string | undefined) => void;
  /** Labels only — color is optional there, so tapping the selected swatch again clears it. */
  allowClear?: boolean;
}

function SwatchPicker({ selected, onSelect, allowClear }: SwatchPickerProps) {
  return (
    <View style={styles.swatchRow}>
      {PRESET_COLORS.map((swatch) => {
        const isSelected = swatch === selected;
        return (
          <TouchableOpacity
            key={swatch}
            style={[styles.swatch, { backgroundColor: swatch }, isSelected && styles.swatchSelected]}
            onPress={() => onSelect(allowClear && isSelected ? undefined : swatch)}
            accessibilityRole="button"
            accessibilityLabel={`Color ${swatch}${isSelected ? ", selected" : ""}`}
            accessibilityState={{ selected: isSelected }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 8,
    paddingBottom: 40,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 16,
    marginBottom: 4,
  },
  sectionBody: {
    gap: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0F172A",
  },
  defaultBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  deleteText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#B3261E",
  },
  addRow: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  addRowText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1F2933",
  },
  form: {
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: "#0F172A",
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 16,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
  },
  saveButton: {
    backgroundColor: "#1F2933",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
});
