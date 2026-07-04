/**
 * Ve1 wizard — Step s9: Review + submit.
 *
 * META-ORCH-1290 Leg B (D-1 folded wizard, DESIGN §2.3) — the review now
 * summarizes the WHOLE single submission (cover, photos, name/address, hours,
 * pitch, contact, price, bookings) since create no longer has a second
 * deck-readiness leg. On success the owner lands on the management page
 * "In review". Used by the create path only (claim has ClaimStepReview).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { VenueCategory } from "../../types/brand";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { Button } from "../ui/Button";
import { EventCoverMedia } from "../ui/EventCoverMedia";

const CAT_LABEL: Record<VenueCategory, string> = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
};

const PRICE_TIER_LABEL: Record<string, string> = {
  chill: "Chill",
  comfy: "Comfy",
  bougie: "Bougie",
  lavish: "Lavish",
};

export interface VenueStep7ReviewProps {
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
}

export const VenueStep7Review: React.FC<VenueStep7ReviewProps> = ({
  submitting,
  submitError,
  onSubmit,
}) => {
  const d = useDraftVenueStore();
  const cover = d.coverChoice ?? null;
  const gallery = d.galleryUrls ?? [];
  const pitch = d.description.trim();
  const contact = [d.contactEmail.trim(), d.contactPhone.trim(), d.website.trim()]
    .filter((s) => s.length > 0)
    .join(" · ");
  const priceLabel =
    d.priceTiers.length > 0
      ? d.priceTiers.map((t) => PRICE_TIER_LABEL[t] ?? t).join(", ")
      : "—";

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Review & submit</Text>
      <Text style={styles.helper}>
        Your venue goes to us for a quick check — approval usually lands within
        4 business hours.
      </Text>
      <View style={styles.card}>
        <View style={styles.coverRow}>
          {cover !== null ? (
            <EventCoverMedia
              hue={25}
              mediaUrl={cover.url}
              mediaType={cover.type}
              radius={6}
              label="Cover"
              height={50}
              width={40}
              muted
            />
          ) : null}
          <View style={styles.coverText}>
            <Text style={styles.k}>Cover & photos</Text>
            <Text style={styles.v}>
              {cover !== null ? "Cover set" : "No cover yet"} ·{" "}
              {gallery.length} photo{gallery.length === 1 ? "" : "s"}
            </Text>
          </View>
        </View>
        <Row k="Name" v={d.displayName.trim() || "—"} />
        <Row k="Category" v={d.venueCategory ? CAT_LABEL[d.venueCategory] : "—"} />
        <Row k="Address" v={d.formattedAddress || "—"} />
        {pitch.length === 0 ? (
          <View style={styles.row}>
            <Text style={styles.k}>Pitch</Text>
            <Text style={styles.warnV}>Add a pitch (optional)</Text>
          </View>
        ) : (
          <View style={styles.row}>
            <Text style={styles.k}>Pitch</Text>
            <Text style={styles.v} numberOfLines={3}>
              {pitch}
            </Text>
          </View>
        )}
        <Row k="Contact" v={contact || "—"} />
        <Row k="Price" v={priceLabel} />
        <Row
          k="Bookings"
          v={d.wantsReservations ? "Reservations on" : "Reservations off"}
        />
      </View>
      {submitError !== null ? (
        <Text style={styles.err}>{submitError}</Text>
      ) : null}
      <Button
        label={submitting ? "Submitting…" : "Submit for review"}
        onPress={onSubmit}
        variant="primary"
        size="lg"
        loading={submitting}
        disabled={submitting}
      />
    </View>
  );
};

function Row({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  row: {
    gap: 2,
  },
  coverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  coverText: {
    flex: 1,
    gap: 2,
  },
  k: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  v: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  warnV: {
    fontSize: typography.body.fontSize,
    color: semantic.warning,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
});

export default VenueStep7Review;
