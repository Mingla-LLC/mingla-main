/**
 * EmailPreviewPane — full visual mirror of the email the buyer will see
 * in their inbox. Renders the brand-shell frame (rounded white card with
 * subtle border, sitting on a light-gray "inbox" canvas), the brand-cover
 * banner OR Mingla logo header, the variable-substituted body, inline
 * event cards (visually mirroring the server-side HTML render), and the
 * unsubscribe footer.
 *
 * Not byte-identical to the actual Resend send (that's only achievable
 * with WebView + server-render — see marketingEmailRender.renderShell),
 * but visually faithful enough that operators can judge layout, hierarchy,
 * and copy before flipping LIVE=true. Any real drift surfaces in the next
 * inbox send; the operator stays in control via the still-available
 * "Send now" loop.
 *
 * Design tokens mirror the server-side Mingla card design (cream → orange
 * gradient, accent bar with "FEATURED EVENT" kicker, dark date pill +
 * orange-tinted location pill, large dark title, prominent CTA).
 */

import React from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  previewBlocks,
  type PreviewVariables,
} from "../../services/marketing/marketingRenderingService";

// Mingla email design tokens — must match `_shared/email/shell.ts` and
// `_shared/marketingEmailRender.ts` server-side.
const INBOX_CANVAS = "#F5F5F7";
const FRAME_BG = "#FFFFFF";
const FRAME_BORDER = "#ECECEE";
const INK = "#0F1115";
const INK_DEEP = "#16110D";
const MUTED = "#5B6172";
const CREAM = "#FFF7EF";
const CREAM_DEEP = "#FFE3C8";
const ORANGE = "#F47C20";
const ORANGE_MUTED = "#9A430D";
const ORANGE_TINT = "rgba(244,124,32,0.18)";
const ORANGE_BORDER = "rgba(244,124,32,0.22)";

export interface PreviewEmbeddedEvent {
  id: string;
  title: string;
  date_label?: string | null;
  cover_image_url?: string | null;
  /** Skips cover img when `'video'` — mirrors socialPreview.js rule. */
  cover_media_type?: "image" | "video" | "gif" | null;
  location_label?: string | null;
}

export interface EmailPreviewPaneProps {
  subject: string;
  bodyHtml: string;
  variables: PreviewVariables;
  brandName: string | null;
  /**
   * Optional brand cover image — when set AND not a video, renders as a
   * full-width banner at the top of the email frame (replacing the
   * centered Mingla logo). Matches the server-side `brand_header_image_url`
   * behaviour exactly.
   */
  brandHeaderImageUrl?: string | null;
  /**
   * Optional event detail map (id → metadata) so event-card tokens in the
   * body can render with real title / date / cover. When an event id in
   * the body has no entry here, the card renders as a "Featured event"
   * placeholder so the layout doesn't break.
   */
  embeddedEvents?: ReadonlyArray<PreviewEmbeddedEvent>;
}

export const EmailPreviewPane: React.FC<EmailPreviewPaneProps> = ({
  subject,
  bodyHtml,
  variables,
  brandName,
  brandHeaderImageUrl,
  embeddedEvents = [],
}) => {
  const blocks = previewBlocks(bodyHtml, variables);
  const useBrandBanner = brandHeaderImageUrl !== null &&
    brandHeaderImageUrl !== undefined &&
    brandHeaderImageUrl.length > 0;
  const eventLookup = new Map<string, PreviewEmbeddedEvent>();
  for (const e of embeddedEvents) eventLookup.set(e.id, e);

  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Email client header strip — "From / Subject" feel */}
      <View style={styles.emailHeader}>
        <Text style={styles.emailHeaderLabel}>FROM</Text>
        <Text style={styles.emailHeaderValue} numberOfLines={1}>
          {brandName !== null ? `${brandName} via Mingla` : "Your brand via Mingla"}
        </Text>
        <View style={styles.emailHeaderDivider} />
        <Text style={styles.emailHeaderLabel}>SUBJECT</Text>
        <Text style={styles.emailHeaderSubject} numberOfLines={2}>
          {subject.length > 0 ? subject : "(no subject yet)"}
        </Text>
      </View>

      {/* The "email card" — white frame with rounded corners, mirrors the
          server-side renderShell() output. */}
      <View style={styles.emailFrame}>
        {/* Header row: brand cover banner OR centered Mingla logo */}
        {useBrandBanner ? (
          <Image
            source={{ uri: brandHeaderImageUrl as string }}
            style={styles.brandBanner}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.miniglaLogoRow}>
            <Text style={styles.miniglaLogo}>Mingla</Text>
          </View>
        )}

        {/* Body region — interleaved paragraphs and event cards */}
        <View style={styles.bodyRegion}>
          {blocks.length === 0 ? (
            <Text style={styles.placeholder}>
              (start typing in the body field to preview your email)
            </Text>
          ) : (
            blocks.map((block, idx) => {
              if (block.kind === "paragraph") {
                return (
                  <Text key={idx} style={styles.paragraph}>
                    {block.content}
                  </Text>
                );
              }
              const event = eventLookup.get(block.content);
              return (
                <PreviewEventCard
                  key={`${block.content}:${idx}`}
                  event={event}
                />
              );
            })
          )}
        </View>

        {/* Footer — unsubscribe + brand name disclosure */}
        <View style={styles.footer}>
          <Text style={styles.footerLine}>
            You're receiving this because you bought tickets from{" "}
            <Text style={styles.footerBrand}>
              {brandName ?? "this brand"}
            </Text>{" "}
            on Mingla.
          </Text>
          <Text style={styles.footerLine}>
            <Text style={styles.footerUnsubscribe}>Unsubscribe</Text> · Mingla honours this across all your purchases.
          </Text>
        </View>
      </View>

      <Text style={styles.previewNote}>
        Preview — the actual sent email may differ slightly in your buyer's
        inbox (font rendering, dark-mode handling). The send loop is the
        source of truth.
      </Text>
    </ScrollView>
  );
};

interface PreviewEventCardProps {
  event?: PreviewEmbeddedEvent;
}

const PreviewEventCard: React.FC<PreviewEventCardProps> = ({ event }) => {
  const hasUsableCover = event?.cover_image_url !== null &&
    event?.cover_image_url !== undefined &&
    event.cover_image_url.length > 0 &&
    event.cover_media_type !== "video";

  return (
    <View style={cardStyles.card}>
      {hasUsableCover && event !== undefined ? (
        <Image
          source={{ uri: event.cover_image_url as string }}
          style={cardStyles.cover}
          resizeMode="cover"
        />
      ) : null}
      <View style={cardStyles.body}>
        {/* Kicker row: orange bar + "FEATURED EVENT" */}
        <View style={cardStyles.kickerRow}>
          <View style={cardStyles.kickerBar} />
          <Text style={cardStyles.kickerLabel}>FEATURED EVENT</Text>
        </View>
        {/* Date + location chips */}
        {event?.date_label || event?.location_label ? (
          <View style={cardStyles.chipsRow}>
            {event?.date_label ? (
              <Text style={cardStyles.dateChip}>{event.date_label}</Text>
            ) : null}
            {event?.location_label ? (
              <Text style={cardStyles.locationChip}>{event.location_label}</Text>
            ) : null}
          </View>
        ) : null}
        <Text style={cardStyles.title} numberOfLines={2}>
          {event?.title ?? "Featured event"}
        </Text>
        <View style={cardStyles.ctaBtn}>
          <Text style={cardStyles.ctaLabel}>Get tickets →</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: INBOX_CANVAS,
  },
  scrollContent: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  emailHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 12,
    gap: 4,
  },
  emailHeaderLabel: {
    ...typography.labelCap,
    color: MUTED,
    fontSize: 10,
  },
  emailHeaderValue: {
    ...typography.bodySm,
    color: INK,
    fontWeight: "600",
  },
  emailHeaderSubject: {
    ...typography.body,
    color: INK,
    fontWeight: "700",
  },
  emailHeaderDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(0,0,0,0.08)",
    marginVertical: 6,
  },
  emailFrame: {
    backgroundColor: FRAME_BG,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: FRAME_BORDER,
    overflow: "hidden",
  },
  brandBanner: {
    width: "100%",
    aspectRatio: 16 / 9,
    maxHeight: 240,
  },
  miniglaLogoRow: {
    paddingVertical: 24,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: FRAME_BORDER,
    alignItems: "center",
    backgroundColor: FRAME_BG,
  },
  miniglaLogo: {
    ...typography.h3,
    color: ORANGE,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  bodyRegion: {
    padding: 24,
    gap: 14,
  },
  paragraph: {
    ...typography.body,
    color: INK,
    fontSize: 15,
    lineHeight: 23,
  },
  placeholder: {
    ...typography.body,
    color: MUTED,
    fontStyle: "italic",
  },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: FRAME_BORDER,
    gap: 6,
  },
  footerLine: {
    ...typography.bodySm,
    color: MUTED,
    fontSize: 12,
    lineHeight: 17,
  },
  footerBrand: {
    color: INK,
    fontWeight: "600",
  },
  footerUnsubscribe: {
    color: MUTED,
    textDecorationLine: "underline",
  },
  previewNote: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    textAlign: "center",
    fontStyle: "italic",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    marginVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ORANGE_BORDER,
    backgroundColor: CREAM,
    overflow: "hidden",
  },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: CREAM_DEEP,
  },
  body: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 22,
    gap: 14,
    backgroundColor: CREAM,
  },
  kickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  kickerBar: {
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: ORANGE,
  },
  kickerLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: ORANGE_MUTED,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dateChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: INK_DEEP,
    color: CREAM,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
  },
  locationChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: ORANGE_TINT,
    color: ORANGE_MUTED,
    fontSize: 12,
    fontWeight: "600",
    overflow: "hidden",
  },
  title: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    color: INK_DEEP,
    letterSpacing: -0.2,
  },
  ctaBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: ORANGE,
  },
  ctaLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
