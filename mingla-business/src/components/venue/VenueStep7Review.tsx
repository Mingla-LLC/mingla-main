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
import { FEATURE_COPY, type VenueTypeKey } from "../../types/venueFeatures";
import { useBrandDiscoveryCurrency } from "../../hooks/useBrandDiscoveryCurrency";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { ThemeControlRow } from "../theme/ThemeControlRow";
import { ThemeSheet } from "../theme/ThemeSheetLazy";
import { Button } from "../ui/Button";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { useVenueThemeControl } from "./useVenueThemeControl";
import { chosenStartingFeatures } from "./features/wizardFeaturesModel";
import { c6DialCode } from "./venueWizardValidation";
import { hoursWeekLines, phoneWithCode, priceRangeLabel, venueTypeLabel } from "./venueReviewModel";

export interface VenueStep7ReviewProps {
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
  /** #4490 D11 — the step that fixes the submit error, as a button. */
  fixLabel?: string | null;
  onFix?: () => void;
}

export const VenueStep7Review: React.FC<VenueStep7ReviewProps> = ({
  submitting,
  submitError,
  onSubmit,
  fixLabel = null,
  onFix,
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
  // #4490 D10 — the phone with its country code, money with symbol and
  // thousands, the full type label, the hours and the starting features.
  const phone = phoneWithCode(c6DialCode(d.contactPhoneCountryIso), d.contactPhone);
  const contact = [d.contactEmail.trim(), phone, d.website.trim()]
    .filter((s) => s.length > 0)
    .join(" · ");
  const priceLabel = priceRangeLabel(d.discoveryPriceMinInput, d.discoveryPriceMaxInput, currencyCode);
  const features = chosenStartingFeatures((d.venueCategory ?? null) as VenueTypeKey | null, d.startingFeatures);
  const hoursLines = hoursWeekLines(d.hours ?? []);

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
        <Row k="Type" v={venueTypeLabel(d.venueCategory)} />
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
        <View style={styles.row} testID="venue-review-hours">
          <Text style={styles.k}>Hours</Text>
          {hoursLines.map((line) => (
            <Text key={line} style={styles.v}>{line}</Text>
          ))}
        </View>
        <Row
          k="Starts with"
          v={
            features.length > 0
              ? features.map((key) => FEATURE_COPY[key].label).join(", ")
              : "No features yet. Switch them on in Settings."
          }
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
        <View style={styles.errBox} accessibilityLiveRegion="polite" testID="venue-review-submit-error">
          <Text style={styles.err}>{submitError}</Text>
          {fixLabel !== null && onFix !== undefined ? (
            <Button label={fixLabel} variant="secondary" size="sm" onPress={onFix} testID="venue-review-fix" />
          ) : null}
        </View>
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
    fontSize: type.small.fontSize,
    color: color.errorText,
  },
  errBox: {
    gap: space[2],
    alignItems: "flex-start",
  },
});

export default VenueStep7Review;
