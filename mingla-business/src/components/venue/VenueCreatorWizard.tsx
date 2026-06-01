/**
 * Ve1 — 7-step venue onboarding wizard (after category selection).
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
import { useAuth } from "../../context/AuthContext";
import {
  useCreateVenueBrand,
  SlugCollisionError,
  resolveAvailableVenueSlug,
} from "../../hooks/useBrands";
import {
  confirmAiOutputs,
  refreshDeckReadiness,
  runTier2Pipeline,
  syncGallery,
  syncHeroMedia,
  upsertTier1Place,
  type PipelineCoachingCard,
} from "../../services/businessPlaceAuthoringService";
import {
  pickGalleryPhotos,
  uploadGalleryPhoto,
  VenueGalleryError,
} from "../../services/venueGalleryService";
import type { Brand } from "../../types/brand";
import type { DeckReadinessFocus } from "../../utils/deckReadinessRoutes";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import { venueStepError } from "./venueWizardValidation";
import { Button } from "../ui/Button";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
import type { CoverPatch } from "../ui/CoverPicker";
import { IconChrome } from "../ui/IconChrome";
import { Stepper, type StepperStep } from "../ui/Stepper";
import { VenueStep1Address } from "./VenueStep1Address";
import { VenueStep2NameSlug } from "./VenueStep2NameSlug";
import { VenueStep4Hours } from "./VenueStep4Hours";
import { VenueStep5Contact } from "./VenueStep5Contact";
import { VenueStep6Description } from "./VenueStep6Description";
import { VenueStep7Review } from "./VenueStep7Review";

// META-ORCH-1009 Sub-E: the old step-2 "Cover" was a dead explainer card (no
// picker) — the real hero-cover upload happens post-submit on the deck-readiness
// screen via the unified CoverPicker. Removed to drop the wasted tap (7→6 steps).
const TOTAL = 6;
const STEPPER_STEPS: StepperStep[] = [
  { id: "s0", label: "Address" },
  { id: "s1", label: "Name" },
  { id: "s2", label: "Hours" },
  { id: "s3", label: "Contact" },
  { id: "s4", label: "Inputs" },
  { id: "s5", label: "Review" },
];

export interface VenueCreatorWizardProps {
  /** Optional warning when venue was created but cover upload failed. */
  onDone: (coverWarning?: string | null) => void;
  onClose: () => void;
}

export const VenueCreatorWizard: React.FC<VenueCreatorWizardProps> = ({
  onDone,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const createVenue = useCreateVenueBrand();

  // META-ORCH-1009 Sub-E: the wizard step is sourced REACTIVELY from the
  // PERSISTED draft store so re-entry resumes where the operator stopped (not
  // always step 0). A reactive selector — rather than a one-time useState
  // initializer — also sidesteps the AsyncStorage rehydration race (the persisted
  // step lands a tick after mount and flows in automatically).
  const step = useDraftVenueStore((s) => s.step);
  const setStep = useDraftVenueStore((s) => s.setStep);
  const [showErr, setShowErr] = useState(false);
  const [slugCollision, setSlugCollision] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [createdVenue, setCreatedVenue] = useState<{
    brand: Brand;
    placePoolId: string;
  } | null>(null);

  const draft = useDraftVenueStore();
  const poolLinked = draft.placePoolId !== null;

  // B2 — the dock Continue must be visibly disabled (greyed) until the current
  // step is valid, instead of looking active and silently no-op'ing on tap.
  // On step 0 this means Continue stays greyed until a validated autocomplete
  // address (with lat/lng) is selected. Recomputed from live draft state.
  const stepValid = venueStepError(step, draft) === null;

  const goNext = useCallback((): void => {
    const e = venueStepError(step, draft);
    if (e !== null) {
      setShowErr(true);
      return;
    }
    setShowErr(false);
    setSlugCollision(null);
    setStep(Math.min(TOTAL - 1, step + 1));
  }, [draft, setStep, step]);

  const goBack = useCallback((): void => {
    setShowErr(false);
    setSlugCollision(null);
    setStep(Math.max(0, step - 1));
  }, [setStep, step]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (user?.id === undefined) return;
    setSubmitErr(null);
    const st = useDraftVenueStore.getState();
    const last = venueStepError(TOTAL - 1, st);
    if (last !== null) {
      setShowErr(true);
      return;
    }
    if (
      st.lat === null ||
      st.lng === null ||
      st.venueCategory === null
    ) {
      setSubmitErr("Some required fields are missing. Go back and check.");
      return;
    }
    try {
      for (let i = 0; i < TOTAL - 1; i++) {
        const e = venueStepError(i, st);
        if (e !== null) {
          setSubmitErr(e);
          setStep(i);
          setShowErr(true);
          return;
        }
      }
      setShowErr(false);

      // META-ORCH-1009 Sub-E: resolve a GUARANTEED-available slug at submit time,
      // regardless of what the name-step UI currently shows. This closes the gaps
      // where the UI could still carry a taken/unverified slug (availability check
      // still in flight, all 4 displayed candidates taken, or a race since the
      // check ran). resolveAvailableVenueSlug honors the shown slug if still free,
      // else advances suffixes, with a timestamp fallback that cannot run out.
      const resolvedSlug = await resolveAvailableVenueSlug(
        st.displayName.trim(),
        st.slug.trim() || null,
        user.id,
      );

      const brand = await createVenue.mutateAsync({
        accountId: user.id,
        name: st.displayName.trim(),
        slug: resolvedSlug,
        tagline: st.tagline.trim() || undefined,
        bio: st.description.trim(),
        placePoolId: st.placePoolId,
        googlePlaceId: st.googlePlaceId,
        lat: st.lat,
        lng: st.lng,
        city: st.city,
        countryCode: st.countryCode,
        address: st.formattedAddress.trim(),
        venueCategory: st.venueCategory,
        contact: {
          email: st.contactEmail.trim() || undefined,
          phone: st.contactPhone.trim() || undefined,
        },
        coverMediaUrl: null,
        coverMediaType: null,
        hours: st.hours,
      });

      const tier1 = await upsertTier1Place({
        brandId: brand.id,
        selectedPlacePoolId: st.placePoolId,
        draft: {
          name: st.displayName.trim(),
          address: st.formattedAddress.trim(),
          lat: st.lat,
          lng: st.lng,
          city: st.city,
          countryCode: st.countryCode,
          venueCategory: st.venueCategory,
          coverMediaUrl: null,
          coverMediaType: null,
          tagline: st.tagline.trim(),
          description: st.description.trim(),
          hours: st.hours,
        },
      });
      if (tier1.place_pool_id.length === 0) {
        throw new Error("place_pool_link_missing");
      }
      setCreatedVenue({ brand, placePoolId: tier1.place_pool_id });
      // META-ORCH-1009 Sub-E: make the just-created venue the ACTIVE brand. The
      // venue is its own brand; without this the operator stays on their previous
      // brand and Home shows "Add your venue" again after a reload instead of the
      // deck-readiness card. currentBrandId is persisted, so this resume survives
      // an app reload — Home lands straight on "Finish deck readiness".
      useCurrentBrandStore.getState().setCurrentBrandId(brand.id);
      // The venue is created and the flow moves to the deck-readiness screen
      // (which reads from createdVenue, not the draft). Clear the persisted draft
      // so the NEXT "Add a venue" starts clean instead of resuming this one.
      useDraftVenueStore.getState().reset();
    } catch (e) {
      if (e instanceof SlugCollisionError) {
        setSlugCollision(
          "This URL slug is taken. Go back to Name and adjust it.",
        );
        setStep(1);
        return;
      }
      if (e instanceof Error && e.message.includes("Google location")) {
        setSubmitErr(e.message);
        return;
      }
      setSubmitErr(
        e instanceof Error ? e.message : "Could not submit. Try again.",
      );
    }
  }, [createVenue, user?.id]);

  if (createdVenue !== null && user?.id !== undefined) {
    return (
      <VenueDeckReadinessSetup
        accountId={user.id}
        brand={createdVenue.brand}
        placePoolId={createdVenue.placePoolId}
        onDone={() => onDone(null)}
      />
    );
  }

  const body = ((): React.ReactElement => {
    switch (step) {
      case 0:
        return <VenueStep1Address showErrors={showErr} />;
      case 1:
        return (
          <VenueStep2NameSlug
            showErrors={showErr}
            slugError={slugCollision}
            accountId={user?.id ?? null}
          />
        );
      case 2:
        return <VenueStep4Hours showErrors={showErr} />;
      case 3:
        return <VenueStep5Contact showErrors={showErr} />;
      case 4:
        return <VenueStep6Description showErrors={showErr} />;
      case 5:
        return (
          <VenueStep7Review
            submitting={createVenue.isPending}
            submitError={submitErr}
            onSubmit={() => void handleSubmit()}
          />
        );
      default:
        return <View />;
    }
  })();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.chrome}>
        <IconChrome
          icon="x"
          accessibilityLabel="Close venue setup"
          onPress={onClose}
        />
        <View style={styles.chromeMid}>
          <Text style={styles.chromeTitle}>List your venue</Text>
          <Text style={styles.chromeSub}>
            Step {step + 1} of {TOTAL}
          </Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <Stepper steps={STEPPER_STEPS} currentIndex={step} />

      {poolLinked ? (
        <Text style={styles.poolBanner}>
          Prefilled from our directory — review each step before you submit.
        </Text>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingBottom: insets.bottom + spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>

      {step < TOTAL - 1 ? (
        <View
          style={[
            styles.dock,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={styles.dockRow}>
            {step > 0 ? (
              <Button
                label="Back"
                variant="ghost"
                size="lg"
                onPress={goBack}
              />
            ) : (
              <View style={{ width: 88 }} />
            )}
            <Button
              label="Continue"
              variant="primary"
              size="lg"
              onPress={goNext}
              disabled={!stepValid}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
};

export interface VenueDeckReadinessSetupProps {
  accountId: string;
  brand: Brand;
  placePoolId: string;
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
// AI still scores the venue against ALL 16 active signals automatically.)
const VIBE_SIGNALS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "romantic", label: "Romantic" },
  { id: "lively", label: "Lively" },
  { id: "drinks", label: "Drinks" },
  { id: "brunch", label: "Brunch" },
  { id: "casual_food", label: "Casual food" },
  { id: "fine_dining", label: "Fine dining" },
  { id: "scenic", label: "Scenic" },
  { id: "nature", label: "Nature & outdoors" },
  { id: "creative_arts", label: "Creative & arts" },
  { id: "play", label: "Play" },
  { id: "theatre", label: "Theatre" },
  { id: "movies", label: "Movies" },
];

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
  brand,
  placePoolId,
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
  const venueCategory = brand.venueCategory ?? "restaurant";
  const facetQuestions = facetQuestionsForCategory(venueCategory);
  const [coverVisible, setCoverVisible] = useState(false);
  const [gallery, setGallery] = useState<string[]>(initialGallery);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [cover, setCover] = useState<CoverPatch>({
    ...EMPTY_COVER,
    coverMediaUrl:
      initialCover?.coverMediaUrl ?? brand.coverMediaUrl ?? null,
    coverMediaType:
      initialCover?.coverMediaType ?? brand.coverMediaType ?? null,
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
        tagline: brand.tagline ?? null,
        description: brand.bio ?? null,
      },
    }),
    [brand.bio, brand.tagline, facets, priceTiers, selectedVibes, website],
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
        brandId: brand.id,
        placePoolId,
        coverMediaUrl: patch.coverMediaUrl,
        coverMediaType: patch.coverMediaType,
      }).catch((error) => {
        setMessage(
          error instanceof Error
            ? error.message
            : "Cover saved, but deck readiness did not sync yet.",
        );
      });
    },
    [brand.id, placePoolId],
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
          uploaded.push(await uploadGalleryPhoto(brand.id, asset));
        } catch (e) {
          setMessage(
            e instanceof VenueGalleryError ? e.message : "A photo failed to upload.",
          );
        }
      }
      if (uploaded.length === 0) return;
      const next = Array.from(new Set([...gallery, ...uploaded])).slice(0, GALLERY_MAX);
      setGallery(next);
      await syncGallery({ brandId: brand.id, placePoolId, galleryUrls: next });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't add photos. Try again.");
    } finally {
      setGalleryBusy(false);
    }
  }, [brand.id, gallery, placePoolId]);

  const handleRemovePhoto = useCallback(
    async (url: string): Promise<void> => {
      const next = gallery.filter((u) => u !== url);
      setGallery(next);
      try {
        await syncGallery({ brandId: brand.id, placePoolId, galleryUrls: next });
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Couldn't update photos.");
      }
    },
    [brand.id, gallery, placePoolId],
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
        brandId: brand.id,
        placePoolId,
        tier2: buildTier2(),
      });
      setGeneratedBio(result.generated_bio);
      setEditedBio(result.generated_bio);
      setFacets(result.facets);
      setCoaching(result.coaching);
      setMessage("Your listing is ready. Review the pitch below, edit anything, then approve it to go live.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI setup failed.");
    } finally {
      setBusy(null);
    }
  }, [brand.id, buildTier2, placePoolId]);

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (editedBio.trim().length < 20) {
      setMessage("Confirm a public bio of at least 20 characters.");
      return;
    }
    setBusy("confirm");
    setMessage(null);
    try {
      const result = await confirmAiOutputs({
        brandId: brand.id,
        placePoolId,
        salesBio: editedBio.trim(),
        facets,
        tier2: buildTier2(),
      });
      setCoaching(result.coaching);
      if (result.status !== "deck_eligible") {
        setMessage(
          result.coaching[0]?.body ??
            "One more fix is needed before this venue is deck-ready.",
        );
        return;
      }
      onDone();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not confirm AI outputs.",
      );
    } finally {
      setBusy(null);
    }
  }, [brand.id, buildTier2, editedBio, facets, onDone, placePoolId]);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setBusy("refresh");
    setMessage(null);
    try {
      const result = await refreshDeckReadiness({
        brandId: brand.id,
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
        error instanceof Error ? error.message : "Could not refresh deck readiness.",
      );
    } finally {
      setBusy(null);
    }
  }, [brand.id, placePoolId]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.deckHeader}>
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
            Our AI scans your website + photos, writes your pitch, and scores how
            well you match each vibe. You can edit everything before it goes live.
          </Text>
          <Button
            label={busy === "ai" ? "Working on it..." : "Recommend me to users"}
            variant="primary"
            size="md"
            leadingIcon="sparkle"
            loading={busy === "ai"}
            disabled={busy !== null || !recommendReady}
            onPress={() => void handleRunAi()}
          />
          {!recommendReady ? (
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
              This is what customers read when Mingla recommends you. Edit anything,
              then approve it to go live.
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
              label={busy === "confirm" ? "Publishing..." : "Approve & publish"}
              variant="primary"
              size="md"
              loading={busy === "confirm"}
              disabled={busy !== null}
              onPress={() => void handleConfirm()}
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

      <CoverPickerSheet
        visible={coverVisible}
        onClose={() => setCoverVisible(false)}
        target={{
          kind: "brand",
          brandId: brand.id,
          accountId,
          existingDescription:
            [brand.tagline, brand.bio].filter(Boolean).join("\n\n") || null,
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
  chrome: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chromeMid: {
    flex: 1,
    alignItems: "center",
  },
  chromeTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  chromeSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  poolBanner: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
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
  dock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  dockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
});

export default VenueCreatorWizard;
