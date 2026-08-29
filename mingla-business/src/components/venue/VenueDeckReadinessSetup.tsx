/**
 * VenueDeckReadinessSetup — post-create deck-readiness setup for ONE venue
 * (META-ORCH-1009 Sub-E, venue-scoped by META-ORCH-1255).
 *
 * META-ORCH-1255(R2) [web bundle budget] — extracted VERBATIM from
 * VenueCreatorWizard.tsx into its own module. Two ROUTE chunks consume this
 * screen (app/venue/create.tsx via the wizard's success leg, and the durable
 * resume route app/venue/deck-readiness.tsx); while it shared a file with the
 * wizard, Metro hoisted the WHOLE wizard module + all six Venue step modules
 * into the EAGER `__common` boot chunk, breaching the ORCH-1083 initial-bundle
 * budget. Split, only THIS screen is cross-chunk shared; the wizard + its
 * steps stay inside the create route chunk. Behavior is unchanged.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. KeyboardAvoidingView
// removed. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  commitExistingVenueDiscoveryRange,
  refreshDeckReadiness,
  saveTier2,
  syncGallery,
  syncHeroMedia,
  type PipelineCoachingCard,
} from "../../services/businessPlaceAuthoringService";
import { useBrandDiscoveryCurrency } from "../../hooks/useBrandDiscoveryCurrency";
import { usePlaceDiscoveryPriceRange } from "../../hooks/usePlaceDiscoveryPriceRange";
import {
  minorToMajorInput,
} from "../../utils/currencyFormatter";
import {
  pickGalleryPhotos,
  uploadGalleryPhoto,
  VenueGalleryError,
} from "../../services/venueGalleryService";
import type { VenueCategory } from "../../types/brand";
// #1558 — the total category key space, so the facet lookup below cannot have a
// `default` arm. Pure-data module, one erased type import; no runtime weight.
import {
  venueCategoryKey,
  type VenueCategoryKey,
} from "@mingla/brand-rendering/venueCategoryProfile";
import { VENUE_SIGNALS } from "../../constants/venueSignals";
import type { DeckReadinessFocus } from "../../utils/deckReadinessRoutes";
import { sanitizeAuthoringError } from "../../utils/sanitizeAuthoringError";
import { Button } from "../ui/Button";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
import type { CoverPatch } from "../ui/CoverPicker";

export interface VenueDeckReadinessSetupProps {
  accountId: string;
  // META-ORCH-1255 — venue-scoped prop re-shape: the setup works on ONE
  // venue_listings row under the (unchanged) current brand.
  brandId: string;
  venueId: string;
  placePoolId: string;
  venueName: string;
  venueCategory: VenueCategory | null;
  /** Operator-authored seeds for the AI (wizard draft / stored tier2). */
  operatorTagline?: string | null;
  operatorDescription?: string | null;
  onDone: () => void;
  focus?: DeckReadinessFocus;
  initialTier2?: Record<string, unknown>;
  /**
   * ORCH-1304 — accepted for route compatibility (the durable deck-readiness
   * route still passes it) but no longer consumed: the pitch is written by
   * Mingla at approve, not drafted on this screen.
   */
  initialPendingBio?: string | null;
  initialFacets?: Record<string, boolean | null>;
  initialCoaching?: PipelineCoachingCard[];
  initialCover?: CoverPatch | null;
  initialGallery?: string[];
}

// META-ORCH-1009 Sub-E: required venue gallery bounds (mirror the edge GALLERY_MIN
// / GALLERY_MAX). Hero is separate; the gallery is 5–20 additional photos.
const GALLERY_MIN = 5;
const GALLERY_MAX = 20;
const EMPTY_GALLERY: string[] = [];

// META-ORCH-1009 Sub-E: the "Best for" options are REAL Mingla signals (ids match
// public.signal_definitions, the taxonomy the consumer app matches on) — NOT the
// earlier arbitrary "date night / celebration" labels, which didn't map to any
// signal. The operator taps which of these genuinely apply; the selected ids feed
// the AI as vibe_chips so the hint speaks the same language as the scoring engine.
// (Curated to the experiential signals that read sensibly as a venue self-tag; the
// AI still scores the venue against ALL active signals automatically.)
// ORCH-1040: ids/labels live in the shared venueSignals constant so the wizard
// chips and the listing-management score view never drift.
const VIBE_SIGNALS = VENUE_SIGNALS;

// ORCH-1304 — the old pitch-generation loader (staged copy + live website
// screenshot) is REMOVED. Mingla writes the pitch and match scores at approve;
// this screen only collects inputs and saves them.

// WS5: Google-Places facet yes/no questions, by venue category. ids match the
// place_pool facet boolean columns + the edge FACET_COLUMNS.
const FACET_CORE: ReadonlyArray<{ id: string; q: string }> = [
  { id: "good_for_groups", q: "Good for groups?" },
  { id: "good_for_children", q: "Good for kids?" },
  { id: "good_for_watching_sports", q: "Good for watching sports?" },
  { id: "allows_dogs", q: "Dog-friendly?" },
  { id: "outdoor_seating", q: "Outdoor seating?" },
  { id: "live_music", q: "Live music?" },
  { id: "has_restroom", q: "Restrooms available?" },
  { id: "reservable", q: "Takes reservations?" },
];
const FACET_RESTAURANT: ReadonlyArray<{ id: string; q: string }> = [
  { id: "serves_breakfast", q: "Serves breakfast?" },
  { id: "serves_brunch", q: "Serves brunch?" },
  { id: "serves_lunch", q: "Serves lunch?" },
  { id: "serves_dinner", q: "Serves dinner?" },
  { id: "serves_dessert", q: "Serves dessert?" },
  { id: "serves_coffee", q: "Serves coffee?" },
  { id: "serves_beer", q: "Serves beer?" },
  { id: "serves_wine", q: "Serves wine?" },
  { id: "serves_cocktails", q: "Serves cocktails?" },
  { id: "serves_vegetarian_food", q: "Vegetarian options?" },
  { id: "menu_for_children", q: "Kids' menu?" },
  { id: "dine_in", q: "Dine-in?" },
  { id: "takeout", q: "Takeout?" },
  { id: "delivery", q: "Delivery?" },
  { id: "curbside_pickup", q: "Curbside pickup?" },
];
const FACET_PLAY: ReadonlyArray<{ id: string; q: string }> = [
  { id: "serves_coffee", q: "Serves coffee?" },
  { id: "serves_beer", q: "Serves beer?" },
  { id: "serves_cocktails", q: "Serves cocktails?" },
  { id: "serves_dessert", q: "Serves snacks/dessert?" },
];
const FACET_ARTS: ReadonlyArray<{ id: string; q: string }> = [
  { id: "serves_coffee", q: "Serves coffee?" },
  { id: "serves_wine", q: "Serves wine?" },
  { id: "serves_dessert", q: "Serves snacks/dessert?" },
];
/**
 * #1558 — THE FALL-THROUGH IS GONE. This used to be
 * `function facetQuestionsForCategory(cat: string)` ending in
 * `return [...FACET_CORE, ...FACET_RESTAURANT]; // restaurant / default`,
 * which is why a hotel operator was asked whether they do curbside pickup:
 * `stay` matched neither `if`, so it silently inherited the restaurant's
 * questions — and a `null` category was coerced to "restaurant" one line above
 * the call site before it even got here.
 *
 * It is now a TOTAL `Record<VenueCategoryKey, …>`: no `default` arm, an
 * explicit `uncategorised` arm, and a fifth venue category becomes a COMPILE
 * ERROR here instead of quietly becoming a restaurant.
 *
 * The question SETS are unchanged for every category that exists today,
 * including `stay` — whether a hotel should be asked restaurant facets is a
 * product call that belongs to its own issue, not to this refactor. What
 * changed is that it is now a decision written down, not a fall-through.
 */
const FACET_QUESTIONS_BY_CATEGORY: Record<
  VenueCategoryKey,
  ReadonlyArray<{ id: string; q: string }>
> = {
  restaurant: [...FACET_CORE, ...FACET_RESTAURANT],
  play: [...FACET_CORE, ...FACET_PLAY],
  creative_and_arts: [...FACET_CORE, ...FACET_ARTS],
  // [TRANSITIONAL] a Stay inherits the restaurant facet set verbatim, exactly
  // as it does on `main`. EXIT CONDITION: a product decision on which facets a
  // Stay should carry — tracked as a discovery on #1558, not fixed here.
  stay: [...FACET_CORE, ...FACET_RESTAURANT],
  uncategorised: [...FACET_CORE, ...FACET_RESTAURANT],
};

const EMPTY_COVER: CoverPatch = {
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
};
const EMPTY_TIER2: Record<string, unknown> = {};
const EMPTY_FACETS: Record<string, boolean | null> = {};
const EMPTY_COACHING: PipelineCoachingCard[] = [];

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function VenueDeckReadinessSetup({
  accountId,
  brandId,
  venueId,
  placePoolId,
  venueName,
  venueCategory: venueCategoryProp,
  operatorTagline = null,
  operatorDescription = null,
  onDone,
  focus = "review",
  initialTier2 = EMPTY_TIER2,
  initialFacets = EMPTY_FACETS,
  initialCoaching = EMPTY_COACHING,
  initialCover = null,
  initialGallery = EMPTY_GALLERY,
}: VenueDeckReadinessSetupProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  // #1558 — a NULL category is `uncategorised`, a named key with its own row in
  // the table above. It is no longer coerced into "restaurant" here.
  const facetQuestions =
    FACET_QUESTIONS_BY_CATEGORY[venueCategoryKey(venueCategoryProp)];
  const [coverVisible, setCoverVisible] = useState(false);
  const [gallery, setGallery] = useState<string[]>(initialGallery);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [cover, setCover] = useState<CoverPatch>({
    ...EMPTY_COVER,
    coverMediaUrl: initialCover?.coverMediaUrl ?? null,
    coverMediaPosterUrl: initialCover?.coverMediaPosterUrl ?? null,
    coverMediaType: initialCover?.coverMediaType ?? null,
  });
  const [website, setWebsite] = useState(
    stringValue(initialTier2.website, ""),
  );
  const currencyQuery = useBrandDiscoveryCurrency(brandId);
  const rangeQuery = usePlaceDiscoveryPriceRange(placePoolId);
  const currencyState = currencyQuery.data;
  const currencyMetadata = currencyState?.supportedCurrencies.find(
    (candidate) => candidate.code === currencyState.currencyCode,
  );
  const exponent = currencyMetadata?.minorUnitExponent ?? 2;
  const [priceMinInput, setPriceMinInput] = useState("");
  const [priceMaxInput, setPriceMaxInput] = useState("");
  const [selectedVibes, setSelectedVibes] = useState<string[]>(
    stringArray(initialTier2.vibe_chips),
  );
  const [facets, setFacets] = useState<Record<string, boolean | null>>(
    initialFacets,
  );
  const [coaching, setCoaching] = useState<PipelineCoachingCard[]>(initialCoaching);
  // ORCH-1304 — "save" replaces the old "ai"/"confirm" pitch-gen busy states;
  // "refresh" stays for the deck-readiness status check.
  const [busy, setBusy] = useState<"save" | "refresh" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setWebsite(stringValue(initialTier2.website, ""));
    setSelectedVibes(stringArray(initialTier2.vibe_chips));
    setFacets(initialFacets);
    setCoaching(initialCoaching);
  }, [initialCoaching, initialFacets, initialTier2]);

  useEffect(() => {
    const range = rangeQuery.data;
    if (range?.status !== "active" || range.source_min_minor === null) return;
    setPriceMinInput(minorToMajorInput(range.source_min_minor, exponent));
    setPriceMaxInput(
      range.source_max_minor === null
        ? ""
        : minorToMajorInput(range.source_max_minor, exponent),
    );
  }, [exponent, rangeQuery.data]);

  useEffect(() => {
    setGallery(initialGallery);
  }, [initialGallery]);

  useEffect(() => {
    if (focus === "cover") setCoverVisible(true);
  }, [focus]);

  const buildTier2 = useCallback(
    () => ({
      website: website.trim() || null,
      vibe_chips: selectedVibes,
      facets,
      operator_inputs: {
        tagline: operatorTagline,
        description: operatorDescription,
      },
    }),
    [operatorDescription, operatorTagline, facets, selectedVibes, website],
  );

  const setFacet = useCallback((id: string, val: boolean): void => {
    setFacets((prev) => ({ ...prev, [id]: val }));
  }, []);

  const handleCoverChange = useCallback(
    async (patch: CoverPatch): Promise<void> => {
      setCover(patch);
      await syncHeroMedia({
        brandId,
        venueId,
        placePoolId,
        coverMediaUrl: patch.coverMediaUrl,
        coverMediaPosterUrl: patch.coverMediaPosterUrl,
        coverMediaType: patch.coverMediaType,
      }).catch((error) => {
        setMessage(
          sanitizeAuthoringError(
            error,
            "Cover saved, but deck readiness did not sync yet.",
          ),
        );
        throw error;
      });
    },
    [brandId, venueId, placePoolId],
  );

  // META-ORCH-1009 Sub-E: multi-select gallery upload. Pick many at once (capped
  // at remaining slots), upload each to storage, then persist the URL set.
  const handleAddPhotos = useCallback(async (): Promise<void> => {
    const remaining = GALLERY_MAX - gallery.length;
    if (remaining <= 0) {
      setMessage(`You can add up to ${GALLERY_MAX} photos.`);
      return;
    }
    setGalleryBusy(true);
    setMessage(null);
    try {
      const picked = await pickGalleryPhotos(remaining);
      if (picked.length === 0) return;
      const uploaded: string[] = [];
      for (const asset of picked) {
        try {
          uploaded.push(await uploadGalleryPhoto(brandId, asset));
        } catch (e) {
          setMessage(
            e instanceof VenueGalleryError ? e.message : "A photo failed to upload.",
          );
        }
      }
      if (uploaded.length === 0) return;
      const next = Array.from(new Set([...gallery, ...uploaded])).slice(0, GALLERY_MAX);
      setGallery(next);
      await syncGallery({ brandId, venueId, placePoolId, galleryUrls: next });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't add photos. Try again.");
    } finally {
      setGalleryBusy(false);
    }
  }, [brandId, venueId, gallery, placePoolId]);

  const handleRemovePhoto = useCallback(
    async (url: string): Promise<void> => {
      const next = gallery.filter((u) => u !== url);
      setGallery(next);
      try {
        await syncGallery({ brandId, venueId, placePoolId, galleryUrls: next });
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Couldn't update photos.");
      }
    },
    [brandId, venueId, gallery, placePoolId],
  );

  const toggleVibe = useCallback((vibe: string): void => {
    setSelectedVibes((prev) =>
      prev.includes(vibe)
        ? prev.filter((v) => v !== vibe)
        : [...prev, vibe],
    );
  }, []);

  // ORCH-1304 [approve generates the pitch] — this screen no longer drafts a
  // pitch (no pitch-gen button, no pitch textarea). It collects inputs and
  // SAVES them via the owner-authed `save_tier2` action, which stages
  // website/price/vibes/facets into `business_authoring_inputs.tier2` and writes
  // NO serving column and calls NO Gemini (I-1263 preserved). Cover + gallery
  // auto-save on change via syncHeroMedia/syncGallery. Mingla writes the pitch +
  // match scores when an admin approves the venue; the owner edits the pitch
  // afterward on the listing page.
  const handleSaveChanges = useCallback(async (): Promise<void> => {
    setBusy("save");
    setMessage(null);
    try {
      await saveTier2({ brandId, venueId, placePoolId, tier2: buildTier2() });
      await commitExistingVenueDiscoveryRange({
        brandId,
        venueId,
        placePoolId,
        priceMinInput,
        priceMaxInput,
        expectedVersion: rangeQuery.data?.version ?? 0,
      });
      onDone();
    } catch (error) {
      setMessage(sanitizeAuthoringError(error, "Could not save your changes."));
    } finally {
      setBusy(null);
    }
  }, [
    brandId,
    venueId,
    placePoolId,
    buildTier2,
    currencyMetadata,
    currencyState,
    onDone,
    priceMaxInput,
    priceMinInput,
    rangeQuery.data?.version,
  ]);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setBusy("refresh");
    setMessage(null);
    try {
      const result = await refreshDeckReadiness({
        brandId,
        venueId,
        placePoolId,
      });
      setCoaching(result.coaching);
      setMessage(
        result.status === "deck_eligible"
          ? "Deck readiness passed."
          : result.coaching[0]?.body ?? "Review the remaining deck-readiness tasks.",
      );
    } catch (error) {
      setMessage(
        sanitizeAuthoringError(error, "Could not refresh deck readiness."),
      );
    } finally {
      setBusy(null);
    }
  }, [brandId, venueId, placePoolId]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.deckHeader}>
        {/* META-ORCH-1255 — name WHICH venue this setup belongs to (multi-venue
            brands must never act on the wrong one). */}
        <Text style={styles.chromeSub}>{venueName}</Text>
        <Text style={styles.deckTitle}>Get recommended on Mingla</Text>
        <Text style={styles.deckBody}>
          Add photos, a website, and a price range so Mingla can match you to the
          right customers. Mingla writes your pitch and match scores when it
          approves your venue.
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.deckContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.deckBlock}>
          <Text style={styles.blockTitle}>Photos &amp; video</Text>
          <Text style={styles.blockBody}>
            This is the first thing customers see when your venue is recommended.
            A short video stands out the most and gets you shown more often; a
            great photo works too.
          </Text>
          {/* META-ORCH-1009 Sub-E: show the uploaded hero so the operator has
              visual confirmation it saved after closing the cover sheet. */}
          {cover.coverMediaUrl !== null ? (
            <View style={styles.heroPreview}>
              <EventCoverMedia
                hue={25}
                mediaUrl={cover.coverMediaUrl}
                mediaType={cover.coverMediaType}
                radius={12}
                label="Hero cover preview"
                height={170}
                muted
              />
            </View>
          ) : null}
          <Button
            label={cover.coverMediaUrl === null ? "Add hero cover" : "Change hero cover"}
            variant="secondary"
            size="md"
            leadingIcon="upload"
            onPress={() => setCoverVisible(true)}
          />
        </View>

        {/* META-ORCH-1009 Sub-E: required venue gallery — 5–20 photos, multi-select. */}
        <View style={styles.deckBlock}>
          <Text style={styles.blockTitle}>Venue photos · required</Text>
          <Text style={styles.blockBody}>
            Add at least {GALLERY_MIN} photos (up to {GALLERY_MAX}) so customers can
            picture your space. Tap once and pick several at a time.
          </Text>
          <Text
            style={[
              styles.fieldHint,
              gallery.length >= GALLERY_MIN && styles.galleryCountOk,
            ]}
          >
            {gallery.length} / {GALLERY_MIN} minimum · up to {GALLERY_MAX}
            {gallery.length >= GALLERY_MIN ? "  ✓" : ""}
          </Text>
          {gallery.length > 0 ? (
            <View style={styles.galleryGrid}>
              {gallery.map((url) => (
                <View key={url} style={styles.galleryTile}>
                  <EventCoverMedia
                    hue={25}
                    mediaUrl={url}
                    mediaType="image"
                    radius={10}
                    label="Venue photo"
                    height={92}
                    width={92}
                  />
                  <Pressable
                    onPress={() => void handleRemovePhoto(url)}
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                    hitSlop={8}
                    style={styles.galleryRemove}
                  >
                    <Text style={styles.galleryRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <Button
            label={
              galleryBusy
                ? "Uploading..."
                : gallery.length === 0
                  ? "Add photos"
                  : "Add more photos"
            }
            variant="secondary"
            size="md"
            leadingIcon="upload"
            loading={galleryBusy}
            disabled={galleryBusy || gallery.length >= GALLERY_MAX}
            onPress={() => void handleAddPhotos()}
          />
        </View>

        {focus === "basics" || focus === "hours" ? (
          <View style={styles.deckBlock}>
            <Text style={styles.blockTitle}>
              {focus === "hours" ? "Confirm opening hours" : "Review venue basics"}
            </Text>
            <Text style={styles.blockBody}>
              {focus === "hours"
                ? "Use the hours you entered during venue setup, then re-check your status. If hours changed, update the venue profile first."
                : "Confirm the venue name and map location are correct, then re-check your status."}
            </Text>
            <Button
              label={busy === "refresh" ? "Checking..." : "Check my status"}
              variant="secondary"
              size="md"
              loading={busy === "refresh"}
              disabled={busy !== null}
              onPress={() => void handleRefresh()}
            />
          </View>
        ) : null}

        <View style={styles.deckBlock}>
          <Text style={styles.blockTitle}>About your venue</Text>
          <Text style={styles.blockBody}>
            Tell us about your venue so Mingla recommends you to the right
            customers.
          </Text>

          <Text style={styles.fieldLabel}>Website (required)</Text>
          <TextInput
            value={website}
            onChangeText={setWebsite}
            placeholder="yourvenue.com"
            placeholderTextColor={textTokens.tertiary}
            style={styles.input}
            autoCapitalize="none"
            keyboardType="url"
          />

          <Text style={styles.fieldLabel}>Typical spend from</Text>
          {currencyQuery.isError ? (
            <Text style={styles.submitErr}>
              We couldn’t load your brand currency. Try again.
            </Text>
          ) : currencyState?.reconciliation !== null &&
            currencyState?.reconciliation !== undefined ? (
            <Text style={styles.submitErr}>
              Your payout currency changed. Review and reconcile existing
              ranges before accepting paid reservations.
            </Text>
          ) : (
            <>
              <Text style={styles.fieldHint}>
                {currencyState?.currencyCode === null ||
                currencyState?.currencyCode === undefined
                  ? "Choose your brand currency in Payments first."
                  : `${currencyState.currencyCode} · ${
                      currencyState.authority === "settlement"
                        ? "Set by your payout account"
                        : "Confirmed when you add a payout account"
                    }`}
              </Text>
              <TextInput
                value={priceMinInput}
                onChangeText={setPriceMinInput}
                placeholder="0"
                placeholderTextColor={textTokens.tertiary}
                style={styles.input}
                keyboardType="decimal-pad"
                accessibilityLabel={`Typical spend from in ${
                  currencyState?.currencyCode ?? "brand currency"
                }`}
              />
              <Text style={styles.fieldLabel}>Up to (optional)</Text>
              <TextInput
                value={priceMaxInput}
                onChangeText={setPriceMaxInput}
                placeholder="No upper limit"
                placeholderTextColor={textTokens.tertiary}
                style={styles.input}
                keyboardType="decimal-pad"
                accessibilityLabel={`Typical spend up to in ${
                  currencyState?.currencyCode ?? "brand currency"
                }`}
              />
            </>
          )}

          <Text style={styles.fieldLabel}>Best for</Text>
          <Text style={styles.fieldHint}>
            Pick the moments your venue is great for, so we recommend you to people
            planning them.
          </Text>
          <View style={styles.chipRow}>
            {VIBE_SIGNALS.map((sig) => {
              const selected = selectedVibes.includes(sig.id);
              return (
                <Pressable
                  key={sig.id}
                  onPress={() => toggleVibe(sig.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={sig.label}
                  style={[styles.chip, selected && styles.chipActive]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                    {sig.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* WS5: Google-facet yes/no questionnaire (by category). */}
          <Text style={styles.fieldLabel}>A few quick questions</Text>
          <Text style={styles.fieldHint}>
            Tap Yes or No — these sharpen your match and let our AI verify your venue.
          </Text>
          {facetQuestions.map((f) => {
            const v = facets[f.id];
            return (
              <View key={f.id} style={styles.facetRow}>
                <Text style={styles.facetQ}>{f.q}</Text>
                <View style={styles.facetBtns}>
                  <Pressable
                    onPress={() => setFacet(f.id, true)}
                    style={[styles.facetBtn, v === true && styles.facetBtnYes]}
                    accessibilityRole="button"
                    accessibilityLabel={`${f.q} Yes`}
                  >
                    <Text style={[styles.facetBtnText, v === true && styles.chipTextActive]}>
                      Yes
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setFacet(f.id, false)}
                    style={[styles.facetBtn, v === false && styles.facetBtnNo]}
                    accessibilityRole="button"
                    accessibilityLabel={`${f.q} No`}
                  >
                    <Text style={[styles.facetBtnText, v === false && styles.chipTextActive]}>
                      No
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

          {/* ORCH-1304 — no owner-side pitch generation. Save the collected
              inputs; Mingla writes the pitch + match scores at approve. */}
          <Text style={styles.fieldHint}>
            Mingla writes your pitch and match scores when it approves your venue.
          </Text>
          <Button
            label={busy === "save" ? "Saving…" : "Save changes"}
            variant="primary"
            size="md"
            loading={busy === "save"}
            disabled={busy !== null}
            onPress={() => void handleSaveChanges()}
          />
        </View>

        {/* WS5: "Am I ready?" removed — readiness is automatic (gate + engine). */}

        {coaching.length > 0 ? (
          <View style={styles.deckBlock}>
            <Text style={styles.blockTitle}>What&apos;s left before you go live</Text>
            {coaching.map((card) => (
              <View key={`${card.code}-${card.fix}`} style={styles.coachCard}>
                <Text style={styles.coachTitle}>{card.title}</Text>
                <Text style={styles.coachBody}>{card.body}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {message !== null ? <Text style={styles.submitErr}>{message}</Text> : null}
      </ScrollView>

      {/* META-ORCH-1255(C) D-C: the VENUE cover target — storage/provider
          validation like the brand target, but the picker never patches
          brands.cover_media_url. Persistence = handleCoverChange →
          syncHeroMedia → venue_listings.cover_media_* + place_pool (the
          venue row is the one owner of the venue hero; the parent brand's
          profile cover is untouched). */}
      <CoverPickerSheet
        visible={coverVisible}
        onClose={() => setCoverVisible(false)}
        target={{
          kind: "venue",
          brandId,
          venueId,
        }}
        initial={cover}
        onCoverChange={handleCoverChange}
        onShowToast={setMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  chromeSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  deckHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  deckTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  deckBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    lineHeight: 20,
  },
  deckContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  deckBlock: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  blockTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  blockBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    lineHeight: 20,
  },
  heroPreview: {
    borderRadius: 12,
    overflow: "hidden",
  },
  galleryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  galleryTile: {
    width: 92,
    height: 92,
    borderRadius: 10,
    overflow: "hidden",
  },
  galleryRemove: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  galleryRemoveText: {
    color: "#fff",
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "700",
  },
  galleryCountOk: {
    color: "#4ADE80",
    fontWeight: "700",
  },
  fieldLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  fieldHint: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    lineHeight: 17,
  },
  facetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  facetQ: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
  },
  facetBtns: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  facetBtn: {
    minWidth: 52,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  facetBtnYes: {
    borderColor: "rgba(74,222,128,0.7)",
    backgroundColor: "rgba(74,222,128,0.16)",
  },
  facetBtnNo: {
    borderColor: "rgba(248,113,113,0.6)",
    backgroundColor: "rgba(248,113,113,0.14)",
  },
  facetBtnText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    fontWeight: "700",
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.18)",
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  chipActive: {
    borderColor: "rgba(255,138,76,0.7)",
    backgroundColor: "rgba(255,138,76,0.16)",
  },
  chipText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    textTransform: "capitalize",
  },
  chipTextActive: {
    color: textTokens.primary,
    fontWeight: "700",
  },
  coachCard: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.16)",
  },
  coachTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  coachBody: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    lineHeight: 18,
  },
  submitErr: {
    fontSize: typography.caption.fontSize,
    color: "#F59E0B",
  },
});
