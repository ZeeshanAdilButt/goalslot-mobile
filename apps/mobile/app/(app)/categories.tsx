// Categories & Labels management screen. Neither has a screen anywhere in
// the app today — useQuickAdd.ts silently resolves a "default" category
// behind the scenes (see resolveDefaultCategory there) but the user has no
// way to see, create, edit or delete their own categories/labels. This screen
// is the first one.
//
// Two independent sections, each following the same optimistic-update ->
// live call -> invalidate-or-rollback shape as goals.tsx/tasks.tsx: snapshot
// the list before mutating, patch the cache, invalidate on success, roll
// back + report on failure. No offline outbox here (unlike useQuickAdd's
// three domains) — this screen isn't in that task's scope and create/edit/
// delete here isn't part of the quick-add flow.
//
// Forms are intentionally minimal: `CreateCategoryForm`/`CreateLabelForm`
// (packages/shared/src/types/{category,label}.ts) are the only fields
// collected — name, plus a fixed preset-swatch color picker (no color-picker
// dependency). Category.color is required by the type; Label.color is
// optional, so an unpicked label color is simply omitted from the payload.
//
// EDIT uses the SAME form component as create (`EntityForm`), rendered in
// place of the row it belongs to rather than below the list, so the fields
// sit exactly where the values they're changing were. `UpdateCategoryForm`/
// `UpdateLabelForm` carry the same name+color pair the create forms do, which
// is why one component serves both. Until this existed the only way to fix a
// typo in a category name was delete-and-recreate — which orphans every goal
// grouped under it, since goals store the category's `value`, not its id.
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
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  genId,
  type Category,
  type CreateCategoryForm,
  type CreateLabelForm,
  type Label,
  type UpdateCategoryForm,
} from "@goalslot/shared";

import { QueryErrorState, SkeletonListItem } from "@/components";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
import { apiClient, notify } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { categoryQueries, goalQueries, labelQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

const SKELETON_ROWS = 3;

/**
 * Which form (if any) is open in a section. One slot, not an `isAdding`
 * boolean beside an `editing` entity: only ever one form is on screen, and a
 * single piece of state makes that unrepresentable-otherwise rather than a
 * rule two setters have to remember.
 */
type FormState<T> = { mode: "create" } | { mode: "edit"; entity: T };

export default function CategoriesScreen() {
  const analytics = useAnalytics();

  // Both lists are read again inside the two sections below. Mounting the
  // same query options here costs no extra request — react-query serves both
  // observers from one cache entry and dedupes concurrent fetches — and it's
  // what lets the screen's single pull-to-refresh drive both sections at
  // once without either having to hand its `refetch` back up.
  const categoriesQuery = useQuery(categoryQueries.list());
  const labelsQuery = useQuery(labelQueries.list());

  const onRefresh = useCallback(() => {
    void categoriesQuery.refetch();
    void labelsQuery.refetch();
  }, [categoriesQuery, labelsQuery]);

  // Derived from the queries rather than a local boolean the handler flips —
  // same reasoning as reports.tsx: a refetch started anywhere else (a focus
  // revalidation, a reconnect) should spin the same control. The `!isPending`
  // half keeps the spinner off a genuine first load, which is the skeletons'
  // job.
  const isRefreshing =
    (categoriesQuery.isFetching && !categoriesQuery.isPending) ||
    (labelsQuery.isFetching && !labelsQuery.isPending);

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
      {/* The category/label create forms autofocus their name field — the only
          autoFocus text input outside a sheet in the app — so the keyboard
          opens immediately on "Add category"/"Add label" with nothing else
          prompting a scroll. Without this, Android leaves that field under
          the keyboard the moment it's tapped. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              accessibilityLabel="Pull to refresh categories and labels"
            />
          }
        >
          <CategoriesSection />
          <LabelsSection />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CategoriesSection() {
  const { data, isPending, isError, error, refetch } = useQuery(categoryQueries.list());
  const listKey = categoryQueries.categoryQueries.listKey();

  const [form, setForm] = useState<FormState<Category> | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_SWATCH);
  const [isSaving, setIsSaving] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const closeForm = useCallback(() => {
    setName("");
    setColor(DEFAULT_SWATCH);
    setForm(null);
  }, []);

  const openCreate = useCallback(() => {
    setName("");
    setColor(DEFAULT_SWATCH);
    setForm({ mode: "create" });
  }, []);

  const openEdit = useCallback((category: Category) => {
    setName(category.name);
    // A category coloured on web may hold a hex outside PRESET_COLORS, in
    // which case no swatch renders as selected — but the value is still
    // seeded here, so saving without touching the picker keeps the color it
    // already had rather than silently reassigning one of the presets.
    setColor(safeColor(category.color, DEFAULT_SWATCH));
    setForm({ mode: "edit", entity: category });
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!form || !trimmed || isSaving) return;

    const previous = queryClient.getQueryData<Category[]>(listKey);
    setIsSaving(true);

    if (form.mode === "create") {
      const payload: CreateCategoryForm = { name: trimmed, color };
      const optimistic: Category = {
        id: genId(),
        userId: "",
        name: payload.name,
        value: payload.name.toLowerCase(),
        color: payload.color,
        isDefault: false,
        order: previous?.length ?? 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queryClient.setQueryData<Category[]>(listKey, (existing) => [...(existing ?? []), optimistic]);

      try {
        await apiClient.categories.create(payload);
        void queryClient.invalidateQueries({ queryKey: categoryQueries.categoryQueries.all() });
        closeForm();
      } catch (err) {
        queryClient.setQueryData(listKey, previous);
        console.error(err);
        notify(getErrorMessage(err, "Couldn't add category. Please try again."), "error");
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const target = form.entity;
    const payload: UpdateCategoryForm = { name: trimmed, color };
    // `value` is deliberately NOT patched alongside the name: the slug is
    // derived server-side, and guessing at that derivation would flash a slug
    // the API may never agree with. The invalidate below brings back whatever
    // it actually chose.
    queryClient.setQueryData<Category[]>(listKey, (existing) =>
      (existing ?? []).map((c) => (c.id === target.id ? { ...c, ...payload } : c)),
    );

    try {
      await apiClient.categories.update(target.id, payload);
      void queryClient.invalidateQueries({ queryKey: categoryQueries.categoryQueries.all() });
      closeForm();
    } catch (err) {
      queryClient.setQueryData(listKey, previous);
      console.error(err);
      notify(getErrorMessage(err, "Couldn't save category. Please try again."), "error");
    } finally {
      setIsSaving(false);
    }
  }, [closeForm, color, form, isSaving, listKey, name]);

  const cancelDelete = useCallback(() => {
    if (deleteBusy) return;
    setPendingDelete(null);
    setDeleteError(null);
  }, [deleteBusy]);

  /**
   * Snapshot -> optimistic removal -> live DELETE -> invalidate on success.
   * A rejection rolls back and reports INSIDE the dialog that's already open
   * (ConfirmDialog's `error` slot) rather than stacking a second popup on it.
   */
  const confirmDelete = useCallback(async () => {
    const target = pendingDelete;
    if (!target || deleteBusy) return;

    setDeleteBusy(true);
    setDeleteError(null);

    const previous = queryClient.getQueryData<Category[]>(listKey);
    queryClient.setQueryData<Category[]>(listKey, (existing) =>
      (existing ?? []).filter((c) => c.id !== target.id),
    );

    try {
      await apiClient.categories.delete(target.id);
      void queryClient.invalidateQueries({ queryKey: categoryQueries.categoryQueries.all() });
      setPendingDelete(null);
    } catch (err) {
      queryClient.setQueryData(listKey, previous);
      console.error(err);
      setDeleteError(getErrorMessage(err, "Please try again."));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy, listKey, pendingDelete]);

  return (
    <View>
      <SectionHeader
        label="Categories"
        count={data?.length}
        action={form === null ? <AddButton label="Add category" onPress={openCreate} /> : undefined}
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
          onAction={openCreate}
        />
      ) : (
        <View style={styles.rows}>
          {data.map((category, index) =>
            form?.mode === "edit" && form.entity.id === category.id ? (
              <EntityForm
                key={category.id}
                placeholder="Category name"
                accessibilityLabel="Category name"
                name={name}
                onChangeName={setName}
                color={color}
                onSelectColor={(next) => setColor(next ?? DEFAULT_SWATCH)}
                isSaving={isSaving}
                onCancel={closeForm}
                onSave={() => void handleSave()}
                cancelAccessibilityLabel="Cancel editing category"
                saveAccessibilityLabel="Save category changes"
              />
            ) : (
              <EntityRow
                key={category.id}
                index={index}
                color={category.color}
                name={category.name}
                slug={category.value}
                isDefault={category.isDefault}
                onEdit={() => openEdit(category)}
                editAccessibilityLabel={`Edit "${category.name}" category`}
                onDelete={() => setPendingDelete(category)}
                deleteAccessibilityLabel={`Delete "${category.name}" category`}
              />
            ),
          )}
        </View>
      )}

      {form?.mode === "create" ? (
        <EntityForm
          style={styles.formSpaced}
          placeholder="Category name"
          accessibilityLabel="Category name"
          name={name}
          onChangeName={setName}
          color={color}
          onSelectColor={(next) => setColor(next ?? DEFAULT_SWATCH)}
          isSaving={isSaving}
          onCancel={closeForm}
          onSave={() => void handleSave()}
          cancelAccessibilityLabel="Cancel adding category"
          saveAccessibilityLabel="Save category"
        />
      ) : null}

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete category?"
        description={
          pendingDelete ? `"${pendingDelete.name}" will be permanently removed.` : undefined
        }
        icon="trash"
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      />
    </View>
  );
}

function LabelsSection() {
  const { data, isPending, isError, error, refetch } = useQuery(labelQueries.list());
  const listKey = labelQueries.labelQueries.listKey();

  const [form, setForm] = useState<FormState<Label> | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<Label | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const closeForm = useCallback(() => {
    setName("");
    setColor(undefined);
    setForm(null);
  }, []);

  const openCreate = useCallback(() => {
    setName("");
    setColor(undefined);
    setForm({ mode: "create" });
  }, []);

  const openEdit = useCallback((label: Label) => {
    setName(label.name);
    // `|| undefined`, not the muted-ink fallback the row renders: a label
    // saved without a color must reopen with the picker genuinely empty, so
    // saving doesn't invent one.
    setColor(label.color || undefined);
    setForm({ mode: "edit", entity: label });
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!form || !trimmed || isSaving) return;

    const previous = queryClient.getQueryData<Label[]>(listKey);
    // One payload serves both calls — `CreateLabelForm`'s {name, color?} is
    // structurally an `UpdateLabelForm` too. Color is omitted rather than
    // nulled when unpicked: both types make it optional and there's no wire
    // shape for "clear this color", so an edit that clears it keeps whatever
    // was already stored.
    const payload: CreateLabelForm = color ? { name: trimmed, color } : { name: trimmed };
    setIsSaving(true);

    if (form.mode === "create") {
      const optimistic: Label = {
        id: genId(),
        name: payload.name,
        value: payload.name.toLowerCase(),
        color: payload.color ?? DEFAULT_SWATCH,
        isDefault: false,
        order: previous?.length ?? 0,
      };
      queryClient.setQueryData<Label[]>(listKey, (existing) => [...(existing ?? []), optimistic]);

      try {
        await apiClient.labels.create(payload);
        void queryClient.invalidateQueries({ queryKey: labelQueries.labelQueries.all() });
        closeForm();
      } catch (err) {
        queryClient.setQueryData(listKey, previous);
        console.error(err);
        notify(getErrorMessage(err, "Couldn't add label. Please try again."), "error");
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const target = form.entity;
    // `value` left alone for the same reason as a category's — see there.
    queryClient.setQueryData<Label[]>(listKey, (existing) =>
      (existing ?? []).map((l) => (l.id === target.id ? { ...l, ...payload } : l)),
    );

    try {
      await apiClient.labels.update(target.id, payload);
      void queryClient.invalidateQueries({ queryKey: labelQueries.labelQueries.all() });
      closeForm();
    } catch (err) {
      queryClient.setQueryData(listKey, previous);
      console.error(err);
      notify(getErrorMessage(err, "Couldn't save label. Please try again."), "error");
    } finally {
      setIsSaving(false);
    }
  }, [closeForm, color, form, isSaving, listKey, name]);

  const cancelDelete = useCallback(() => {
    if (deleteBusy) return;
    setPendingDelete(null);
    setDeleteError(null);
  }, [deleteBusy]);

  const confirmDelete = useCallback(async () => {
    const target = pendingDelete;
    if (!target || deleteBusy) return;

    setDeleteBusy(true);
    setDeleteError(null);

    const previous = queryClient.getQueryData<Label[]>(listKey);
    queryClient.setQueryData<Label[]>(listKey, (existing) => (existing ?? []).filter((l) => l.id !== target.id));

    try {
      await apiClient.labels.delete(target.id);
      void queryClient.invalidateQueries({ queryKey: labelQueries.labelQueries.all() });
      // A label that's gone can't stay attached to a goal — the goal cards
      // and the Goals screen's label filter both read that join.
      void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
      setPendingDelete(null);
    } catch (err) {
      queryClient.setQueryData(listKey, previous);
      console.error(err);
      setDeleteError(getErrorMessage(err, "Please try again."));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy, listKey, pendingDelete]);

  return (
    <View>
      <SectionHeader
        label="Labels"
        count={data?.length}
        action={form === null ? <AddButton label="Add label" onPress={openCreate} /> : undefined}
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
          onAction={openCreate}
        />
      ) : (
        <View style={styles.rows}>
          {data.map((label, index) =>
            form?.mode === "edit" && form.entity.id === label.id ? (
              <EntityForm
                key={label.id}
                placeholder="Label name"
                accessibilityLabel="Label name"
                name={name}
                onChangeName={setName}
                color={color}
                onSelectColor={setColor}
                allowClearColor
                isSaving={isSaving}
                onCancel={closeForm}
                onSave={() => void handleSave()}
                cancelAccessibilityLabel="Cancel editing label"
                saveAccessibilityLabel="Save label changes"
              />
            ) : (
              <EntityRow
                key={label.id}
                index={index}
                // Label.color is optional in the shared type; fall back to the
                // theme's muted ink rather than inventing a color for it.
                color={label.color || colors.mutedForeground}
                name={label.name}
                slug={label.value}
                isDefault={label.isDefault}
                onEdit={() => openEdit(label)}
                editAccessibilityLabel={`Edit "${label.name}" label`}
                onDelete={() => setPendingDelete(label)}
                deleteAccessibilityLabel={`Delete "${label.name}" label`}
              />
            ),
          )}
        </View>
      )}

      {form?.mode === "create" ? (
        <EntityForm
          style={styles.formSpaced}
          placeholder="Label name"
          accessibilityLabel="Label name"
          name={name}
          onChangeName={setName}
          color={color}
          onSelectColor={setColor}
          allowClearColor
          isSaving={isSaving}
          onCancel={closeForm}
          onSave={() => void handleSave()}
          cancelAccessibilityLabel="Cancel adding label"
          saveAccessibilityLabel="Save label"
        />
      ) : null}

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete label?"
        description={pendingDelete ? `"${pendingDelete.name}" will be permanently removed.` : undefined}
        icon="trash"
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      />
    </View>
  );
}

/**
 * One category or label row. Both types render identically — same swatch,
 * name, slug, Default pill and edit/delete affordances — which is exactly how
 * the web treats them, so they share a component rather than being
 * copy-pasted.
 */
function EntityRow({
  index,
  color,
  name,
  slug,
  isDefault,
  onEdit,
  editAccessibilityLabel,
  onDelete,
  deleteAccessibilityLabel,
}: {
  index: number;
  color: string;
  name: string;
  slug: string;
  isDefault: boolean;
  onEdit: () => void;
  editAccessibilityLabel: string;
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
        onPress={onEdit}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={editAccessibilityLabel}
      >
        <Icon name="edit" size={16} color={colors.mutedForeground} />
      </Pressable>

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

interface EntityFormProps {
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
  /** Create mode renders below the list and needs its own top gap; an edit form sits inside the list's own gap. */
  style?: StyleProp<ViewStyle>;
}

/**
 * The name + color editor, shared by create and edit. Both
 * `Create*Form`/`Update*Form` pairs collect exactly these two fields, so
 * there's nothing for an edit-specific variant to add.
 */
function EntityForm({
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
  style,
}: EntityFormProps) {
  const disabled = !name.trim() || isSaving;

  return (
    <View style={[styles.form, style]}>
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
  flex: {
    flex: 1,
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

  // --- Create/edit form ---
  form: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formSpaced: {
    marginTop: spacing.md,
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
