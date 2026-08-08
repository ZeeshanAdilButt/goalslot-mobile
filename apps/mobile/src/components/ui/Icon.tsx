// Single source of truth for iconography across the app. Wraps lucide-react-native
// so every screen pulls icons through one named set instead of importing icon
// components ad hoc — that's what keeps the app visually consistent (one family,
// one stroke weight) instead of accumulating a mix of icon packs over time.
//
// lucide-react-native was chosen over @expo/vector-icons for two reasons:
//   1. Visual parity — the web app (dw-time-web) uses `lucide-react` throughout
//      (see src/components/app-sidebar.tsx, src/app/dashboard/settings/page.tsx),
//      so matching the family here makes mobile read as the same product instead
//      of a different app with different icons for the same concepts.
//   2. Zero new native surface — it renders through `react-native-svg`, which is
//      already an installed dependency (required by @gorhom/bottom-sheet), so
//      adding it doesn't introduce a new native module or require a rebuild.
//
// Icon names below are deliberately mapped 1:1 to what the web app uses for the
// same concept where a web equivalent exists (Today≈Dashboard, Schedule,
// Goals, Tasks, Timer≈Time Tracker, Reports, Categories, Settings, and the
// common action/util icons from settings/coach/categories pages). `journal`
// has no direct lucide match for web's custom FeatherPenIcon, so it uses the
// closest stock lucide icon (NotebookPen) rather than pulling in a one-off SVG.
import {
  BarChart3,
  Calendar,
  Check,
  CheckSquare,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Flag,
  LayoutDashboard,
  LogOut,
  NotebookPen,
  Pencil,
  Plus,
  Settings,
  Tag,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react-native";
import type { ColorValue } from "react-native";

import { colors } from "@/theme/tokens";

const ICONS = {
  today: LayoutDashboard,
  schedule: Calendar,
  goals: Flag,
  tasks: CheckSquare,
  timer: Clock,
  settings: Settings,
  reports: BarChart3,
  categories: Tag,
  journal: NotebookPen,
  add: Plus,
  close: X,
  chevron: ChevronRight,
  check: Check,
  trash: Trash2,
  edit: Pencil,
  eye: Eye,
  "eye-off": EyeOff,
  logout: LogOut,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  // ColorValue (not just `string`) so tab-bar tint colors — which React
  // Navigation types as ColorValue/OpaqueColorValue — can be passed straight
  // through without a cast.
  color?: ColorValue;
}

// `size` defaults to lucide's own default (24). `color` defaults to the
// theme's foreground token rather than lucide's own "currentColor" default —
// that's a CSS keyword with no meaning in react-native-svg, so leaving it
// unset here would render icons in an undefined/black color instead of
// something themed. Every call site we actually use passes color explicitly
// anyway (tab bar tint, action rows, etc).
export function Icon({ name, size = 24, color = colors.foreground }: IconProps) {
  const LucideIconComponent = ICONS[name];
  return <LucideIconComponent size={size} color={color} />;
}
