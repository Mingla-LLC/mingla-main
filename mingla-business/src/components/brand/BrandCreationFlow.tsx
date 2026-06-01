import React, { useCallback, useState } from "react";
// orch-strict-grep-allow orch-0892 — META-ORCH-0972 Sub-B BrandCreationFlow is a 4-step universal brand creation flow; keyboard-input fields (brand name, bio, address) sit at top of viewport and are not scroll-occluded by the on-screen keyboard. SmartScrollView migration deferred to a dedicated keyboard-hygiene follow-up ORCH.
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

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
import { AddressAutocompleteInput } from "../event/AddressAutocompleteInput";
import { parseGooglePlaceResult } from "../../utils/parseGooglePlaceResult";
import type { PlaceDetails } from "../../services/googlePlacesService";
import { EventCoverMedia } from "../ui/EventCoverMedia";

export interface BrandCreationFlowProps {
  onComplete: (newBrandId: string) => void;
  onCancel?: () => void;
}

export type BrandCreationStep = 1 | 2 | 3 | 4;

export interface BrandCreationState {
  step: BrandCreationStep;
  name: string;
  bio: string;
  address: string | null;
  brandId: string | null;
}

export type BrandCreationAction =
  | { type: "setIdentity"; name: string; bio: string }
  | { type: "brandCreated"; brandId: string }
  | { type: "setAddress"; address: string | null }
  | { type: "next" }
  | { type: "back" };

export const BRAND_CREATION_INITIAL_STATE: BrandCreationState = {
  step: 1,
  name: "",
  bio: "",
  address: null,
  brandId: null,
};

export const BRAND_CREATION_COPY = {
  step1: {
    title: "Create brand",
    nameLabel: "Brand name",
    namePlaceholder: "e.g. Wandering Soul Retreats",
    bioLabel: "Short bio (optional)",
    bioPlaceholder: "Tell people what you're about — 200 characters.",
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
    case "next":
      return { ...state, step: Math.min(4, state.step + 1) as BrandCreationStep };
    case "back":
      return { ...state, step: Math.max(1, state.step - 1) as BrandCreationStep };
    default:
      return state;
  }
};

const STEPS = [
  { id: "identity", label: "Identity" },
  { id: "address", label: "Address" },
  { id: "cover", label: "Cover" },
  { id: "welcome", label: "Welcome" },
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

  const [state, setState] = useState<BrandCreationState>(
    BRAND_CREATION_INITIAL_STATE,
  );
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

  return (
    <View style={styles.host}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (state.step === 1) onCancel?.();
            else updateState({ type: "back" });
          }}
          accessibilityRole="button"
          accessibilityLabel={state.step === 1 ? "Cancel brand creation" : "Back"}
          style={styles.backTouch}
        >
          <Icon name={state.step === 1 ? "close" : "chevL"} size={18} color={textTokens.secondary} />
        </Pressable>
        <Stepper steps={STEPS} currentIndex={state.step - 1} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {state.step === 1 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>{BRAND_CREATION_COPY.step1.title}</Text>
            <Text style={styles.label}>{BRAND_CREATION_COPY.step1.nameLabel}</Text>
            <Input
              variant="text"
              value={name}
              onChangeText={setName}
              placeholder={BRAND_CREATION_COPY.step1.namePlaceholder}
              accessibilityLabel={BRAND_CREATION_COPY.step1.nameLabel}
              clearable
            />
            <Text style={styles.label}>{BRAND_CREATION_COPY.step1.bioLabel}</Text>
            <TextInput
              value={bio}
              onChangeText={(value) => setBio(value.slice(0, 200))}
              placeholder={BRAND_CREATION_COPY.step1.bioPlaceholder}
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
            <AddressAutocompleteInput
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
                const p = parseGooglePlaceResult(details);
                setAddress(p.formattedAddress);
                setAddrMeta({
                  lat: p.lat,
                  lng: p.lng,
                  city: p.city,
                  countryCode: p.countryCode,
                  googlePlaceId: p.googlePlaceId,
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
      </ScrollView>

      <View style={styles.footer}>
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
});

export default BrandCreationFlow;
