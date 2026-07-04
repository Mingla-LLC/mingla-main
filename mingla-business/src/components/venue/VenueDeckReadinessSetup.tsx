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
  ActivityIndicator,
  Image,
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
  refreshDeckReadiness,
  runTier2Pipeline,
  syncGallery,
  syncHeroMedia,
  updateVenuePitch,
  type PipelineCoachingCard,
} from "../../services/businessPlaceAuthoringService";
import {
  pickGalleryPhotos,
  uploadGalleryPhoto,
  VenueGalleryError,
} from "../../services/venueGalleryService";
import type { VenueCategory } from "../../types/brand";
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

// WS8: playful staged loader copy shown while "Recommend me" runs (it's the long
// op — website scan + multi-image AI). Rotates every ~2.6s in Mingla's voice.
const RECOMMEND_STAGES: readonly string[] = [
  "Fetching your website…",
  "Reading the room…",
  "Looking through your photos…",
  "Getting your vibe…",
  "Scoring your signals…",
  "Almost there…",
];

// Sub-F: keyless on-demand website screenshot (no npm dep, no API key). Shown in
// the loader so the operator sees their site actually being captured. Falls back
// to a placeholder if the screenshot service is slow/unavailable.
function websiteScreenshotUrl(website: string): string | null {
  const w = website.trim();
  if (w.length === 0) return null;
  const full = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  return `https://image.thum.io/get/width/800/${full}`;
}
function websiteHost(website: string): string {
  return website.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

// WS5: price tiers mirror the consumer deck taxonomy (app-mobile priceTiers.ts).
// Multi-select; persisted to place_pool.price_tiers + derived price_level (engine).
const PRICE_TIERS_BIZ: ReadonlyArray<{ id: string; label: string; range: string }> = [
  { id: "chill", label: "Chill", range: "$50 max" },
  { id: "comfy", label: "Comfy", range: "$50–$150" },
  { id: "bougie", label: "Bougie", range: "$150–$300" },
  { id: "lavish", label: "Lavish", range: "$300+" },
];

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
function facetQuestionsForCategory(
  cat: string,
): ReadonlyArray<{ id: string; q: string }> {
  if (cat === "play") return [...FACET_CORE, ...FACET_PLAY];
  if (cat === "creative_and_arts") return [...FACET_CORE, ...FACET_ARTS];
  return [...FACET_CORE, ...FACET_RESTAURANT]; // restaurant / default
}

const EMPTY_COVER: CoverPatch = {
  coverMediaUrl: null,
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
  initialPendingBio = null,
  initialFacets = EMPTY_FACETS,
  initialCoaching = EMPTY_COACHING,
  initialCover = null,
  initialGallery = EMPTY_GALLERY,
}: VenueDeckReadinessSetupProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const venueCategory = venueCategoryProp ?? "restaurant";
  const facetQuestions = facetQuestionsForCategory(venueCategory);
  const [coverVisible, setCoverVisible] = useState(false);
  const [gallery, setGallery] = useState<string[]>(initialGallery);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [cover, setCover] = useState<CoverPatch>({
    ...EMPTY_COVER,
    coverMediaUrl: initialCover?.coverMediaUrl ?? null,
    coverMediaType: initialCover?.coverMediaType ?? null,
  });
  const [website, setWebsite] = useState(
    stringValue(initialTier2.website, ""),
  );
  // WS5: multi-select price tiers (Chill/Comfy/Bougie/Lavish), matching the
  // consumer deck's price_tiers taxonomy.
  const [priceTiers, setPriceTiers] = useState<string[]>(
    stringArray(initialTier2.price_tiers),
  );
  const [selectedVibes, setSelectedVibes] = useState<string[]>(
    stringArray(initialTier2.vibe_chips),
  );
  const [generatedBio, setGeneratedBio] = useState(initialPendingBio ?? "");
  const [editedBio, setEditedBio] = useState(initialPendingBio ?? "");
  const [facets, setFacets] = useState<Record<string, boolean | null>>(
    initialFacets,
  );
  const [coaching, setCoaching] = useState<PipelineCoachingCard[]>(initialCoaching);
  const [busy, setBusy] = useState<"ai" | "confirm" | "refresh" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // WS8 + Sub-F: rotating loader copy + a live website screenshot while "Recommend
  // me" runs (spinner over the screenshot, messages beneath).
  const [recommendStage, setRecommendStage] = useState(0);
  const [shotFailed, setShotFailed] = useState(false);

  useEffect(() => {
    if (busy !== "ai") {
      setRecommendStage(0);
      setShotFailed(false);
      return undefined;
    }
    const id = setInterval(() => {
      setRecommendStage((i) => Math.min(i + 1, RECOMMEND_STAGES.length - 1));
    }, 2000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    setWebsite(stringValue(initialTier2.website, ""));
    setPriceTiers(stringArray(initialTier2.price_tiers));
    setSelectedVibes(stringArray(initialTier2.vibe_chips));
    setGeneratedBio(initialPendingBio ?? "");
    setEditedBio(initialPendingBio ?? "");
    setFacets(initialFacets);
    setCoaching(initialCoaching);
  }, [initialCoaching, initialFacets, initialPendingBio, initialTier2]);

  useEffect(() => {
    setGallery(initialGallery);
  }, [initialGallery]);

  useEffect(() => {
    if (focus === "cover") setCoverVisible(true);
  }, [focus]);

  const buildTier2 = useCallback(
    () => ({
      website: website.trim() || null,
      price_tiers: priceTiers,
      vibe_chips: selectedVibes,
      facets,
      operator_inputs: {
        tagline: operatorTagline,
        description: operatorDescription,
      },
    }),
    [operatorDescription, operatorTagline, facets, priceTiers, selectedVibes, website],
  );

  // WS5: "Recommend me" is only enabled once the venue has the must-haves.
  const recommendReady =
    cover.coverMediaUrl !== null &&
    gallery.length >= GALLERY_MIN &&
    website.trim().length > 0 &&
    priceTiers.length > 0;

  const togglePrice = useCallback((id: string): void => {
    setPriceTiers((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }, []);

  const setFacet = useCallback((id: string, val: boolean): void => {
    setFacets((prev) => ({ ...prev, [id]: val }));
  }, []);

  const handleCoverChange = useCallback(
    (patch: CoverPatch): void => {
      setCover(patch);
      void syncHeroMedia({
        brandId,
        venueId,
        placePoolId,
        coverMediaUrl: patch.coverMediaUrl,
        coverMediaType: patch.coverMediaType,
      }).catch((error) => {
        setMessage(
          sanitizeAuthoringError(
            error,
            "Cover saved, but deck readiness did not sync yet.",
          ),
        );
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

  const handleRunAi = useCallback(async (): Promise<void> => {
    setBusy("ai");
    setMessage(null);
    try {
      const result = await runTier2Pipeline({
        brandId,
        venueId,
        placePoolId,
        tier2: buildTier2(),
      });
      setGeneratedBio(result.generated_bio);
      setEditedBio(result.generated_bio);
      setFacets(result.facets);
      setCoaching(result.coaching);
      // META-ORCH-1290 D-2 — no owner "approve": scoring + go-live are admin-
      // owned now. The AI writes a pitch DRAFT; the owner reviews/edits + saves.
      setMessage("Your pitch is ready — review it below and make it yours.");
    } catch (error) {
      setMessage(sanitizeAuthoringError(error, "Couldn't draft your pitch."));
    } finally {
      setBusy(null);
    }
  }, [brandId, venueId, buildTier2, placePoolId]);

  // META-ORCH-1290 Leg B (§4.3.E) — the old owner self-publish confirm seam
  // (which flipped deck_eligible before any admin review) is REMOVED (D-2).
  // Editing here now just SAVES the pitch draft (staged; applied at approve) and
  // returns — it flips NO serving column and NEVER sets deck_eligible. This is
  // the pre-approval edit surface, so pitch saves stage (a live venue edits its
  // pitch on the listing page, which writes generative_summary directly).
  const handleSavePitch = useCallback(async (): Promise<void> => {
    const pitch = editedBio.trim();
    if (pitch.length > 0 && pitch.length < 20) {
      setMessage("Your pitch needs at least 20 characters — or clear it.");
      return;
    }
    setBusy("confirm");
    setMessage(null);
    try {
      await updateVenuePitch({ placePoolId, pitch, isLive: false });
      onDone();
    } catch (error) {
      setMessage(sanitizeAuthoringError(error, "Could not save your pitch."));
    } finally {
      setBusy(null);
    }
  }, [editedBio, onDone, placePoolId]);

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
          Mingla recommends venues to people deciding where to go out. Add a few
          details and our AI writes your listing and matches you to the right
          customers — couples on date night, groups celebrating, and more.
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

          {/* WS5: multi-select price tiers with $ boundaries (consumer taxonomy). */}
          <Text style={styles.fieldLabel}>Price range (pick all that fit)</Text>
          <View style={styles.chipRow}>
            {PRICE_TIERS_BIZ.map((tier) => {
              const on = priceTiers.includes(tier.id);
              return (
                <Pressable
                  key={tier.id}
                  onPress={() => togglePrice(tier.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${tier.label} ${tier.range}`}
                  style={[styles.chip, on && styles.chipActive]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextActive]}>
                    {tier.label}
                  </Text>
                  <Text style={[styles.priceRange, on && styles.chipTextActive]}>
                    {tier.range}
                  </Text>
                </Pressable>
              );
            })}
          </View>

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

          <Text style={styles.fieldHint}>
            Our AI scans your website + photos and writes a first-draft pitch you
            can edit. Mingla scores your vibes and decides go-live after you
            submit — you never approve yourself.
          </Text>
          <Button
            label={busy === "ai" ? "Working on it…" : "Generate pitch with AI"}
            variant="primary"
            size="md"
            leadingIcon="sparkle"
            loading={busy === "ai"}
            disabled={busy !== null || !recommendReady}
            onPress={() => void handleRunAi()}
          />
          {busy === "ai" ? (
            <View style={styles.loaderCard}>
              {/* Live website screenshot with the spinner over it. */}
              {websiteScreenshotUrl(website) !== null && !shotFailed ? (
                <Image
                  source={{ uri: websiteScreenshotUrl(website) as string }}
                  style={styles.loaderShot}
                  resizeMode="cover"
                  onError={() => setShotFailed(true)}
                />
              ) : (
                <View style={[styles.loaderShot, styles.loaderShotPlaceholder]} />
              )}
              <View style={styles.loaderOverlay}>
                <ActivityIndicator size="large" color="#fff" />
              </View>
              <Text style={styles.recommendStage}>
                {recommendStage === 0 && website.trim().length > 0
                  ? `Reading ${websiteHost(website)}…`
                  : RECOMMEND_STAGES[recommendStage]}
              </Text>
            </View>
          ) : null}
          {busy !== "ai" && !recommendReady ? (
            <Text style={styles.fieldHint}>
              Add a cover, {GALLERY_MIN}+ photos, a website, and a price range to
              continue.
            </Text>
          ) : null}
        </View>

        {generatedBio.length > 0 ? (
          <View style={styles.deckBlock}>
            <Text style={styles.blockTitle}>Your venue&apos;s pitch</Text>
            <Text style={styles.blockBody}>
              This is what people read when Mingla recommends you. Edit anything,
              then save — we take it from here.
            </Text>
            <TextInput
              value={editedBio}
              onChangeText={setEditedBio}
              multiline
              textAlignVertical="top"
              placeholder="Your venue's pitch"
              placeholderTextColor={textTokens.tertiary}
              style={[styles.input, styles.bioInput]}
            />
            <Button
              label={busy === "confirm" ? "Saving…" : "Save pitch"}
              variant="primary"
              size="md"
              loading={busy === "confirm"}
              disabled={busy !== null}
              onPress={() => void handleSavePitch()}
            />
          </View>
        ) : null}

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
  priceRange: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 1,
  },
  recommendStage: {
    fontSize: typography.bodySm.fontSize,
    color: "#FF8A4C",
    fontWeight: "600",
    textAlign: "center",
    marginTop: spacing.sm,
  },
  loaderCard: {
    marginTop: spacing.sm,
    alignItems: "center",
  },
  loaderShot: {
    width: "100%",
    height: 180,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  loaderShotPlaceholder: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  loaderOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 180,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 12,
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
  bioInput: {
    minHeight: 150,
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
