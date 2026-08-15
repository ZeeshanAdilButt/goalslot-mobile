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
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  BellOff,
  Calendar,
  CalendarOff,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  CreditCard,
  Eye,
  EyeOff,
  Flag,
  Inbox,
  Info,
  Key,
  KeyRound,
  Keyboard,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  MessageSquareText,
  Menu,
  Mic,
  MicOff,
  NotebookPen,
  Pencil,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  StickyNote,
  Plus,
  Settings,
  Tag,
  Trash2,
  User,
  Users,
  WifiOff,
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
  // Coach AI chat and Notes — both reachable from the navigation drawer.
  coach: MessageSquareText,
  // Person-to-person messaging, distinct from `coach` (the AI chat): a
  // stacked pair of bubbles rather than one, so the drawer's two
  // conversational entries aren't the same glyph twice.
  messages: MessagesSquare,
  notes: StickyNote,
  // The Mentees screen (people who've shared their data with you) and the
  // instructions you can assign them, both new alongside it.
  mentees: Users,
  instructions: ClipboardList,
  add: Plus,
  // Opens the navigation drawer — see app/(app)/_layout.tsx's hamburger.
  menu: Menu,
  close: X,
  chevron: ChevronRight,
  check: Check,
  trash: Trash2,
  edit: Pencil,
  eye: Eye,
  "eye-off": EyeOff,
  logout: LogOut,
  // Added for the shared state primitives (EmptyState/ErrorState) and the
  // navigation drawer, which previously drew their marks as literal text
  // glyphs ("✕") or fell back to the GoalSlot logo for every empty screen.
  // Same 1:1-with-web rule as the names above: `sparkles` is what
  // app-sidebar.tsx uses for What's New, `search`/`inbox`/`user`/
  // `chevron-down`/`chevron-left`/`arrow-right` are the stock lucide glyphs
  // web reaches for in the same situations.
  inbox: Inbox,
  search: Search,
  sparkles: Sparkles,
  alert: AlertTriangle,
  refresh: RefreshCw,
  "arrow-right": ArrowRight,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "calendar-off": CalendarOff,
  user: User,
  bell: Bell,
  "bell-off": BellOff,
  // Added for the Settings screen's section rows. Same 1:1-with-web rule as
  // above — these are the exact glyphs dw-time-web's settings page hangs off
  // its sidebar tabs (src/app/dashboard/settings/page.tsx:9,29-40): Shield
  // for Security, KeyRound for Integrations, Key for the change-password
  // form's heading, CreditCard for Billing.
  shield: Shield,
  key: Key,
  "key-round": KeyRound,
  "credit-card": CreditCard,
  // Voice control. `mic-off` is not a mute toggle — it's the resting mark
  // for the two states where the microphone cannot be used at all
  // (permission refused, no recognizer on the device), which need to look
  // visibly different from an idle mic rather than merely dimmer.
  mic: Mic,
  "mic-off": MicOff,
  // The Voice tab's "Type instead" dock action — the keyboard-entry
  // alternative to speaking a command, so it gets a glyph distinct from
  // `coach` (the AI-chat bubble icon used for Coach itself elsewhere).
  keyboard: Keyboard,
  // Added for the app-wide connectivity pill (src/components/ConnectivityPill.tsx)
  // — previously only messaging's own OfflineBanner said anything about
  // connectivity, and it drew no icon at all.
  "wifi-off": WifiOff,
  // Settings screen's "About" row — a neutral glyph for read-only build info.
  info: Info,
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
