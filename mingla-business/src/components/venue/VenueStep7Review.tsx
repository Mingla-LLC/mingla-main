/**
 * Ve1 wizard — Step s9: Review + submit.
 *
 * META-ORCH-1290 Leg B (D-1 folded wizard, DESIGN §2.3) — the review now
 * summarizes the WHOLE single submission (cover, photos, name/address, hours,
 * pitch, contact, price, bookings) since create no longer has a second
 * deck-readiness leg. On success the owner lands on the management page
 * "In review". Used by the create path only (claim has ClaimStepReview).
 */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  color,
  space,
  type,
} from "../../constants/designSystem";
import type { VenueCategory } from "../../types/brand";
import { useBrandDiscoveryCurrency } from "../../hooks/useBrandDiscoveryCurrency";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { ThemeControlRow } from "../theme/ThemeControlRow";
import { ThemeSheet } from "../theme/ThemeSheetLazy";
import { Button } from "../ui/Button";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { useVenueThemeControl } from "./useVenueThemeControl";

const CAT_LABEL: Record<VenueCategory, string> = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
  stay: "Stay",
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
  // issue #1564 — MOUNT 2 of 4. Last chance to change the look before it goes
  // to review, matching CreatorStep7Preview / TripCreatorStep5Review /
  // RsvpStep7Preview, which all carry the row on their review step too.
  const theme = useVenueThemeControl();
  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const currencyState = useBrandDiscoveryCurrency(d.activeBrandId);
  const currencyCode = currencyState.data?.currencyCode ?? null;
  const cover = d.coverChoice ?? null;
  const gallery = d.galleryUrls ?? [];
  const pitch = d.description.trim();
  const contact = [d.contactEmail.trim(), d.contactPhone.trim(), d.website.trim()]
    .filter((s) => s.length > 0)
    .join(" · ");
  const priceLabel = (d.discoveryPriceMinInput ?? "").trim().length > 0
    ? `${(d.discoveryPriceMinInput ?? "").trim()}${
        (d.discoveryPriceMaxInput ?? "").trim().length > 0
          ? `–${(d.discoveryPriceMaxInput ?? "").trim()}`
          : "+"
      }${currencyCode ? ` ${currencyCode}` : ""}`
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
          // #3384 — there is no pitch step (ORCH-1304): Mingla writes the
          // pitch when it approves the venue, and the host edits it on the
          // venue page once live. Never ask for something the wizard can't take.
          <View style={styles.row} testID="venue-review-pitch-pending">
            <Text style={styles.k}>Pitch</Text>
            <Text style={styles.mutedV}>
              Mingla writes your pitch when your venue is approved
            </Text>
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
      <ThemeControlRow
        value={theme.value}
        onChange={theme.onChange}
        scope="venue"
        brandTheme={theme.brandTheme}
        brandThemeStatus={theme.brandThemeStatus}
        variant="review"
        disabled={submitting}
        onPress={() => setThemeSheetOpen(true)}
        testID="venue-review-theme-control-row"
      />
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
      {/* I-SUB-SHEET-INSIDE-PARENT — last JSX child of the root View. */}
      <ThemeSheet
        visible={themeSheetOpen}
        onClose={() => setThemeSheetOpen(false)}
        value={theme.value}
        onChange={theme.onChange}
        scope="venue"
        brandTheme={theme.brandTheme}
        testID="venue-review-theme-sheet"
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
    gap: space[4],
    paddingHorizontal: space[6],
    paddingBottom: space[7],
  },
  title: {
    fontSize: type.h1.fontSize,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  helper: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: 12,
    backgroundColor: color.fill.tile,
  },
  row: {
    gap: 2,
  },
  coverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  coverText: {
    flex: 1,
    gap: 2,
  },
  k: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  v: {
    fontSize: type.body.fontSize,
    color: color.text1,
  },
  mutedV: {
    fontSize: type.body.fontSize,
    color: color.text2,
  },
  err: {
    fontSize: type.caption.fontSize,
    color: color.errorText,
  },
});

export default VenueStep7Review;
