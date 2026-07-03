/**
 * SmsPreviewPane — ORCH-1281 [marketing SMS wave 2].
 *
 * A phone-text-bubble preview of the SMS/MMS blast — the honest counterpart to
 * EmailPreviewPane (which is wrong for a text: brand banner, subject line,
 * "Unsubscribe" footer). Renders a dark "phone screen" with the brand-identity
 * sender header, a received grey bubble carrying the ACTUAL wire body (including
 * the auto-appended "Reply STOP to opt out." footer via `bodyWithFooter`), inline
 * link styling, and a live encoding/char/segment line — all from the SAME
 * `smsCost` single source of truth the composer + adapter use.
 *
 * Read-only (no interactive elements). Accessibility (I-39): the bubble Text
 * carries the full wire body as its accessibilityLabel; the image tile is
 * labelled "Attached photo preview".
 */

import React from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { bodyWithFooter, estimateSmsCost } from "../../utils/smsCost";

// Phone-canvas palette — a dark iMessage-like screen. Local constants (not
// design tokens) because this is a literal device chrome, not app UI.
const PHONE_CANVAS = "#0B0D12";
const RECEIVED_BUBBLE = "#26282E";
const BUBBLE_TEXT = "#F2F3F5";
const IMAGE_TILE_BG = "#1A1C22";

const URL_RE = /(https?:\/\/[^\s]+)/g;

export interface SmsPreviewPaneProps {
  /** Raw smsBody as typed (no footer — appended here via bodyWithFooter). */
  body: string;
  brandName: string | null;
  /** For the count line; may be null. */
  reachableSms: number | null;
  /** Brand default currency — reserved for a future cost line (SPEC §3.3). */
  currencyCode: string;
  /** ORCH-1282 — draw the MMS image tile(s) + MMS label. */
  hasMedia?: boolean;
  /**
   * ORCH-1289 — display uris for ALL attached photos (up to 10). Each is the
   * verified public URL once uploaded, or the local preview while uploading.
   * Cross-platform-renderable (prefer the public URL) so web + native both show
   * the same tiles that will be sent.
   */
  mediaUris?: (string | null)[];
}

/**
 * Split a string on URLs, wrapping matched spans in accent-underlined Text.
 * `String.split` with a single capturing group interleaves the captured URLs
 * at ODD indices, so parity is a stateless, reliable URL test (avoids the
 * lastIndex footgun of calling a global regex's `.test()` in a loop).
 */
function renderWithLinks(wire: string): React.ReactNode[] {
  const parts = wire.split(URL_RE);
  return parts.map((part, idx) => {
    if (part.length === 0) return null;
    const isUrl = idx % 2 === 1;
    return isUrl ? (
      <Text key={idx} style={styles.link}>
        {part}
      </Text>
    ) : (
      <Text key={idx}>{part}</Text>
    );
  });
}

export const SmsPreviewPane: React.FC<SmsPreviewPaneProps> = ({
  body,
  brandName,
  reachableSms,
  hasMedia = false,
  mediaUris = [],
}) => {
  const wire = bodyWithFooter(body);
  const isEmpty = body.trim().length === 0 && !hasMedia;
  const showCount = body.trim().length > 0 || hasMedia;
  const avatarLetter = (brandName ?? "Y").trim().charAt(0).toUpperCase() || "Y";

  const est = estimateSmsCost(body, reachableSms ?? 0, undefined, hasMedia);
  const countUnit = est.encoding === "MMS"
    ? "1 message"
    : `${est.segmentsPerRecipient} ${est.segmentsPerRecipient === 1 ? "segment" : "segments"}`;
  const countLine = `${est.encoding} · ${est.charCount} chars · ${countUnit}`;

  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Sender header — brand identity (NOT a fabricated verified number). */}
      <View style={styles.senderRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>{avatarLetter}</Text>
        </View>
        <View style={styles.senderLabelCol}>
          <Text style={styles.senderName} numberOfLines={1}>
            {brandName ?? "Your brand"}
          </Text>
          <Text style={styles.senderCaption}>
            {hasMedia ? "Picture message · MMS" : "Text message · SMS"}
          </Text>
        </View>
      </View>

      {/* Received bubble — the buyer's inbound view. */}
      {isEmpty ? (
        <View style={styles.bubble}>
          <Text style={styles.emptyText}>
            Start typing your text to preview it.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.bubble}>
            {/* ORCH-1289 — render ALL attached photos (MMS carries up to 10). */}
            {hasMedia
              ? mediaUris.map((uri, idx) =>
                  uri !== null && uri.length > 0 ? (
                    <Image
                      key={`${idx}-${uri}`}
                      source={{ uri }}
                      style={styles.imageTile}
                      resizeMode="cover"
                      accessibilityLabel="Attached photo preview"
                    />
                  ) : null,
                )
              : null}
            <Text
              style={styles.bubbleText}
              accessibilityLabel={wire}
            >
              {renderWithLinks(wire)}
            </Text>
          </View>
          <Text style={styles.linkCaption}>
            Links become trackable Mingla links.
          </Text>
        </>
      )}

      {showCount ? <Text style={styles.countLine}>{countLine}</Text> : null}

      <Text style={styles.footerNote}>
        Preview only — carriers render texts slightly differently. The send loop
        is the source of truth.
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: PHONE_CANVAS,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  senderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  senderLabelCol: {
    flex: 1,
  },
  senderName: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  senderCaption: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  bubble: {
    alignSelf: "flex-start",
    maxWidth: "84%",
    backgroundColor: RECEIVED_BUBBLE,
    borderRadius: 20,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  imageTile: {
    width: "100%",
    aspectRatio: 4 / 3,
    maxHeight: 220,
    borderRadius: 12,
    backgroundColor: IMAGE_TILE_BG,
  },
  bubbleText: {
    ...typography.body,
    color: BUBBLE_TEXT,
    lineHeight: 21,
  },
  link: {
    color: accent.warm,
    textDecorationLine: "underline",
  },
  emptyText: {
    ...typography.body,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  linkCaption: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  countLine: {
    ...typography.bodySm,
    color: textTokens.secondary,
    textAlign: "center",
  },
  footerNote: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    textAlign: "center",
    fontStyle: "italic",
  },
});
