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
//
// Presentation mirrors dw-time-web/src/features/categories/components/
// category-management.tsx: a section title with an "Add Category" button on
// the right, then rows of {large round color swatch, bold name, the
// lowercase `value` slug underneath, a Default pill, icon-only edit/delete}.
// The swatch is the whole point of the screen — it's the color the category
// then wears everywhere else in the product — so it leads each row and also
// tints that row's left accent stripe.

import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { genId, type Category, type CreateCategoryForm, type CreateLabelForm, type Label } from "@goalslot/shared";

import { QueryErrorState, SkeletonListItem } from "@/components";
import { Icon } from "@/components/ui/Icon";
import {
  ColorSwatch,
  DEFAULT_SWATCH,
  ListCard,
  ListEmptyState,
  PRESET_COLORS,
  safeColor,
  ScreenHeader,
  SectionHeader,
  StatusPill,
  withAlpha,
} from "@/components/lists";
import { apiClient } from "@/lib/api-client";
import { categoryQueries, labelQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

const SKELETON_ROWS = 3;

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
    // edges={["top"]} — this route renders with `headerShown: false` like
    // every other tab, so nothing else keeps the title clear of the status bar.
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScreenHeader
        eyebrow="Organize"
        title="Categories"
        subtitle="The colors your goals, tasks and reports are grouped by."
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <CategoriesSection />
        <LabelsSection />
      </ScrollView>
    </SafeAreaView>
  );
}

function CategoriesSection() {
  const { data, isPending, isError, error, refetch } = useQuery(categoryQueries.list());
  const listKey = categoryQueries.categoryQueries.listKey();

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_SWATCH);
  const [isSaving, setIsSaving] = useState(false);

  const resetForm = useCallback(() => {
    setName("");
    setColor(DEFAULT_SWATCH);
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

  return (
    <View>
      <SectionHeader
        label="Categories"
        count={data?.length}
        action={
          !isAdding ? (
            <AddButton label="Add category" onPress={() => setIsAdding(true)} />
          ) : undefined
        }
      />

      {isPending ? (
        <View>
          {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
            <SkeletonListItem key={index} />
          ))}
        </View>
      ) : isError && !data ? (
        // `isError && !data`, not `isError` alone: this section refetches on
        // focus, so a failed background refetch must not blow away an
        // already-rendered, perfectly good cached list — the same guard
        // schedule.tsx/goals.tsx/tasks.tsx already apply to their own lists.
        <QueryErrorState error={error} message="Couldn't load categories." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <ListEmptyState
          compact
          variant="categories"
          title="No categories yet"
          description="Categories are the colors your goals and tasks group by. Add your first one."
          actionLabel="Add category"
          onAction={() => setIsAdding(true)}
        />
      ) : (
        <View style={styles.rows}>
          {data.map((category, index) => (
            <EntityRow
              key={category.id}
              index={index}
              color={category.color}
              name={category.name}
              slug={category.value}
              isDefault={category.isDefault}
              onDelete={() => handleDelete(category)}
              deleteAccessibilityLabel={`Delete "${category.name}" category`}
            />
          ))}
        </View>
      )}

      {isAdding ? (
        <CreateForm
          placeholder="Category name"
          accessibilityLabel="Category name"
          name={name}
          onChangeName={setName}
          color={color}
          onSelectColor={(next) => setColor(next ?? DEFAULT_SWATCH)}
          isSaving={isSaving}
          onCancel={resetForm}
          onSave={() => void handleCreate()}
          cancelAccessibilityLabel="Cancel adding category"
          saveAccessibilityLabel="Save category"
        />
      ) : null}
    </View>
  );
}

function LabelsSection() {
  const { data, isPending, isError, error, refetch } = useQuery(labelQueries.list());
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
      color: payload.color ?? DEFAULT_SWATCH,
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

  return (
    <View>
      <SectionHeader
        label="Labels"
        count={data?.length}
        action={!isAdding ? <AddButton label="Add label" onPress={() => setIsAdding(true)} /> : undefined}
      />

      {isPending ? (
        <View>
          {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
            <SkeletonListItem key={index} />
          ))}
        </View>
      ) : isError && !data ? (
        // Same `isError && !data` guard as CategoriesSection above.
        <QueryErrorState error={error} message="Couldn't load labels." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <ListEmptyState
          compact
          variant="categories"
          title="No labels yet"
          description="Labels are the free-form tags you can stack on a goal alongside its category."
          actionLabel="Add label"
          onAction={() => setIsAdding(true)}
        />
      ) : (
        <View style={styles.rows}>
          {data.map((label, index) => (
            <EntityRow
              key={label.id}
              index={index}
              // Label.color is optional in the shared type; fall back to the
              // theme's muted ink rather than inventing a color for it.
              color={label.color || colors.mutedForeground}
              name={label.name}
              slug={label.value}
              isDefault={label.isDefault}
              onDelete={() => handleDelete(label)}
              deleteAccessibilityLabel={`Delete "${label.name}" label`}
            />
          ))}
        </View>
      )}

      {isAdding ? (
        <CreateForm
          placeholder="Label name"
          accessibilityLabel="Label name"
          name={name}
          onChangeName={setName}
          color={color}
          onSelectColor={setColor}
          allowClearColor
          isSaving={isSaving}
          onCancel={resetForm}
          onSave={() => void handleCreate()}
          cancelAccessibilityLabel="Cancel adding label"
          saveAccessibilityLabel="Save label"
        />
      ) : null}
    </View>
  );
}

/**
 * One category or label row. Both types render identically — same swatch,
 * name, slug, Default pill and delete affordance — which is exactly how the
 * web treats them, so they share a component rather than being copy-pasted.
 */
function EntityRow({
  index,
  color,
  name,
  slug,
  isDefault,
  onDelete,
  deleteAccessibilityLabel,
}: {
  index: number;
  color: string;
  name: string;
  slug: string;
  isDefault: boolean;
  onDelete: () => void;
  deleteAccessibilityLabel: string;
}) {
  return (
    <ListCard accentColor={safeColor(color, colors.mutedForeground)} index={index} contentStyle={styles.rowContent}>
      <ColorSwatch color={color} size={38} />

      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        {/* web renders `category.value` in a mono face under the name */}
        <Text style={styles.rowSlug} numberOfLines={1}>
          {slug}
        </Text>
      </View>

      {isDefault ? <StatusPill label="Default" tone="brand" showDot={false} /> : null}

      <Pressable
        style={styles.iconButton}
        onPress={onDelete}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={deleteAccessibilityLabel}
      >
        <Icon name="trash" size={16} color={colors.destructive} />
      </Pressable>
    </ListCard>
  );
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.addButton} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name="add" size={15} color={colors.primaryForeground} />
      <Text style={styles.addButtonText}>Add</Text>
    </Pressable>
  );
}

interface CreateFormProps {
  placeholder: string;
  accessibilityLabel: string;
  name: string;
  onChangeName: (value: string) => void;
  color: string | undefined;
  onSelectColor: (color: string | undefined) => void;
  allowClearColor?: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void;
  cancelAccessibilityLabel: string;
  saveAccessibilityLabel: string;
}

function CreateForm({
  placeholder,
  accessibilityLabel,
  name,
  onChangeName,
  color,
  onSelectColor,
  allowClearColor,
  isSaving,
  onCancel,
  onSave,
  cancelAccessibilityLabel,
  saveAccessibilityLabel,
}: CreateFormProps) {
  const disabled = !name.trim() || isSaving;

  return (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={name}
        onChangeText={onChangeName}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={onSave}
        accessibilityLabel={accessibilityLabel}
      />

      <Text style={styles.formLabel}>Color</Text>
      <SwatchPicker selected={color} onSelect={onSelectColor} allowClear={allowClearColor} />

      <View style={styles.formActions}>
        <Pressable
          style={styles.secondaryButton}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={cancelAccessibilityLabel}
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.saveButton, disabled && styles.saveButtonDisabled]}
          onPress={onSave}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={saveAccessibilityLabel}
        >
          <Text style={styles.saveButtonText}>{isSaving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>
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
          <Pressable
            key={swatch}
            style={[
              styles.swatchTarget,
              isSelected && { backgroundColor: withAlpha(swatch, 0.18, colors.secondary) },
            ]}
            onPress={() => onSelect(allowClear && isSelected ? undefined : swatch)}
            accessibilityRole="button"
            accessibilityLabel={`Color ${swatch}${isSelected ? ", selected" : ""}`}
            accessibilityState={{ selected: isSelected }}
          >
            <View style={[styles.swatch, { backgroundColor: swatch }]}>
              {/* A check inside the swatch reads at a glance; a ring around it
                  disappears against same-hue neighbours. */}
              {isSelected ? <Icon name="check" size={16} color={colors.white} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl * 2,
  },
  rows: {
    gap: spacing.md,
  },

  // --- Entity row ---
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowName: {
    ...typography.title,
    color: colors.foreground,
  },
  rowSlug: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  iconButton: {
    width: minTouchTarget - spacing.md,
    height: minTouchTarget - spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },

  // --- Add button (web: the "Add Category" header button) ---
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  addButtonText: {
    ...typography.caption,
    color: colors.primaryForeground,
  },

  // --- Create form ---
  form: {
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formLabel: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  input: {
    ...typography.body,
    color: colors.foreground,
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderColor: colors.input,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  swatchTarget: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
  },
  secondaryButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
  },
  secondaryButtonText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  saveButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    backgroundColor: colors.foreground,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.xl,
  },
  saveButtonDisabled: {
    opacity: 0.45,
  },
  saveButtonText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.white,
  },
});
