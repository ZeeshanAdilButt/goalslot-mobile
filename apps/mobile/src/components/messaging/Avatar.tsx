// Initial-in-a-circle avatar, matching the one the navigation drawer's
// footer already draws (DrawerContent.tsx's `avatar` style, ported from web's
// app-sidebar.tsx:288 — zinc-900 fill, white initial, zinc-100 ring). Pulled
// out as a component here because messaging renders one per conversation row
// and one in the thread header, and a chat screen without avatars reads as a
// log file rather than as people.
//
// Colour is deliberately NOT derived from the person: a per-user hue would be
// a new colour system competing with the category/goal colours that already
// carry meaning in this app (see lists/ListCard's restraint note). Everyone
// gets the same neutral disc; the name does the identifying.
//
// Hidden from assistive tech — the row/header it sits in already announces
// the person's name, and "Z, Zoe Adeyemi" is noise.

import { StyleSheet, Text, View } from "react-native";

import { colors, radii, typography } from "@/theme/tokens";

export interface AvatarProps {
  name: string;
  size?: number;
  /** Quiet variant for a row that already has a stronger focal point. */
  tone?: "solid" | "muted";
}

/** First character of the name, uppercased. "?" when there is nothing to show. */
export function avatarInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

export function Avatar({ name, size = 44, tone = "solid" }: AvatarProps) {
  return (
    <View
      style={[
        styles.avatar,
        tone === "muted" && styles.avatarMuted,
        { width: size, height: size, borderRadius: radii.pill },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        style={[styles.initial, tone === "muted" && styles.initialMuted, { fontSize: Math.round(size * 0.4) }]}
        // The disc is sized in points, so a large system font must not push
        // the glyph outside it.
        allowFontScaling={false}
      >
        {avatarInitial(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.foreground,
    borderWidth: 2,
    borderColor: colors.secondary,
  },
  avatarMuted: {
    backgroundColor: colors.secondary,
    borderColor: colors.border,
  },
  initial: {
    ...typography.title,
    color: colors.white,
  },
  initialMuted: {
    color: colors.mutedForeground,
  },
});
