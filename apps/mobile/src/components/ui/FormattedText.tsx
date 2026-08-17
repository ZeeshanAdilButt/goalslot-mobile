// Renders the markdown in a Coach reply as real RN Text/View elements
// instead of dumping the raw markdown characters on screen.
//
// The grammar itself lives in `./markdown-lite.ts` (pure, unit-tested); this
// file is only the RN mapping from parsed blocks/spans to styled elements.
// See that file's header for WHY there's no markdown library here (short
// version: web's `react-markdown` is DOM-only and cannot run in RN) and for
// the exact list of constructs that are and aren't supported.
//
// Every style below comes from `@/theme/tokens` rather than ad-hoc numbers,
// so a heading inside a Coach bubble reads as this app's own section header
// — `typography.h2` is literally the token web's Coach markdown maps `###`
// to (`text-sm font-semibold uppercase tracking-wider text-zinc-500`).
//
// Used by app/(app)/coach.tsx, app/(app)/voice.tsx and
// src/components/coach/CoachHistorySheet.tsx — all three render the same
// Coach reply text and had the identical raw-markdown bug independently,
// which is why this lives as a shared primitive rather than a private helper
// in any one screen. Because the fix is client-side, it also repairs
// already-archived turns replayed by CoachHistorySheet, which no change to
// the model's system prompt could do.

import { Fragment, useMemo } from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";

import { colors, spacing, typography } from "@/theme/tokens";

import { isSafeHref, parseBlocks, type Block, type InlineSpan } from "./markdown-lite";

export { toPlainText } from "./markdown-lite";

export interface FormattedTextProps {
  text: string;
  /** Applied to every text run; block styles layer on top of it. */
  style: TextStyle;
}

export function FormattedText({ text, style }: FormattedTextProps) {
  // Coach replies stream in token by token, so this component re-renders with
  // a slightly longer string many times per reply — and it does so inside a
  // list row. Memoising on the text keeps that a single parse per token
  // rather than one per render of every mounted bubble.
  const blocks = useMemo(() => parseBlocks(text), [text]);

  return (
    <View>
      {blocks.map((block, index) => renderBlock(block, index, blocks[index - 1], style))}
    </View>
  );
}

function renderBlock(
  block: Block,
  index: number,
  previous: Block | undefined,
  style: TextStyle,
) {
  switch (block.type) {
    case "heading": {
      // Two visual tiers, matching web's mapping (h1/h2 → one treatment,
      // h3-h6 → the small uppercase one). `typography.h1` rather than a
      // 16px semibold: the Coach bubble's body copy is ALREADY 16px, so a
      // 16px heading would differ from body by weight alone and barely read
      // as a heading at all.
      const headingStyle: StyleProp<TextStyle> =
        block.level <= 2
          ? [style, typography.h1, styles.headingMajor]
          : [style, typography.h2, styles.headingMinor];
      return (
        <Text
          key={index}
          style={[headingStyle, index > 0 && styles.headingSpaced, styles.headingBottom]}
        >
          {renderSpans(block.spans, headingStyle)}
        </Text>
      );
    }
    case "bullet":
    case "ordered": {
      // Consecutive list items are one list, but the rows carried no vertical
      // gap of their own: two items sat back to back with nothing but their
      // text's line-height between them, reading as one run-on block. A small
      // gap ONLY between two adjacent rows (never before the first) keeps the
      // list grouped while letting each item read as its own line.
      const followsItem = previous?.type === "bullet" || previous?.type === "ordered";
      const glyph = block.type === "bullet" ? "•" : `${block.marker}.`;
      return (
        <View
          key={index}
          style={[
            styles.bulletRow,
            followsItem && styles.bulletRowSpaced,
            block.depth > 0 && { paddingLeft: block.depth * spacing.md },
          ]}
        >
          <Text style={[style, styles.bulletGlyph]}>{glyph}</Text>
          <Text style={[style, styles.bulletText]}>{renderSpans(block.spans, style)}</Text>
        </View>
      );
    }
    case "quote": {
      const quoteStyle: StyleProp<TextStyle> = [style, styles.quoteText];
      return (
        <View key={index} style={styles.quoteRow}>
          <Text style={quoteStyle}>{renderSpans(block.spans, quoteStyle)}</Text>
        </View>
      );
    }
    case "rule":
      return <View key={index} style={styles.rule} />;
    // A blank line is a paragraph break with real height, not a Text node
    // with nothing in it (which some RN text-measuring paths collapse).
    case "gap":
      return <View key={index} style={styles.paragraphGap} />;
    default:
      return (
        <Text key={index} style={style}>
          {renderSpans(block.spans, style)}
        </Text>
      );
  }
}

/** Formatted runs within one line. `baseStyle` is the containing block's style, so a bold span inside a heading stays heading-sized. */
function renderSpans(spans: InlineSpan[], baseStyle: StyleProp<TextStyle>) {
  return spans.map((span, index) => {
    switch (span.type) {
      case "bold":
        return (
          <Text key={index} style={[baseStyle, styles.bold]}>
            {span.text}
          </Text>
        );
      case "italic":
        return (
          <Text key={index} style={[baseStyle, styles.italic]}>
            {span.text}
          </Text>
        );
      case "code":
        return (
          <Text key={index} style={[baseStyle, styles.code]}>
            {span.text}
          </Text>
        );
      case "link":
        // Unsafe/relative targets keep the label but lose the affordance —
        // see `isSafeHref`. A failed open is swallowed: there is nothing the
        // user could do about it, and this app never raises a native alert.
        return isSafeHref(span.href) ? (
          <Text
            key={index}
            style={[baseStyle, styles.link]}
            accessibilityRole="link"
            onPress={() => {
              void Linking.openURL(span.href).catch(() => {});
            }}
          >
            {span.text}
          </Text>
        ) : (
          <Fragment key={index}>{span.text}</Fragment>
        );
      default:
        return <Fragment key={index}>{span.text}</Fragment>;
    }
  });
}

const styles = StyleSheet.create({
  bold: {
    fontWeight: "700",
  },
  italic: {
    fontStyle: "italic",
  },
  // RN can't give an inline span a border-radius, so an inline code run gets
  // the mono face and a muted wash and nothing else.
  code: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    backgroundColor: colors.muted,
  },
  // `colors.primaryText` (#A16207), not the raw brand yellow — foundation.ts
  // documents at that token that #F2CC0D fails contrast as text. Web's Coach
  // markdown made the same substitution.
  link: {
    color: colors.primaryText,
    textDecorationLine: "underline",
  },
  headingMajor: {
    color: colors.foreground,
  },
  headingMinor: {
    color: colors.mutedForeground,
  },
  // Air above a heading, but never above the first block — a reply that opens
  // with a heading shouldn't start with a gap inside the bubble.
  headingSpaced: {
    marginTop: spacing.md,
  },
  headingBottom: {
    marginBottom: spacing.xs,
  },
  bulletRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  // See the `followsItem` comment above — only applied between two adjacent
  // list items, never before the list's first line.
  bulletRowSpaced: {
    marginTop: spacing.xs,
  },
  bulletGlyph: {
    // Nudges the glyph up slightly to sit on the same baseline as the first
    // line of item text rather than reading as a separate small element.
    marginTop: 1,
  },
  bulletText: {
    flex: 1,
  },
  quoteRow: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: spacing.sm,
    marginVertical: spacing.xs,
  },
  quoteText: {
    color: colors.mutedForeground,
    fontStyle: "italic",
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  // A paragraph break has to read as more air than the line-height already
  // gives a wrapped line within one paragraph, or it doesn't read as a break
  // at all. `spacing.sm` (8) rather than `spacing.xs` (4) — sized against the
  // callers' bubble text (16px/24 line-height, see coach.tsx's and voice.tsx's
  // `bubbleTextAssistant`/`replyText`), where 4px nearly disappeared against
  // that much larger leading.
  paragraphGap: {
    height: spacing.sm,
  },
});
