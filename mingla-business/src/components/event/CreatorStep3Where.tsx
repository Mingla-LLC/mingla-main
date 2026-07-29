/**
 * Wizard Step 3 — Where.
 *
 * Designer source: screens-creator.jsx lines 128-161 (CreatorStep3).
 * Render branches by draft.format:
 *   - in_person: venue name + address + map placeholder + privacy info
 *   - online: conferencing URL + privacy info
 *   - hybrid: BOTH in_person fields AND online URL
 *
 * Map preview is a solid striped placeholder. Real geocoding +
 * Google Places autocomplete land in B-cycle.
 *
 * Per Cycle 3 spec §3.9 Step 3.
 */

import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
// ORCH-1047: the event Where step now uses the Mapbox address autocomplete
// (META-ORCH-1059's mapbox-geocode edge fn + MapboxAddressInput) — the legacy
// Google Places path was REQUEST_DENIED, leaving an empty suggestions dropdown.
// MapboxAddressInput is a drop-in for AddressAutocompleteInput (same props +
// the same PlaceDetails boundary: formattedAddress / city / location).
import { MapboxAddressInput } from "../location/MapboxAddressInput";
import { PinDropSheet } from "../location/PinDropSheet";
import {
  resolveFreeTextLocation,
  resolvePinLocation,
} from "../../utils/resolveApproxLocation";
import type { PlaceDetails } from "../../services/mapboxGeocodeService";
// ORCH-1186 (salvaged from ORCH-1158 Issue 3 [wizard-map-preview]) — the SAME
// proven static-map builder the trip/experience previews use. As of ORCH-1165
// the static map is fetched through the vendor-NEUTRAL `static-map` Supabase
// edge proxy, so the URL carries NO map-vendor token and is a plain <Image>
// (no map SDK, no new dependency, works native + react-native-web). FAIL-SAFE:
// the builder returns null when coords are missing/non-finite OR the Supabase
// functions base URL is absent, in which case we render the honest "pick an
// address" empty state (rule 9 — never a fabricated/striped placeholder tile).
import { buildStaticMapUrl } from "../../utils/mapboxStaticImage";

import { errorForKey, type StepBodyProps } from "./types";

export const CreatorStep3Where: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
  scrollToBottom,
}) => {
  const venueError = showErrors ? errorForKey(errors, "venueName") : undefined;
  const addressError = showErrors ? errorForKey(errors, "address") : undefined;
  const onlineError = showErrors ? errorForKey(errors, "onlineUrl") : undefined;

  // Issue #1363 [three-tier address] — pin-drop host + non-silent inline hint.
  const [pinVisible, setPinVisible] = React.useState(false);
  const [addrHint, setAddrHint] = React.useState<string | null>(null);

  const showInPerson = draft.format === "in_person" || draft.format === "hybrid";
  const showOnline = draft.format === "online" || draft.format === "hybrid";

  return (
    <View>
      {showInPerson ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Venue name</Text>
            <Input
              value={draft.venueName ?? ""}
              onChangeText={(v) => updateDraft({ venueName: v })}
              placeholder="e.g. Hidden Rooms"
              variant="text"
              accessibilityLabel="Venue name"
              style={venueError !== undefined ? styles.inputError : undefined}
            />
            {venueError !== undefined ? (
              <Text style={styles.helperError}>{venueError}</Text>
            ) : null}
          </View>

          {/* ORCH-0824: Google Places autocomplete replaces the plain
              <Input>. On pick, address + city + locationGeo are written
              atomically. Free typing without picking leaves city=null,
              which the validator rejects with "Pick the venue address
              from the suggestions." */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Address</Text>
            <MapboxAddressInput
              value={draft.address ?? ""}
              allowFreeText
              onChangeText={(v) => {
                setAddrHint(null);
                updateDraft({ address: v, city: null, locationGeo: null, coordinatePrecision: null });
              }}
              onFreeText={(v) => {
                // Tier 2 — accept the typed text; background forward-geocode
                // derives the city (the event gate) + coarse coords.
                setAddrHint(null);
                updateDraft({ address: v });
                void (async () => {
                  const approx = await resolveFreeTextLocation(v);
                  if (approx !== null && approx.city !== null) {
                    updateDraft({
                      city: approx.city,
                      locationGeo: { lat: approx.lat, lng: approx.lng },
                      coordinatePrecision: "approximate",
                    });
                  } else {
                    // rule 3 — non-silent: city stays null (gate blocked); point
                    // the host at the pin / a more specific city.
                    updateDraft({ city: null, locationGeo: null, coordinatePrecision: null });
                    setAddrHint(
                      "We couldn't place that. Drop a pin, or add the city (e.g. “Yaba, Lagos”).",
                    );
                  }
                })();
              }}
              onOpenPinDrop={() => setPinVisible(true)}
              onPick={(details: PlaceDetails): void => {
                setAddrHint(null);
                updateDraft({
                  address: details.formattedAddress,
                  city: details.city,
                  locationGeo: details.location,
                  coordinatePrecision: "exact",
                });
              }}
              onClear={(): void => {
                setAddrHint(null);
                updateDraft({ address: null, city: null, locationGeo: null, coordinatePrecision: null });
              }}
              error={addressError}
            />
            {addrHint !== null ? (
              <Text style={styles.addrHint} accessibilityLiveRegion="polite">
                {addrHint}
              </Text>
            ) : null}
          </View>

          {/* Hide-address toggle — replaces the static helper text from
              Cycle 3 v1. Default ON (matches prior behaviour). */}
          <Pressable
            onPress={() =>
              updateDraft({
                hideAddressUntilTicket: !draft.hideAddressUntilTicket,
              })
            }
            accessibilityRole="switch"
            accessibilityState={{ checked: draft.hideAddressUntilTicket }}
            accessibilityLabel="Hide address until ticket purchase"
            style={styles.toggleRow}
          >
            <View style={styles.toggleLabelCol}>
              <Text style={styles.toggleLabel}>
                Hide address until ticket purchase
              </Text>
              <Text style={styles.toggleSub}>
                {draft.hideAddressUntilTicket
                  ? "Address only revealed to ticketed guests."
                  : "Address visible on the public event page."}
              </Text>
            </View>
            <View
              style={[
                styles.toggleTrack,
                draft.hideAddressUntilTicket && styles.toggleTrackOn,
              ]}
            >
              <View
                style={[
                  styles.toggleThumb,
                  draft.hideAddressUntilTicket
                    ? styles.toggleThumbOn
                    : styles.toggleThumbOff,
                ]}
              />
            </View>
          </Pressable>

          {/* ORCH-1186 (salvaged from ORCH-1158 Issue 3 [wizard-map-preview]) —
              REAL static Mapbox map (via the `static-map` server proxy) for the
              picked address's coords. buildStaticMapUrl(lat,lng,accent) → plain
              <Image>. REAL-DATA-ONLY (rule 9): until an address is picked
              (draft.locationGeo === null) OR the proxy base URL is absent at
              runtime, we show the honest "pick an address" empty state — never a
              fake tile. */}
          {(() => {
            // Issue #1363 — honest precision rendering (no fabricated precision,
            // rule 9): an APPROXIMATE (free-text) coordinate renders at a lower
            // zoom + an "Approximate location" caption so the preview never
            // implies a false pinpoint. Exact (pick/pin) / null renders precise.
            const isApprox = draft.coordinatePrecision === "approximate";
            const mapUrl = buildStaticMapUrl({
              lat: draft.locationGeo?.lat ?? null,
              lng: draft.locationGeo?.lng ?? null,
              accentHex: accent.warm,
              height: 160,
              zoom: isApprox ? 11 : 14,
            });
            return mapUrl !== null ? (
              <View style={styles.mapWrap}>
                <Image
                  source={{ uri: mapUrl }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                  accessibilityLabel={`Map of ${draft.address ?? "the venue"}`}
                />
                <View style={styles.mapPin} />
                {isApprox ? (
                  <View style={styles.approxBadge}>
                    <Icon name="location" size={12} color={textTokens.primary} />
                    <Text style={styles.approxBadgeText}>Approximate location</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={[styles.mapWrap, styles.mapEmpty]}>
                <Icon name="location" size={22} color={textTokens.quaternary} />
                <Text style={styles.mapEmptyText}>
                  Pick an address, use what you typed, or drop a pin
                </Text>
              </View>
            );
          })()}

          {/* Issue #1363 — Tier-3 pin-drop host (static tap-to-place). On confirm
              the coordinate is authoritative; reverse-geocode fills the city (the
              event gate). If no city is derivable, we keep city null + say so —
              honesty over guessing. */}
          <PinDropSheet
            visible={pinVisible}
            initialLat={draft.locationGeo?.lat ?? null}
            initialLng={draft.locationGeo?.lng ?? null}
            accentHex={accent.warm}
            onCancel={() => setPinVisible(false)}
            onConfirm={(pinLat, pinLng) => {
              setPinVisible(false);
              setAddrHint(null);
              void (async () => {
                const resolved = await resolvePinLocation(pinLat, pinLng);
                if (resolved === null) return;
                updateDraft({
                  city: resolved.city,
                  locationGeo: { lat: resolved.lat, lng: resolved.lng },
                  coordinatePrecision: "exact",
                  ...(draft.address === null || draft.address.trim().length === 0
                    ? resolved.formattedAddress !== null
                      ? { address: resolved.formattedAddress }
                      : {}
                    : {}),
                });
                if (resolved.city === null) {
                  setAddrHint(
                    "We couldn't read the city for that point — pick a spot nearer a town.",
                  );
                }
              })();
            }}
          />

          {/* Privacy info card */}
          <GlassCard variant="base" padding={spacing.md} style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.infoIconWrap}>
                <Icon name="location" size={14} color={accent.warm} />
              </View>
              <Text style={styles.infoText}>
                Address appears in tickets and confirmation emails — not on the
                public page until the guest checks out.
              </Text>
            </View>
          </GlassCard>
        </>
      ) : null}

      {showOnline ? (
        <View style={[styles.field, showInPerson && styles.onlineSpacer]}>
          <Text style={styles.fieldLabel}>Online conferencing link</Text>
          <Input
            value={draft.onlineUrl ?? ""}
            onChangeText={(v) => updateDraft({ onlineUrl: v })}
            // Online URL is the bottom-most field on Step 3 (when format
            // is online or hybrid). Same scroll-to-bottom pattern as
            // Step 1's Description: keyboard-rise-aware scroll lands
            // the field flush above the keyboard.
            onFocus={scrollToBottom}
            placeholder="https://..."
            variant="text"
            accessibilityLabel="Online conferencing link"
            style={onlineError !== undefined ? styles.inputError : undefined}
          />
          <Text style={styles.helperHint}>
            Link is shared with ticketed guests only — never posted publicly.
          </Text>
          {onlineError !== undefined ? (
            <Text style={styles.helperError}>{onlineError}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  helperHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  // Issue #1363 — non-silent inline hint on a failed free-text geocode (rule 3).
  addrHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.warning,
    marginTop: spacing.xs,
  },
  // Issue #1363 — "Approximate location" badge over an approximate-precision map.
  approxBadge: {
    position: "absolute",
    top: spacing.xs,
    left: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  approxBadgeText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.primary,
    fontWeight: "500",
  },
  inputError: {
    borderColor: semantic.error,
    borderWidth: 1,
  },
  onlineSpacer: {
    marginTop: spacing.md,
  },

  // Hide-address toggle (matches Step 6 ToggleRow visual) ---------------
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.md,
  },
  toggleLabelCol: {
    flex: 1,
    marginRight: spacing.sm,
  },
  toggleLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  toggleSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
    padding: 3,
  },
  toggleTrackOn: {
    backgroundColor: accent.warm,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  toggleThumbOff: {
    transform: [{ translateX: 0 }],
  },
  toggleThumbOn: {
    transform: [{ translateX: 18 }],
  },

  // ORCH-1186 — real static-map preview + honest empty state -----------
  mapWrap: {
    height: 160,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
    position: "relative",
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  mapEmpty: {
    gap: spacing.xs,
  },
  mapEmptyText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.quaternary,
  },
  // Themed center pin overlaid on the real static map (the static URL already
  // draws a Mapbox pin; this is the consistent brand-accent dot the wizard used).
  mapPin: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: accent.warm,
    borderWidth: 3,
    borderColor: "#fff",
  },

  // Info card ----------------------------------------------------------
  infoCard: {
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  infoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  infoText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight * 1.4,
    color: textTokens.secondary,
  },
});
