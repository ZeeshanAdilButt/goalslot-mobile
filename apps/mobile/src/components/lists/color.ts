// Data-driven color math for list rows.
//
// WHY this exists: the web app tints a chip's surface straight off the
// entity's OWN color rather than off a palette — see
// dw-time-web/src/features/tasks/components/task-list-item/task-metadata.tsx:13,
// which builds `{ borderColor: goal.color, backgroundColor: `${goal.color}18` }`.
// That trick (append two hex digits of alpha) is a DOM-only convenience:
// React Native's Android color parser has historically been unreliable with
// 8-digit hex, so the same intent is expressed here as a real `rgba()`
// string. Keeping it in one helper also means a category/goal/label color
// coming back from the API malformed degrades to a theme token instead of
// crashing a StyleSheet.

/** Parsed sRGB channels, or null when the input isn't a hex color. */
function parseHex(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().replace(/^#/, "");
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(0, 6);
  if (expanded.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

/**
 * Soft tint of an entity color, for chip/badge/accent backgrounds.
 * `fallback` must be a theme token — it's what shows when the entity has no
 * color (labels make `color` optional) or the API returned something we
 * can't parse.
 */
export function withAlpha(color: string | null | undefined, alpha: number, fallback: string): string {
  if (!color) return fallback;
  const rgb = parseHex(color);
  if (!rgb) return fallback;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** The entity color itself, or a theme token when it's missing/unparseable. */
export function safeColor(color: string | null | undefined, fallback: string): string {
  if (!color) return fallback;
  return parseHex(color) ? color : fallback;
}

/**
 * Whether text sitting ON `color` should be dark. Uses the WCAG relative
 * luminance threshold rather than a naive average so mid-tone swatches
 * (the preset palette has several) don't land on unreadable white text.
 */
export function prefersDarkTextOn(color: string | null | undefined): boolean {
  const rgb = color ? parseHex(color) : null;
  if (!rgb) return true;
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  return luminance > 0.45;
}
