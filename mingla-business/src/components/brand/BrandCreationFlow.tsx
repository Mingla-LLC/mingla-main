import React, { useCallback, useEffect, useState } from "react";
// orch-strict-grep-allow orch-0892 — META-ORCH-0972 Sub-B BrandCreationFlow is a 4-step universal brand creation flow; keyboard-input fields (brand name, bio, address) sit at top of viewport and are not scroll-occluded by the on-screen keyboard. SmartScrollView migration deferred to a dedicated keyboard-hygiene follow-up ORCH.
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
// ORCH-1081 — partner mode (Step 0 + Step 5 "Invite the owner"). The toggle
// is gated on creator_accounts.partner_enabled via usePartnerStripeStatus,
// the same flag the rest of the partner surface keys off.
import { usePartnerStripeStatus } from "../../hooks/usePartnerStripe";
import { inviteBrandMember } from "../../services/brandInvitationsService";

import {
  accent,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { useCurrentBrandStore, type Brand } from "../../store/currentBrandStore";
import { useUpdateCreatorAccount } from "../../hooks/useCreatorAccount";
import {
  SlugCollisionError,
  useCreateBrand,
  useUpdateBrand,
} from "../../hooks/useBrands";
import { joinBrandDescription } from "../../services/brandMapping";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Stepper } from "../ui/Stepper";
import { Toast } from "../ui/Toast";
import {
  OfferingChooser,
  routeForOffering,
  type OfferingKind,
} from "./OfferingChooser";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
// META-ORCH-1009 Sub-F (WS1+WS2): validated address autocomplete + cover preview.
// ORCH-1079 [Business-venue Google→Mapbox sweep]: swapped to the shared Mapbox
// picker. The Mapbox `placeId` (a mapbox_id) is IGNORED for persistence — we set
// `googlePlaceId: null` so a mapbox_id never lands in `brands.google_place_id`.
// Mapbox Search Box /suggest returns POIs/businesses by name (no `types` filter):
// https://docs.mapbox.com/api/search/search-box/#get-suggestions
import { MapboxAddressInput } from "../location/MapboxAddressInput";
import { parseVenuePlaceResult } from "../../utils/parseVenuePlaceResult";
import type { PlaceDetails } from "../../services/mapboxGeocodeService";
import { EventCoverMedia } from "../ui/EventCoverMedia";

export interface BrandCreationFlowProps {
  onComplete: (newBrandId: string) => void;
  onCancel?: () => void;
}

// ORCH-1081 — step 0 = partner-mode picker (only visible to flagged partners),
// step 5 = "Invite the owner" appended when partner-mode "client" is picked.
// Step ids stay numeric for back-compat with the existing reducer + stepper
// integers; the new steps are 0 and 5.
export type BrandCreationStep = 0 | 1 | 2 | 3 | 4 | 5;

export type PartnerMode = "self" | "client";

export interface BrandCreationState {
  step: BrandCreationStep;
  name: string;
  bio: string;
  address: string | null;
  brandId: string | null;
  // ORCH-1081 — partner-mode state. When the user is NOT a flagged partner
  // mode stays 'self' forever and step 0 is skipped (initial step = 1).
  mode: PartnerMode;
}

export type BrandCreationAction =
  | { type: "setIdentity"; name: string; bio: string }
  | { type: "brandCreated"; brandId: string }
  | { type: "setAddress"; address: string | null }
  | { type: "setMode"; mode: PartnerMode }
  | { type: "next" }
  | { type: "back" };

export const BRAND_CREATION_INITIAL_STATE: BrandCreationState = {
  step: 1,
  name: "",
  bio: "",
  address: null,
  brandId: null,
  mode: "self",
};

export const BRAND_CREATION_COPY = {
  step0: {
    title: "Who's this brand for?",
    subtitle:
      "You can set up a brand for yourself or for a client venue you're helping onboard.",
    selfTitle: "It's mine",
    selfBody: "Standard brand setup — you'll be the brand owner.",
    clientTitle: "I'm setting it up for a client",
    clientBody:
      "Build out the brand, then invite the real owner. You earn 0.15% on every ticket they sell.",
    cta: "Continue",
  },
  step1: {
    title: "Create brand",
    titleClient: "Create the client's brand",
    nameLabel: "Brand name",
    nameLabelClient: "What's their venue called?",
    namePlaceholder: "e.g. Wandering Soul Retreats",
    namePlaceholderClient: "e.g. The Vibe Bar",
    bioLabel: "Short bio (optional)",
    bioLabelClient: "Describe the brand the way the owner would",
    bioPlaceholder: "Tell people what you're about — 200 characters.",
    bioPlaceholderClient:
      "Tell people what this brand is about — 200 characters.",
    cta: "Continue",
  },
  step2: {
    title: "Add an address?",
    subtitle:
      "We'll use this to pre-fill venues for any experiences you publish. You can add this later.",
    addressPlaceholder: "e.g. 12 Soho Square, London",
    skip: "Skip for now",
    cta: "Continue",
  },
  step3: {
    title: "Add a cover (optional)",
    skip: "Skip",
    cta: "Done",
  },
  step4: {
    headline: "What do you want to make first?",
    subhead: "Mix and match anytime.",
  },
  step5: {
    title: "Invite the owner",
    subtitle:
      "Send them an invite to take ownership. They'll connect their bank to start selling.",
    emailLabel: "Owner email",
    emailPlaceholder: "owner@example.com",
    noteLabel: "Personal message (optional)",
    notePlaceholder:
      "e.g. Hey — I set up your Mingla brand. Accept to take over.",
    ctaDefault: "Save & invite the owner",
    ctaWithName: (first: string): string => `Save & invite ${first}`,
    successToast: (brand: string, email: string): string =>
      `${brand} saved. We sent the invite to ${email}.`,
    inviteErrorToast: "Couldn't send the invite. Tap to retry.",
  },
  createErrorToast: "Couldn't create brand. Tap to retry.",
} as const;

export const brandCreationReducer = (
  state: BrandCreationState,
  action: BrandCreationAction,
): BrandCreationState => {
  switch (action.type) {
    case "setIdentity":
      return { ...state, name: action.name, bio: action.bio };
    case "brandCreated":
      return { ...state, brandId: action.brandId, step: 2 };
    case "setAddress":
      return { ...state, address: action.address, step: 3 };
    case "setMode":
      return { ...state, mode: action.mode };
    case "next": {
      // ORCH-1081 — in client mode, after step 3 (cover) we go to step 5
      // (Invite the owner) instead of step 4 (offering chooser). The client
      // path's terminal step is the invite.
      const max = state.mode === "client" ? 5 : 4;
      const nextStep = state.mode === "client" && state.step === 3
        ? 5
        : Math.min(max, (state.step as number) + 1);
      return { ...state, step: nextStep as BrandCreationStep };
    }
    case "back": {
      // Min back-step honors partner-mode visibility: only flagged partners
      // can step back to 0. For everyone else, 1 is the floor.
      const min = 0;
      // Mirror the next-step jump backwards: from step 5 → step 3.
      const prevStep = state.step === 5 ? 3 : Math.max(min, (state.step as number) - 1);
      return { ...state, step: prevStep as BrandCreationStep };
    }
    default:
      return state;
  }
};

const STEPS_SELF = [
  { id: "identity", label: "Identity" },
  { id: "address", label: "Address" },
  { id: "cover", label: "Cover" },
  { id: "welcome", label: "Welcome" },
];

// ORCH-1081 — partner client-mode stepper. Replaces "Welcome" with "Invite".
const STEPS_CLIENT = [
  { id: "mode", label: "Mode" },
  { id: "identity", label: "Identity" },
  { id: "address", label: "Address" },
  { id: "cover", label: "Cover" },
  { id: "invite", label: "Invite" },
];

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32) || `brand${Date.now().toString(36)}`;

export const BrandCreationFlow: React.FC<BrandCreationFlowProps> = ({
  onComplete,
  onCancel,
}) => {
  const router = useRouter();
  const { user } = useAuth();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const createBrandMutation = useCreateBrand();
  const updateBrandMutation = useUpdateBrand();
  const updateCreatorAccountMutation = useUpdateCreatorAccount();

  // ORCH-1081 — gate Step 0 on creator_accounts.partner_enabled. Read via the
  // existing usePartnerStripeStatus hook so the flag is consistent app-wide.
  const partnerStatus = usePartnerStripeStatus();
  const isPartner = partnerStatus.data?.partner_enabled === true;

  // ORCH-1081 — `partner_mode=client` query param pre-flags client mode (used
  // by the /partner/brands empty-state CTA + the earnings nudge card).
  const params = useLocalSearchParams<{ partner_mode?: string | string[] }>();
  const partnerModeParam = Array.isArray(params.partner_mode)
    ? params.partner_mode[0]
    : params.partner_mode;

  const initialState: BrandCreationState = (() => {
    // For flagged partners, step 0 is the entry point. Non-partners start at 1.
    // Pre-flagged client-mode (via deep-link) lands the user on step 1 with
    // mode='client' already set.
    if (isPartner && partnerModeParam === "client") {
      return { ...BRAND_CREATION_INITIAL_STATE, mode: "client", step: 1 };
    }
    if (isPartner) {
      return { ...BRAND_CREATION_INITIAL_STATE, step: 0 };
    }
    return BRAND_CREATION_INITIAL_STATE;
  })();

  const [state, setState] = useState<BrandCreationState>(initialState);

  // If partner status arrives AFTER initial mount (network race), promote the
  // user to step 0 IF they haven't started the wizard yet (still on step 1
  // with no name typed). Never demote.
  useEffect(() => {
    if (
      isPartner &&
      state.step === 1 &&
      state.name === "" &&
      state.bio === "" &&
      state.mode === "self" &&
      partnerModeParam !== "client"
    ) {
      setState((prev) => ({ ...prev, step: 0 }));
    }
  }, [
    isPartner,
    state.step,
    state.name,
    state.bio,
    state.mode,
    partnerModeParam,
  ]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [address, setAddress] = useState("");
  // META-ORCH-1009 Sub-F WS1: validated-address metadata. Only set when the user
  // PICKS an autocomplete result; cleared on free-text typing so Continue stays
  // gated until a real, geocoded address is chosen (Skip handles no-address brands).
  const [addrMeta, setAddrMeta] = useState<{
    lat: number | null;
    lng: number | null;
    city: string | null;
    countryCode: string | null;
    googlePlaceId: string | null;
  }>({ lat: null, lng: null, city: null, countryCode: null, googlePlaceId: null });
  const [toast, setToast] = useState<string | null>(null);
  const [coverPickerVisible, setCoverPickerVisible] = useState(false);
  // ORCH-1081 — partner-mode Step 5 form state.
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [inviteeNote, setInviteeNote] = useState("");
  const [invitePending, setInvitePending] = useState(false);

  const addressValidated =
    address.trim().length > 0 && addrMeta.lat !== null && addrMeta.lng !== null;

  const accountId = user?.id ?? null;
  const trimmedName = name.trim();

  const updateState = useCallback((action: BrandCreationAction): void => {
    setState((prev) => brandCreationReducer(prev, action));
  }, []);

  const commitDefaultBrand = useCallback(
    (newBrand: Brand): void => {
      setCurrentBrand(newBrand);
      void updateCreatorAccountMutation
        .mutateAsync({ default_brand_id: newBrand.id })
        .catch(() => undefined);
    },
    [setCurrentBrand, updateCreatorAccountMutation],
  );

  const handleCreateIdentity = useCallback(async (): Promise<void> => {
    if (trimmedName.length === 0 || accountId === null) return;
    try {
      updateState({ type: "setIdentity", name: trimmedName, bio });
      const newBrand = await createBrandMutation.mutateAsync({
        accountId,
        name: trimmedName,
        slug: slugify(trimmedName),
        address: null,
        coverHue: 25,
        bio: bio.trim().length > 0 ? bio.trim() : undefined,
        // ORCH-1081 — partner client mode flags brand at insert.
        partnerSetup: state.mode === "client",
      });
      setBrand(newBrand);
      commitDefaultBrand(newBrand);
      updateState({ type: "brandCreated", brandId: newBrand.id });
    } catch (error) {
      if (error instanceof SlugCollisionError) {
        setToast(
          `This brand name is taken. Try a small variation (e.g. "${trimmedName} Events").`,
        );
      } else {
        setToast(BRAND_CREATION_COPY.createErrorToast);
      }
    }
  }, [
    accountId,
    bio,
    commitDefaultBrand,
    createBrandMutation,
    trimmedName,
    updateState,
  ]);

  const persistAddress = useCallback(
    async (
      nextAddress: string | null,
      geo: typeof addrMeta,
    ): Promise<void> => {
      if (brand === null || accountId === null) return;
      // WS1: only attach the validated geo when a real address was picked
      // (Continue is gated on that). Skip leaves the brand's geo untouched.
      const patch: Partial<Brand> = { address: nextAddress };
      if (nextAddress !== null && geo.lat !== null && geo.lng !== null) {
        patch.lat = geo.lat;
        patch.lng = geo.lng;
        if (geo.city !== null) patch.city = geo.city;
        if (geo.countryCode !== null) patch.countryCode = geo.countryCode;
        if (geo.googlePlaceId !== null) patch.googlePlaceId = geo.googlePlaceId;
      }
      const nextBrand = await updateBrandMutation.mutateAsync({
        brandId: brand.id,
        accountId,
        patch,
        existingDescription: joinBrandDescription(brand.tagline, brand.bio),
      });
      setBrand(nextBrand);
      setCurrentBrand(nextBrand);
    },
    [accountId, brand, setCurrentBrand, updateBrandMutation],
  );

  const handleContinueAddress = useCallback(async (): Promise<void> => {
    // WS1: Continue only fires for a validated pick; Skip uses address=null.
    const nextAddress = address.trim().length > 0 ? address.trim() : null;
    try {
      await persistAddress(nextAddress, addrMeta);
      updateState({ type: "setAddress", address: nextAddress });
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Couldn't save address. Tap to retry.",
      );
    }
  }, [address, addrMeta, persistAddress, updateState]);

  const handleSkipAddress = useCallback((): void => {
    setAddress("");
    setAddrMeta({ lat: null, lng: null, city: null, countryCode: null, googlePlaceId: null });
    updateState({ type: "setAddress", address: null });
  }, [updateState]);

  const handleOfferingSelect = useCallback(
    (offering: OfferingKind): void => {
      if (brand === null) return;
      onComplete(brand.id);
      router.push(routeForOffering(offering) as never);
    },
    [brand, onComplete, router],
  );

  // ORCH-1081 — Step 5: invite the owner. Uses inviteBrandMember with
  // role=brand_owner + partner_setup=true. Same edge fn the team-invite UI
  // calls, so we inherit auth/permission gating.
  const trimmedInviteeEmail = inviteeEmail.trim().toLowerCase();
  const inviteeEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    trimmedInviteeEmail,
  );

  const handleInviteOwner = useCallback(async (): Promise<void> => {
    if (brand === null) return;
    if (!inviteeEmailValid) return;
    setInvitePending(true);
    try {
      // The edge fn requires a non-empty invitee_name; derive a sensible default
      // from the email local-part. The owner can edit their display_name later.
      const localPart = trimmedInviteeEmail.split("@")[0] ?? "owner";
      const inviteeName = localPart.length > 0 ? localPart : "owner";
      await inviteBrandMember({
        brandId: brand.id,
        inviteeEmail: trimmedInviteeEmail,
        inviteeName,
        role: "brand_owner",
        personalNote: inviteeNote.trim().length > 0
          ? inviteeNote.trim()
          : undefined,
        partnerSetup: true,
      });
      // Brand row already inserted (with partner_setup=true) at step 1. We
      // commit the optimistic complete + surface the success toast on the
      // landing surface. The post-create caller renders its own success UX.
      setToast(
        BRAND_CREATION_COPY.step5.successToast(
          brand.displayName,
          trimmedInviteeEmail,
        ),
      );
      onComplete(brand.id);
    } catch (err) {
      console.error("[BrandCreationFlow] partner invite failed", err);
      setToast(BRAND_CREATION_COPY.step5.inviteErrorToast);
    } finally {
      setInvitePending(false);
    }
  }, [
    brand,
    inviteeEmailValid,
    inviteeNote,
    onComplete,
    trimmedInviteeEmail,
  ]);

  // CTA label varies with whether email-local-part is fillable.
  const inviteCtaLabel = trimmedInviteeEmail.length > 0
    ? BRAND_CREATION_COPY.step5.ctaWithName(
      capitalize(trimmedInviteeEmail.split("@")[0] ?? "the owner"),
    )
    : BRAND_CREATION_COPY.step5.ctaDefault;

  // ORCH-1081 — pick the stepper variant + compute the active-index based on
  // partner mode. The 'self' path uses the legacy 4-step stepper; the 'client'
  // path uses a 5-step stepper that re-labels the welcome stop as 'Invite'.
  const stepperVariant = state.mode === "client" ? STEPS_CLIENT : STEPS_SELF;
  const currentIndex = state.mode === "client"
    ? (state.step === 0 ? 0
      : state.step === 1 ? 1
      : state.step === 2 ? 2
      : state.step === 3 ? 3
      : state.step === 5 ? 4 : 0)
    : Math.max(0, (state.step as number) - 1);

  const isAtEntry = state.step === 0 || (state.step === 1 && !isPartner);

  return (
    <View style={styles.host}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (isAtEntry) onCancel?.();
            else updateState({ type: "back" });
          }}
          accessibilityRole="button"
          accessibilityLabel={isAtEntry ? "Cancel brand creation" : "Back"}
          style={styles.backTouch}
        >
          <Icon name={isAtEntry ? "close" : "chevL"} size={18} color={textTokens.secondary} />
        </Pressable>
        <Stepper steps={stepperVariant} currentIndex={currentIndex} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {state.step === 0 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>{BRAND_CREATION_COPY.step0.title}</Text>
            <Text style={styles.body}>
              {BRAND_CREATION_COPY.step0.subtitle}
            </Text>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: state.mode === "self" }}
              accessibilityLabel={BRAND_CREATION_COPY.step0.selfTitle}
              onPress={() => updateState({ type: "setMode", mode: "self" })}
              style={styles.modeCardWrap}
            >
              <GlassCard
                variant="elevated"
                padding={spacing.lg}
                style={state.mode === "self" ? styles.modeCardActive : undefined}
              >
                <View style={styles.modeCardRow}>
                  <View style={styles.modeCardCol}>
                    <Text style={styles.modeCardTitle}>
                      {BRAND_CREATION_COPY.step0.selfTitle}
                    </Text>
                    <Text style={styles.modeCardBody}>
                      {BRAND_CREATION_COPY.step0.selfBody}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radioDot,
                      state.mode === "self" && styles.radioDotActive,
                    ]}
                  />
                </View>
              </GlassCard>
            </Pressable>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: state.mode === "client" }}
              accessibilityLabel={BRAND_CREATION_COPY.step0.clientTitle}
              onPress={() => updateState({ type: "setMode", mode: "client" })}
              style={styles.modeCardWrap}
            >
              <GlassCard
                variant="elevated"
                padding={spacing.lg}
                style={
                  state.mode === "client" ? styles.modeCardActive : undefined
                }
              >
                <View style={styles.modeCardRow}>
                  <View style={styles.modeCardCol}>
                    <Text style={styles.modeCardTitle}>
                      🤝 {BRAND_CREATION_COPY.step0.clientTitle}
                    </Text>
                    <Text style={styles.modeCardBody}>
                      {BRAND_CREATION_COPY.step0.clientBody}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radioDot,
                      state.mode === "client" && styles.radioDotActive,
                    ]}
                  />
                </View>
              </GlassCard>
            </Pressable>
          </View>
        ) : null}

        {state.step === 1 ? (
          <View style={styles.stepBody}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>
                {state.mode === "client"
                  ? BRAND_CREATION_COPY.step1.titleClient
                  : BRAND_CREATION_COPY.step1.title}
              </Text>
              {state.mode === "client" ? (
                <Text style={styles.partnerChip}>🤝 Client setup</Text>
              ) : null}
            </View>
            <Text style={styles.label}>
              {state.mode === "client"
                ? BRAND_CREATION_COPY.step1.nameLabelClient
                : BRAND_CREATION_COPY.step1.nameLabel}
            </Text>
            <Input
              variant="text"
              value={name}
              onChangeText={setName}
              placeholder={
                state.mode === "client"
                  ? BRAND_CREATION_COPY.step1.namePlaceholderClient
                  : BRAND_CREATION_COPY.step1.namePlaceholder
              }
              accessibilityLabel={BRAND_CREATION_COPY.step1.nameLabel}
              clearable
            />
            <Text style={styles.label}>
              {state.mode === "client"
                ? BRAND_CREATION_COPY.step1.bioLabelClient
                : BRAND_CREATION_COPY.step1.bioLabel}
            </Text>
            <TextInput
              value={bio}
              onChangeText={(value) => setBio(value.slice(0, 200))}
              placeholder={
                state.mode === "client"
                  ? BRAND_CREATION_COPY.step1.bioPlaceholderClient
                  : BRAND_CREATION_COPY.step1.bioPlaceholder
              }
              placeholderTextColor={textTokens.quaternary}
              accessibilityLabel={BRAND_CREATION_COPY.step1.bioLabel}
              multiline
              style={styles.textArea}
            />
          </View>
        ) : null}

        {state.step === 2 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>{BRAND_CREATION_COPY.step2.title}</Text>
            <Text style={styles.body}>{BRAND_CREATION_COPY.step2.subtitle}</Text>
            {/* WS1: validated autocomplete. Free-text typing clears the geo meta so
                Continue stays gated until a real result is picked; Skip handles
                brands with no fixed address. */}
            <MapboxAddressInput
              value={address}
              onChangeText={(t) => {
                setAddress(t);
                setAddrMeta({
                  lat: null,
                  lng: null,
                  city: null,
                  countryCode: null,
                  googlePlaceId: null,
                });
              }}
              onPick={(details: PlaceDetails): void => {
                const p = parseVenuePlaceResult(details);
                setAddress(p.formattedAddress);
                // ORCH-1079 LOCKED (§3.B): write geo identically but set
                // googlePlaceId: null — the Mapbox mapbox_id (`p.placeId`) is
                // IGNORED so it never pollutes `brands.google_place_id`.
                setAddrMeta({
                  lat: p.lat,
                  lng: p.lng,
                  city: p.city,
                  countryCode: p.countryCode,
                  googlePlaceId: null,
                });
              }}
              onClear={(): void => {
                setAddress("");
                setAddrMeta({
                  lat: null,
                  lng: null,
                  city: null,
                  countryCode: null,
                  googlePlaceId: null,
                });
              }}
              placeholder={BRAND_CREATION_COPY.step2.addressPlaceholder}
            />
          </View>
        ) : null}

        {state.step === 3 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>{BRAND_CREATION_COPY.step3.title}</Text>
            <GlassCard variant="elevated" padding={spacing.lg}>
              <View style={styles.coverPrompt}>
                {/* WS2: render the chosen cover so the user sees it saved. */}
                {brand?.coverMediaUrl != null ? (
                  <View style={styles.coverPreview}>
                    <EventCoverMedia
                      hue={25}
                      mediaUrl={brand.coverMediaUrl}
                      mediaType={brand.coverMediaType ?? "image"}
                      radius={radius.md}
                      label="Brand cover preview"
                      height={170}
                      muted
                    />
                  </View>
                ) : (
                  <>
                    <Icon name="upload" size={24} color={accent.warm} />
                    <Text style={styles.body}>
                      Use your existing cover picker to add a photo or GIF, or skip it for now.
                    </Text>
                  </>
                )}
                <Button
                  label={brand?.coverMediaUrl != null ? "Change cover" : "Add cover"}
                  onPress={() => setCoverPickerVisible(true)}
                  variant="secondary"
                  size="md"
                  disabled={brand === null || accountId === null}
                />
              </View>
            </GlassCard>
          </View>
        ) : null}

        {state.step === 4 ? (
          <OfferingChooser
            variant="brand-create-welcome"
            headline={BRAND_CREATION_COPY.step4.headline}
            subhead={BRAND_CREATION_COPY.step4.subhead}
            onSelect={handleOfferingSelect}
          />
        ) : null}

        {state.step === 5 ? (
          <View style={styles.stepBody}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>
                {BRAND_CREATION_COPY.step5.title}
              </Text>
              <Text style={styles.partnerChip}>🤝 Client setup</Text>
            </View>
            <Text style={styles.body}>
              {BRAND_CREATION_COPY.step5.subtitle}
            </Text>
            <Text style={styles.label}>
              {BRAND_CREATION_COPY.step5.emailLabel}
            </Text>
            <Input
              variant="text"
              value={inviteeEmail}
              onChangeText={setInviteeEmail}
              placeholder={BRAND_CREATION_COPY.step5.emailPlaceholder}
              accessibilityLabel={BRAND_CREATION_COPY.step5.emailLabel}
              clearable
            />
            <Text style={styles.label}>
              {BRAND_CREATION_COPY.step5.noteLabel}
            </Text>
            <TextInput
              value={inviteeNote}
              onChangeText={(v) => setInviteeNote(v.slice(0, 280))}
              placeholder={BRAND_CREATION_COPY.step5.notePlaceholder}
              placeholderTextColor={textTokens.quaternary}
              accessibilityLabel={BRAND_CREATION_COPY.step5.noteLabel}
              multiline
              style={styles.textArea}
            />
            {/* Preview card — minimal hero/title/CTA mirror of the email. */}
            <GlassCard variant="elevated" padding={spacing.lg}>
              <Text style={styles.previewEyebrow}>EMAIL PREVIEW</Text>
              {brand?.coverMediaUrl != null ? (
                <View style={styles.coverPreview}>
                  <EventCoverMedia
                    hue={25}
                    mediaUrl={brand.coverMediaUrl}
                    mediaType={brand.coverMediaType ?? "image"}
                    radius={radius.md}
                    label="Brand cover preview"
                    height={120}
                    muted
                  />
                </View>
              ) : (
                <View style={styles.previewHeroFallback}>
                  <Text style={styles.previewHeroFallbackText}>
                    {(brand?.displayName ?? name).slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.previewAttribution}>
                🤝 Set up for you on Mingla
              </Text>
              <Text style={styles.previewTitle}>
                {brand?.displayName ?? name}
              </Text>
              <Text style={styles.previewBody}>
                Built out for you — events, cover, description. Accept to
                become the owner.
              </Text>
              <View style={styles.previewCta}>
                <Text style={styles.previewCtaText}>
                  Accept &amp; set up{" "}
                  {brand?.displayName ?? name}
                </Text>
              </View>
            </GlassCard>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {state.step === 0 ? (
          <Button
            label={BRAND_CREATION_COPY.step0.cta}
            onPress={() => updateState({ type: "next" })}
            variant="primary"
            size="lg"
          />
        ) : null}
        {state.step === 1 ? (
          <Button
            label={BRAND_CREATION_COPY.step1.cta}
            onPress={() => void handleCreateIdentity()}
            variant="primary"
            size="lg"
            disabled={trimmedName.length === 0 || createBrandMutation.isPending}
            loading={createBrandMutation.isPending}
          />
        ) : null}
        {state.step === 2 ? (
          <View style={styles.footerRow}>
            <Button
              label={BRAND_CREATION_COPY.step2.skip}
              onPress={handleSkipAddress}
              variant="secondary"
              size="lg"
              style={styles.footerButton}
            />
            <Button
              label={BRAND_CREATION_COPY.step2.cta}
              onPress={() => void handleContinueAddress()}
              variant="primary"
              size="lg"
              loading={updateBrandMutation.isPending}
              disabled={!addressValidated || updateBrandMutation.isPending}
              style={styles.footerButton}
            />
          </View>
        ) : null}
        {state.step === 3 ? (
          <View style={styles.footerRow}>
            <Button
              label={BRAND_CREATION_COPY.step3.skip}
              onPress={() => updateState({ type: "next" })}
              variant="secondary"
              size="lg"
              style={styles.footerButton}
            />
            <Button
              label={BRAND_CREATION_COPY.step3.cta}
              onPress={() => updateState({ type: "next" })}
              variant="primary"
              size="lg"
              style={styles.footerButton}
            />
          </View>
        ) : null}
        {state.step === 5 ? (
          <Button
            label={inviteCtaLabel}
            onPress={() => void handleInviteOwner()}
            variant="primary"
            size="lg"
            disabled={!inviteeEmailValid || invitePending}
            loading={invitePending}
          />
        ) : null}
      </View>

      {/* ORCH-0989 — unified cover picker sheet (replaces BrandCoverPickerSheet);
          brand video enabled. JSX child of host (I-SUB-SHEET-INSIDE-PARENT). */}
      {brand !== null && accountId !== null ? (
        <CoverPickerSheet
          visible={coverPickerVisible}
          onClose={() => setCoverPickerVisible(false)}
          target={{
            kind: "brand",
            brandId: brand.id,
            accountId,
            existingDescription: joinBrandDescription(brand.tagline, brand.bio),
          }}
          initial={{
            coverMediaUrl: brand.coverMediaUrl ?? null,
            coverMediaType: brand.coverMediaType ?? null,
            coverMediaProvider: null,
            coverMediaSourceUrl: null,
            coverMediaCredit: null,
            coverMediaCreditUrl: null,
            coverMediaAlt: null,
          }}
          onCoverChange={(patch) =>
            setBrand((prev) =>
              prev === null
                ? prev
                : {
                    ...prev,
                    coverMediaUrl: patch.coverMediaUrl ?? undefined,
                    coverMediaType:
                      patch.coverMediaUrl === null
                        ? undefined
                        : patch.coverMediaType === "video"
                          ? "video"
                          : patch.coverMediaType === "gif"
                            ? "gif"
                            : "image",
                  },
            )
          }
          onShowToast={(msg) => {
            // BrandCreationFlow's Toast is error-styled; only surface genuine
            // failures, not the picker's selection-success confirmations.
            if (/fail|could not|couldn't|isn't|not available|try again|permission/i.test(msg)) {
              setToast(msg);
            }
          }}
        />
      ) : null}
      <Toast
        visible={toast !== null}
        kind="error"
        message={toast ?? ""}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
};

// ORCH-1081 — utility used by step-5 CTA copy ("Save & invite Sarah").
function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backTouch: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  stepBody: {
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  label: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  textArea: {
    minHeight: 112,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlignVertical: "top",
  },
  coverPrompt: {
    gap: spacing.md,
    alignItems: "flex-start",
  },
  coverPreview: {
    width: "100%",
    borderRadius: radius.md,
    overflow: "hidden",
  },
  footer: {
    padding: spacing.lg,
  },
  footerRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  footerButton: {
    flex: 1,
  },
  // ORCH-1081 — Step 0 + Step 5 + partner chip styles.
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  partnerChip: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  modeCardWrap: {
    // Pressable wrapping a GlassCard so the entire surface is tappable.
  },
  modeCardActive: {
    borderColor: accent.warm,
    borderWidth: 2,
  },
  modeCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  modeCardCol: {
    flex: 1,
    gap: 4,
  },
  modeCardTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  modeCardBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  radioDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: glass.border.profileBase,
    backgroundColor: "transparent",
  },
  radioDotActive: {
    borderColor: accent.warm,
    backgroundColor: accent.warm,
  },
  previewEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  previewHeroFallback: {
    width: "100%",
    height: 120,
    borderRadius: radius.md,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  previewHeroFallbackText: {
    fontSize: 36,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  previewAttribution: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: accent.warm,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  previewTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  previewBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: 4,
  },
  previewCta: {
    marginTop: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: accent.warm,
    borderRadius: radius.md,
    alignItems: "center",
  },
  previewCtaText: {
    color: "#FFFFFF",
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
  },
});

export default BrandCreationFlow;
