// Search/filter logic for CategoryAutocomplete — same plain-substring
// convention as timer/tracking-search.ts (see that file's header), extracted
// for the same reason: the matching rule is worth unit-testing without
// mounting the component tree.

import type { Category } from "@goalslot/shared";

/** Trimmed + lowercased, the form the matcher compares against. */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Categories whose name contains `query`. An empty query returns every
 * category as-is — that's what backs "browse everything" when the field is
 * focused but nothing has been typed yet, not just a narrowed search result.
 */
export function filterCategories(categories: Category[], query: string): Category[] {
  const needle = normalizeQuery(query);
  if (!needle) return categories;
  return categories.filter((category) => category.name.toLowerCase().includes(needle));
}
