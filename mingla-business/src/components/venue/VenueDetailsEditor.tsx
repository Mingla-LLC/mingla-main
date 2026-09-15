/**
 * Issue #3386 — venue Settings → Venue details, as a real editor.
 *
 * #3404 replaced the broken "Edit venue details" button (it opened the BRAND
 * page) with a card and a "Request a change" email. Seth then decided
 * (2026-09-15) what hosts may change themselves:
 *
 *   - Contact phone and email: saved directly, any time. The phone is checked
 *     with the app's phone rules and saved as E.164 with its country.
 *   - Name, category and address while the venue is in review: saved directly.
 *   - Name, category or address on a LIVE venue: sent to Mingla. Guests keep
 *     the current details until Mingla approves. The host sees "Pending review"
 *     with the proposed values and can withdraw; a new request replaces it.
 *
 * "Request a change" (the #3404 email) stays only where nothing else fits: a
 * venue that is not in review and not live, and a Stay category move.
 *
 * Layout: the forms render INLINE in the card, the same as the opening-hours
 * editor above them, so the card is identical on iOS, Android, narrow web and
 * wide desktop (the Settings module is full width on desktop, ORCH-1190). No
 * nested sheet: on web a modal inside a modal never opens, and the phone
 * field's own country picker is already a sheet.
 *
 * #3407 lesson (events lost their pin): the address draft is seeded ONCE when
 * the form opens and is never replaced by a refetch while open; an address is
 * only saved with the coordinates and precision of a real pick or a resolved
 * typed address.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";
import { precisionFromPlaceDetails } from "@mingla/location-input";
import type { LocationSelectionState } from "@mingla/location-input";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  useSubmitVenueDetailsChangeRequest,
  useUpdateVenueContact,
  useUpdateVenueIdentityInReview,
  useVenueDetailsForHost,
  useWithdrawVenueDetailsChangeRequest,
} from "../../hooks/useVenueDetailsEdit";
import type { PlaceDetails } from "../../services/mapboxGeocodeService";
import type { VenueCategory } from "../../types/brand";
import { parseVenuePlaceResult } from "../../utils/parseVenuePlaceResult";
import {
  advanceLocationRequestGeneration,
  isFreeTextResolveStale,
  isLocationRequestGenerationCurrent,
  resolveFreeTextLocation,
} from "../../utils/resolveApproxLocation";
import { VenueCategoryPicker } from "../brand/VenueCategoryPicker";
import { MapboxAddressInput } from "../location/MapboxAddressInput";
import { Button } from "../ui/Button";
import { Input, PHONE_COUNTRIES, type PhoneCountry } from "../ui/Input";
import {
  VENUE_DETAILS_SUPPORT_EMAIL,
  venueDetailsChangeRequestUrl,
} from "./venueDetailsChangeRequest";
import {
  VENUE_CATEGORY_LABEL,
  VENUE_NAME_MAX,
  canEditVenueContact,
  contactPayloadFromDraft,
  contactPhoneLocalText,
  contactStartCountryIso,
  formatVenueAddress,
  identityDraftFromVenue,
  identityDraftProblem,
  identityPatchFromDraft,
  isEmptyIdentityPatch,
  proposedChangeLines,
  venueIdentityEditMode,
  type VenueIdentityDraft,
} from "./venueDetailsEditRules";

type EditorMode = "view" | "identity" | "contact";

export interface VenueDetailsEditorProps {
  brandId: string | null;
  venueId: string | null;
  /** event_manager+ on the brand (the server checks again). */
  canMutate: boolean;
  /** The brand's country, the phone picker's last start fallback. */
  brandCountryCode?: string | null;
}

const countryForIso = (iso: string | undefined): PhoneCountry | null =>
  iso === undefined
    ? null
    : PHONE_COUNTRIES.find((c) => c.iso === iso.toUpperCase()) ?? null;

/** The field's own default when no start country is known (Input.tsx). */
const FIELD_DEFAULT_COUNTRY = countryForIso("GB");

const formatRequestDate = (iso: string | null): string | null => {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export function VenueDetailsEditor({
  brandId,
  venueId,
  canMutate,
  brandCountryCode = null,
}: VenueDetailsEditorProps): React.ReactElement {
  const detailsQuery = useVenueDetailsForHost(venueId);
  const venue = detailsQuery.data ?? null;

  const updateContact = useUpdateVenueContact(venueId, brandId);
  const updateIdentity = useUpdateVenueIdentityInReview(venueId, brandId);
  const submitRequest = useSubmitVenueDetailsChangeRequest(venueId, brandId);
  const withdrawRequest = useWithdrawVenueDetailsChangeRequest(venueId, brandId);

  const [mode, setMode] = useState<EditorMode>("view");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestEmailFailed, setRequestEmailFailed] = useState<boolean>(false);

  // ── Identity draft (seeded once per open) ────────────────────────────────
  const [identityDraft, setIdentityDraft] = useState<VenueIdentityDraft | null>(null);
  const [selectionState, setSelectionState] =
    useState<LocationSelectionState>("editing");
  const requestGenerationRef = useRef(0);
  const committedAddressRef = useRef("");
  const savedContextRef = useRef<{ city: string | null; countryCode: string | null }>({
    city: null,
    countryCode: null,
  });

  // ── Contact draft (seeded once per open) ─────────────────────────────────
  const [phoneText, setPhoneText] = useState<string>("");
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountry | null>(null);
  const [emailText, setEmailText] = useState<string>("");

  const identityMode = venueIdentityEditMode(venue?.claimStatus);
  const contactEditable = canEditVenueContact(venue?.claimStatus);
  const pendingRequest =
    venue?.changeRequest?.status === "pending" ? venue.changeRequest : null;
  const rejectedRequest =
    venue?.changeRequest?.status === "rejected" ? venue.changeRequest : null;
  const isStay = venue?.venueCategory === "stay";

  const openIdentity = useCallback((): void => {
    if (venue === null) return;
    const draft = identityDraftFromVenue(venue);
    setIdentityDraft(draft);
    committedAddressRef.current = draft.addressText;
    savedContextRef.current = {
      city: draft.address?.city ?? null,
      countryCode: draft.address?.countryCode ?? null,
    };
    advanceLocationRequestGeneration(requestGenerationRef);
    setSelectionState(draft.address !== null ? "selected" : "editing");
    setFormError(null);
    setNotice(null);
    setMode("identity");
  }, [venue]);

  const openContact = useCallback((): void => {
    if (venue === null) return;
    const startIso = contactStartCountryIso(venue, brandCountryCode);
    const country = countryForIso(startIso) ?? FIELD_DEFAULT_COUNTRY;
    setPhoneCountry(country);
    setPhoneText(contactPhoneLocalText(venue.contactPhone, country?.dialCode ?? null));
    setEmailText(venue.contactEmail ?? "");
    setFormError(null);
    setNotice(null);
    setMode("contact");
  }, [venue, brandCountryCode]);

  const closeForm = useCallback((): void => {
    advanceLocationRequestGeneration(requestGenerationRef);
    setMode("view");
    setFormError(null);
    setIdentityDraft(null);
  }, []);

  // ── Address field (the venue wizard's state machine, on a local draft) ───
  const patchDraft = useCallback((patch: Partial<VenueIdentityDraft>): void => {
    setIdentityDraft((current) => (current === null ? current : { ...current, ...patch }));
    setFormError(null);
  }, []);

  const resolveTypedAddress = useCallback(
    (rawLabel: string): void => {
      const generation = advanceLocationRequestGeneration(requestGenerationRef);
      committedAddressRef.current = rawLabel;
      setSelectionState("resolving");
      patchDraft({ addressText: rawLabel, address: null });
      void (async () => {
        try {
          const resolution = await resolveFreeTextLocation(
            rawLabel,
            savedContextRef.current,
          );
          if (
            !isLocationRequestGenerationCurrent(requestGenerationRef, generation) ||
            isFreeTextResolveStale(rawLabel, committedAddressRef.current)
          ) {
            return;
          }
          if (resolution.status === "needs_context") {
            setSelectionState("needs_context");
            return;
          }
          const approx = resolution.location;
          savedContextRef.current = {
            city: approx.city,
            countryCode: approx.countryCode,
          };
          patchDraft({
            addressText: rawLabel,
            address: {
              address: rawLabel,
              city: approx.city,
              countryCode: approx.countryCode,
              lat: approx.lat,
              lng: approx.lng,
              coordinatePrecision: "approximate",
            },
          });
          setSelectionState("selected");
        } catch {
          if (
            isLocationRequestGenerationCurrent(requestGenerationRef, generation) &&
            !isFreeTextResolveStale(rawLabel, committedAddressRef.current)
          ) {
            setSelectionState("error");
          }
        }
      })();
    },
    [patchDraft],
  );

  const clearAddress = useCallback((text: string): void => {
    advanceLocationRequestGeneration(requestGenerationRef);
    committedAddressRef.current = text;
    savedContextRef.current = { city: null, countryCode: null };
    setSelectionState("editing");
    patchDraft({ addressText: text, address: null });
  }, [patchDraft]);

  // ── Saves ────────────────────────────────────────────────────────────────
  const identityPatch = useMemo(
    () =>
      venue !== null && identityDraft !== null
        ? identityPatchFromDraft(venue, identityDraft)
        : null,
    [venue, identityDraft],
  );

  const saveIdentity = useCallback((): void => {
    if (venue === null || identityDraft === null || identityPatch === null) return;
    const problem = identityDraftProblem(venue, identityDraft);
    if (problem !== null) {
      setFormError(problem);
      return;
    }
    if (isEmptyIdentityPatch(identityPatch)) {
      if (identityMode === "request" && pendingRequest !== null) {
        setFormError(
          "These are your current details. To cancel your request, use Withdraw request.",
        );
      } else {
        setFormError("Nothing has changed yet.");
      }
      return;
    }
    const onError = (error: Error): void => setFormError(error.message);
    if (identityMode === "direct") {
      updateIdentity.mutate(identityPatch, {
        onSuccess: () => {
          closeForm();
          setNotice("Saved. Mingla checks these details when it reviews your venue.");
        },
        onError,
      });
      return;
    }
    if (identityMode === "request") {
      submitRequest.mutate(identityPatch, {
        onSuccess: ({ replaced }) => {
          closeForm();
          setNotice(
            replaced
              ? "Sent to Mingla. This replaces your earlier request."
              : "Sent to Mingla for review. Guests see your current details until it's approved.",
          );
        },
        onError,
      });
    }
  }, [
    venue,
    identityDraft,
    identityPatch,
    identityMode,
    pendingRequest,
    updateIdentity,
    submitRequest,
    closeForm,
  ]);

  const saveContact = useCallback((): void => {
    const result = contactPayloadFromDraft({
      phoneText,
      countryIso: phoneCountry?.iso ?? null,
      dialCode: phoneCountry?.dialCode ?? null,
      emailText,
    });
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    updateContact.mutate(
      {
        phoneE164: result.phoneE164,
        phoneCountryIso: result.phoneCountryIso,
        email: result.email,
      },
      {
        onSuccess: () => {
          closeForm();
          setNotice("Contact details saved. Guests see them straight away.");
        },
        onError: (error) => setFormError(error.message),
      },
    );
  }, [phoneText, phoneCountry, emailText, updateContact, closeForm]);

  const withdraw = useCallback((): void => {
    const request = venue?.changeRequest ?? null;
    if (request === null) return;
    setFormError(null);
    withdrawRequest.mutate(request.requestId, {
      onSuccess: () => {
        setNotice(
          request.status === "pending"
            ? "Request withdrawn. Your venue keeps its current details."
            : null,
        );
      },
      onError: (error) => setFormError(error.message),
    });
  }, [venue, withdrawRequest]);

  const requestChangeByEmail = useCallback((): void => {
    if (venueId === null) return;
    setRequestEmailFailed(false);
    const url = venueDetailsChangeRequestUrl({
      venueId,
      venueName: venue?.name ?? null,
    });
    void Linking.openURL(url).catch(() => setRequestEmailFailed(true));
  }, [venueId, venue?.name]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (detailsQuery.isError) {
    return (
      <Text style={styles.error} testID="venue-details-load-error">
        Couldn&apos;t load your venue details. Pull to refresh and try again.
      </Text>
    );
  }
  if (venue === null) {
    return (
      <View style={styles.loading} testID="venue-details-loading">
        <ActivityIndicator color={accent.warm} />
      </View>
    );
  }

  const busy =
    updateContact.isPending ||
    updateIdentity.isPending ||
    submitRequest.isPending ||
    withdrawRequest.isPending;
  const address = formatVenueAddress(
    venue.address === null ? null : { address: venue.address, city: venue.city },
  );
  const proposed = proposedChangeLines(venue);
  const requestDate = formatRequestDate(pendingRequest?.requestedAt ?? null);

  const modeCopy =
    identityMode === "direct"
      ? "Your venue is in review. Changes you save here go straight to your listing, and Mingla checks the latest details before it goes live."
      : identityMode === "request"
        ? "Guests see these details. Contact details update straight away. A new name, address or category goes to Mingla first, and your venue keeps its current details until it's approved."
        : "Your venue isn't live or in review, so its name, address and category can't be changed here.";

  return (
    <View style={styles.host} testID="venue-details-editor">
      {mode !== "identity" ? (
        <View style={styles.summary} testID="venue-details-summary">
          <Text style={styles.rowTitle}>{venue.name}</Text>
          {address !== null ? <Text style={styles.rowSub}>{address}</Text> : null}
          <Text style={styles.rowSub}>
            {VENUE_CATEGORY_LABEL[venue.venueCategory] ?? venue.venueCategory}
          </Text>
        </View>
      ) : null}

      {mode === "view" ? (
        <View style={styles.summary} testID="venue-details-contact-summary">
          <Text style={styles.rowSub}>
            Phone: {venue.contactPhone ?? "not added"}
          </Text>
          <Text style={styles.rowSub}>
            Email: {venue.contactEmail ?? "not added"}
          </Text>
        </View>
      ) : null}

      {mode === "view" ? (
        <Text style={styles.rowSub} testID="venue-details-mode-copy">
          {modeCopy}
        </Text>
      ) : null}

      {pendingRequest !== null && mode === "view" ? (
        <View style={styles.pendingCard} testID="venue-details-pending">
          <Text style={styles.cardTitle}>Pending review</Text>
          <Text style={styles.rowSub}>
            {requestDate !== null ? `Sent ${requestDate}. ` : ""}
            Guests see your current details until Mingla approves these:
          </Text>
          {proposed.map((line) => (
            <Text key={line.label} style={styles.proposedLine}>
              {line.label}: {line.value}
            </Text>
          ))}
          {canMutate ? (
            <Button
              label="Withdraw request"
              onPress={withdraw}
              variant="secondary"
              size="sm"
              loading={withdrawRequest.isPending}
              disabled={busy}
              style={styles.inlineBtn}
              testID="venue-details-withdraw"
            />
          ) : null}
        </View>
      ) : null}

      {rejectedRequest !== null && mode === "view" ? (
        <View style={styles.rejectedCard} testID="venue-details-rejected">
          <Text style={styles.cardTitle}>Mingla didn&apos;t approve your change</Text>
          {rejectedRequest.rejectionReason !== null ? (
            <Text style={styles.rowSub} testID="venue-details-rejection-reason">
              {rejectedRequest.rejectionReason}
            </Text>
          ) : null}
          {proposed.map((line) => (
            <Text key={line.label} style={styles.proposedLine}>
              You asked for {line.label.toLowerCase()}: {line.value}
            </Text>
          ))}
          {canMutate ? (
            <Button
              label="Dismiss"
              onPress={withdraw}
              variant="secondary"
              size="sm"
              loading={withdrawRequest.isPending}
              disabled={busy}
              style={styles.inlineBtn}
              testID="venue-details-dismiss-rejection"
            />
          ) : null}
        </View>
      ) : null}

      {mode === "identity" && identityDraft !== null ? (
        <View style={styles.form} testID="venue-details-identity-form">
          <Text style={styles.fieldLabel}>Name</Text>
          <Input
            value={identityDraft.name}
            onChangeText={(name) => patchDraft({ name })}
            maxLength={VENUE_NAME_MAX}
            placeholder="Venue name"
            disabled={busy}
            accessibilityLabel="Venue name"
            testID="venue-details-name"
          />

          <Text style={styles.fieldLabel}>Category</Text>
          {isStay ? (
            <Text style={styles.rowSub} testID="venue-details-stay-category">
              Stay. Moving a venue out of Stay needs Mingla, so use Request a change
              below.
            </Text>
          ) : (
            <VenueCategoryPicker
              value={identityDraft.venueCategory}
              onChange={(venueCategory: VenueCategory) => patchDraft({ venueCategory })}
              testID="venue-details-category"
            />
          )}

          <Text style={styles.fieldLabel}>Address</Text>
          <MapboxAddressInput
            value={identityDraft.addressText}
            allowFreeText
            selectionState={selectionState}
            selectedLabel={identityDraft.addressText}
            proximitySources={{
              draftPoint: {
                lat: identityDraft.address?.lat ?? venue.lat,
                lng: identityDraft.address?.lng ?? venue.lng,
              },
            }}
            onChangeText={(text) => clearAddress(text)}
            onFreeText={resolveTypedAddress}
            onPick={(details: PlaceDetails, selectedLabel?: string): void => {
              advanceLocationRequestGeneration(requestGenerationRef);
              const place = parseVenuePlaceResult(details);
              // #3291: the picker's own label first, the retrieved address second.
              const label = selectedLabel ?? place.formattedAddress;
              committedAddressRef.current = label;
              savedContextRef.current = {
                city: place.city,
                countryCode: place.countryCode,
              };
              // Pin and precision travel with the label, from the pick itself
              // (#1629, #3407). The Mapbox place id is never stored (ORCH-1079).
              patchDraft({
                addressText: label,
                address: {
                  address: label,
                  city: place.city,
                  countryCode: place.countryCode,
                  lat: place.lat,
                  lng: place.lng,
                  coordinatePrecision: precisionFromPlaceDetails(details),
                },
              });
              setSelectionState("selected");
            }}
            onChangeSelected={() => clearAddress(identityDraft.addressText)}
            onClear={() => clearAddress("")}
            placeholder="Search address"
            accessibilityLabel="Venue address"
          />

          <Text style={styles.rowSub} testID="venue-details-identity-help">
            {identityMode === "direct"
              ? "Saves straight to your venue."
              : pendingRequest !== null
                ? "Mingla reviews this change. It replaces the request you already sent, and guests keep seeing your current details until it's approved."
                : "Mingla reviews this change. Guests keep seeing your current details until it's approved."}
          </Text>

          {formError !== null ? (
            <Text style={styles.error} testID="venue-details-form-error">
              {formError}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button
              label="Cancel"
              onPress={closeForm}
              variant="ghost"
              size="md"
              disabled={busy}
              testID="venue-details-cancel"
            />
            <Button
              label={identityMode === "direct" ? "Save changes" : "Send for review"}
              onPress={saveIdentity}
              variant="primary"
              size="md"
              loading={updateIdentity.isPending || submitRequest.isPending}
              disabled={busy || selectionState === "resolving"}
              testID="venue-details-save-identity"
            />
          </View>
        </View>
      ) : null}

      {mode === "contact" ? (
        <View style={styles.form} testID="venue-details-contact-form">
          <Text style={styles.fieldLabel}>Phone</Text>
          <Input
            variant="phone"
            value={phoneText}
            onChangeText={(next) => {
              setPhoneText(next);
              setFormError(null);
            }}
            defaultCountryIso={phoneCountry?.iso}
            onCountryChange={(country) => {
              setPhoneCountry(country);
              setFormError(null);
            }}
            placeholder="Phone number"
            clearable
            disabled={busy}
            accessibilityLabel="Venue contact phone"
            testID="venue-details-phone"
          />
          <Text style={styles.fieldLabel}>Email</Text>
          <Input
            variant="email"
            value={emailText}
            onChangeText={(next) => {
              setEmailText(next);
              setFormError(null);
            }}
            placeholder="Email"
            disabled={busy}
            accessibilityLabel="Venue contact email"
            testID="venue-details-email"
          />
          <Text style={styles.rowSub}>Guests see these straight away.</Text>
          {formError !== null ? (
            <Text style={styles.error} testID="venue-details-form-error">
              {formError}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button
              label="Cancel"
              onPress={closeForm}
              variant="ghost"
              size="md"
              disabled={busy}
              testID="venue-details-cancel"
            />
            <Button
              label="Save contact details"
              onPress={saveContact}
              variant="primary"
              size="md"
              loading={updateContact.isPending}
              disabled={busy}
              testID="venue-details-save-contact"
            />
          </View>
        </View>
      ) : null}

      {mode === "view" && formError !== null ? (
        <Text style={styles.error} testID="venue-details-form-error">
          {formError}
        </Text>
      ) : null}
      {mode === "view" && notice !== null ? (
        <Text style={styles.notice} testID="venue-details-notice">
          {notice}
        </Text>
      ) : null}

      {mode === "view" && canMutate ? (
        <View style={styles.buttonRow}>
          {identityMode !== "locked" ? (
            <Button
              label={
                identityMode === "direct"
                  ? "Edit name, address & category"
                  : pendingRequest !== null
                    ? "Change your request"
                    : "Change name, address or category"
              }
              onPress={openIdentity}
              variant="secondary"
              size="md"
              disabled={busy}
              testID="venue-details-edit-identity"
            />
          ) : null}
          {contactEditable ? (
            <Button
              label="Edit contact details"
              onPress={openContact}
              variant="secondary"
              size="md"
              disabled={busy}
              testID="venue-details-edit-contact"
            />
          ) : null}
        </View>
      ) : null}

      {mode === "view" && canMutate && (identityMode === "locked" || isStay) ? (
        <View style={styles.fallback} testID="venue-details-fallback">
          <Text style={styles.rowSub}>
            For anything you can&apos;t change here, email{" "}
            {VENUE_DETAILS_SUPPORT_EMAIL} and Mingla will update your venue.
          </Text>
          <Button
            label="Request a change"
            onPress={requestChangeByEmail}
            variant="ghost"
            size="sm"
            style={styles.inlineBtn}
            testID="venue-details-request-change"
          />
          {requestEmailFailed ? (
            <Text style={styles.error} testID="venue-details-request-failed">
              Couldn&apos;t open your email app. Email {VENUE_DETAILS_SUPPORT_EMAIL}{" "}
              with the changes and your venue name.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
  },
  loading: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  summary: {
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  rowSub: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  cardTitle: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  proposedLine: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
  pendingCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: semantic.infoTint,
    gap: spacing.xs,
  },
  rejectedCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: semantic.warningTint,
    gap: spacing.xs,
  },
  form: {
    gap: spacing.sm,
  },
  fieldLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  fallback: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  inlineBtn: {
    marginTop: spacing.xs,
    alignSelf: "flex-start",
  },
  error: {
    ...typography.bodySm,
    color: semantic.errorText,
  },
  notice: {
    ...typography.bodySm,
    color: semantic.success,
  },
});

export default VenueDetailsEditor;
