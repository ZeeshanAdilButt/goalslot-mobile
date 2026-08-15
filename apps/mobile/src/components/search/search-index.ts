// The static "go anywhere" index behind the top search bar (see
// SearchOverlay.tsx) and its matching rules.
//
// SCOPE, FIRST PASS: screen/section navigation only, not in-app content. A
// result always lands on a whole screen (Settings, Reports, Coach AI, …),
// never a specific goal/task/note by name — that would mean indexing live
// user data, not this fixed list, and is deliberately deferred rather than
// silently missing (see SearchOverlay.tsx's header).
//
// Settings' own sub-sections (profile, password, plan, AI key, coach
// profile, delete account, notifications) are NOT separate routes — they're
// sheets opened from local state inside app/(app)/settings.tsx — so they're
// modelled here as extra `keywords` on the single "Settings" item rather
// than as items with their own href. Searching "password" surfaces Settings,
// same as searching "Settings" would; it lands on the screen, not the sheet.
//
// Matching mirrors components/timer/tracking-search.ts: plain
// case/whitespace-insensitive substring matching across a fixed set of
// fields, no fuzzy/typo-tolerant scoring. That module's own header is the
// reasoning for staying with substring matching rather than reaching for a
// scored/fuzzy algorithm — a small, fixed list like this one doesn't need it,
// and it keeps the result order predictable (list order, not a relevance
// score that can reshuffle between keystrokes).

import { messagingEnabled } from "@/lib/messaging-config";
import type { IconName } from "@/components/ui/Icon";

export type SearchHref =
  | "/"
  | "/schedule"
  | "/goals"
  | "/tasks"
  | "/timer"
  | "/reports"
  | "/categories"
  | "/journal"
  | "/notes"
  | "/messages"
  | "/mentees"
  | "/coach"
  | "/settings";

export interface SearchItem {
  id: string;
  label: string;
  href: SearchHref;
  icon: IconName;
  /** Shown under the label in a result row. */
  description: string;
  /** Optional section heading for the no-query "browse everything" list, mirroring DrawerContent's NAV_GROUPS. */
  group?: string;
  /** Extra terms a query can match beyond the label/description — see this file's header on Settings. */
  keywords?: string[];
}

// Order and grouping mirror DrawerContent's NAV_GROUPS — same IA, so the
// browse list (empty query) reads as the same app the drawer already shows,
// not a second, differently-organized index of it.
const ALL_ITEMS: SearchItem[] = [
  { id: "today", label: "Today", href: "/", icon: "today", description: "Your plan for today" },
  { id: "journal", label: "Journal", href: "/journal", icon: "journal", description: "Your daily writing entries", keywords: ["write", "entry", "reflect"] },
  { id: "goals", label: "Goals", href: "/goals", icon: "goals", description: "Long-term targets you're tracking", group: "Plan" },
  { id: "schedule", label: "Schedule", href: "/schedule", icon: "schedule", description: "Plan your week", group: "Plan" },
  { id: "tasks", label: "Tasks", href: "/tasks", icon: "tasks", description: "What's on your list", group: "Do" },
  { id: "timer", label: "Timer", href: "/timer", icon: "timer", description: "Track time against a goal or task", group: "Do", keywords: ["time tracker", "tracking", "stopwatch"] },
  { id: "coach", label: "Coach AI", href: "/coach", icon: "coach", description: "Chat with your AI coach", group: "Reflect", keywords: ["ai coach", "chat", "assistant"] },
  { id: "notes", label: "Notes", href: "/notes", icon: "notes", description: "Freeform notes", group: "Workspace" },
  ...(messagingEnabled
    ? ([
        { id: "messages", label: "Messages", href: "/messages", icon: "messages", description: "Conversations", group: "Workspace" },
      ] as SearchItem[])
    : []),
  { id: "mentees", label: "Sharing", href: "/mentees", icon: "mentees", description: "People sharing their progress with you", group: "Workspace", keywords: ["sharing", "mentor", "mentorship", "mentees"] },
  { id: "reports", label: "Reports", href: "/reports", icon: "reports", description: "Weekly stats and trends", group: "Workspace" },
  { id: "categories", label: "Categories", href: "/categories", icon: "categories", description: "The colors your goals and tasks group by", group: "Workspace", keywords: ["labels", "colors", "tags"] },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: "settings",
    description: "Your profile, security and preferences",
    group: "Workspace",
    // See this file's header — every settings sub-section is a keyword here,
    // not a separate item, since none of them are their own route.
    keywords: [
      "profile",
      "password",
      "change password",
      "security",
      "account",
      "plan",
      "billing",
      "subscription",
      "ai key",
      "ai provider",
      "integrations",
      "coach profile",
      "delete account",
      "notifications",
      "push notifications",
      "logout",
      "sign out",
      "preferences",
    ],
  },
];

/** The full index, already filtered for build-time-disabled features (Messages). */
export function getSearchItems(): SearchItem[] {
  return ALL_ITEMS;
}

/** Trimmed + lowercased, the form matching compares against. */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

function matchesAny(fields: (string | undefined)[], needle: string): boolean {
  return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(needle));
}

/**
 * Items matching `query` across label, description and keywords. An empty
 * query returns every item untouched — same "no search means show
 * everything" rule tracking-search.ts's filterGoals/filterTasks apply.
 */
export function filterSearchItems(items: SearchItem[], query: string): SearchItem[] {
  const needle = normalizeSearchQuery(query);
  if (!needle) return items;
  return items.filter((item) => matchesAny([item.label, item.description, ...(item.keywords ?? [])], needle));
}
