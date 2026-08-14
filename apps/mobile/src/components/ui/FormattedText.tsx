// Renders the light markdown the Coach's replies actually use — **bold**
// spans and `* `/`- ` bullet lines — as real RN Text/View elements instead
// of dumping the raw markdown characters on screen.
//
// WHY NOT A LIBRARY: neither this app nor its web sibling has a markdown
// renderer installed anywhere, and the Coach's own replies only ever use
// two constructs (bold spans and a flat bullet list — confirmed against the
// "Calculatus"/"Learning Arabic" reply that surfaced this bug: `**2 minutes
// for 'Learning Arabic'**`, `*   **20 minutes** on August 11th.`). Pulling
// in a full CommonMark renderer for two constructs is a much bigger
// dependency (and, for most such libraries, an unnecessary bundle-size and
// native-linking risk) than this file, which is plain RN primitives.
//
// Used by both apps/mobile/app/(app)/coach.tsx and apps/mobile/app/(app)/
// voice.tsx — both render the same Coach reply text and had the identical
// bug (a bare `<Text>{cleaned}</Text>`, asterisks and all) independently,
// which is why this lives as a shared primitive rather than a private
// helper in either screen.

import { Fragment } from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";

import { spacing } from "@/theme/tokens";

export interface FormattedTextProps {
  text: string;
  /** Applied to every text run (bold spans included — only fontWeight changes). */
  style: TextStyle;
}

/** A line counts as a bullet if it opens with markdown's two common bullet markers, one level of indentation tolerated. */
const BULLET_LINE_RE = /^\s{0,3}[*-]\s+(.*)$/;

export function FormattedText({ text, style }: FormattedTextProps) {
  const lines = text.split("\n");

  return (
    <View>
      {lines.map((line, index) => {
        const bulletMatch = BULLET_LINE_RE.exec(line);
        // Consecutive "- "/"* " lines are one flat list (the Coach's system
        // prompt only ever emits plain dash bullets — see this file's header
        // comment), but the row itself carried no vertical gap of its own:
        // two list items sat back to back with nothing but their own text's
        // line-height between them, which read as one run-on block rather
        // than a set of distinct items. A small gap ONLY between two bullet
        // rows in a row (never before the first one) keeps a list visually
        // grouped while still letting each item read as its own line.
        const previousLine = index > 0 ? lines[index - 1] : null;
        const followsBullet = previousLine !== null && BULLET_LINE_RE.test(previousLine);
        if (bulletMatch) {
          return (
            <View key={index} style={[styles.bulletRow, followsBullet && styles.bulletRowSpaced]}>
              <Text style={[style, styles.bulletGlyph]}>{"•"}</Text>
              <Text style={[style, styles.bulletText]}>{renderBoldSpans(bulletMatch[1], style)}</Text>
            </View>
          );
        }
        // An empty line is a paragraph break — real height, not a Text node
        // with nothing in it (which some RN text-measuring paths collapse).
        if (line.length === 0) {
          return <View key={index} style={styles.paragraphGap} />;
        }
        return (
          <Text key={index} style={style}>
            {renderBoldSpans(line, style)}
          </Text>
        );
      })}
    </View>
  );
}

/** Splits `**bold**` spans out of one line, returning plain strings interleaved with bolded <Text> runs. */
function renderBoldSpans(line: string, baseStyle: TextStyle) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter((part) => part.length > 0);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <Text key={i} style={[baseStyle, styles.bold]}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const styles = StyleSheet.create({
  bold: {
    fontWeight: "700",
  },
  bulletRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  // See the `followsBullet` comment above — only applied between two
  // adjacent list items, never before the list's first line.
  bulletRowSpaced: {
    marginTop: spacing.xs,
  },
  bulletGlyph: {
    // Nudges the glyph up slightly to sit on the same baseline as the first
    // line of bullet text rather than reading as a separate small element.
    marginTop: 1,
  },
  bulletText: {
    flex: 1,
  },
  // A paragraph break has to read as more air than the line-height already
  // gives a wrapped line within one paragraph, or it doesn't read as a break
  // at all. `spacing.sm` (8) rather than the old `spacing.xs` (4) — sized
  // against the callers' bubble text (16px/24 line-height, see coach.tsx's
  // and voice.tsx's `bubbleTextAssistant`/`replyText`), where 4px nearly
  // disappeared against that much larger leading.
  paragraphGap: {
    height: spacing.sm,
  },
});
