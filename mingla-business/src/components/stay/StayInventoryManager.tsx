import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BedDouble, CalendarDays, Check, X } from "lucide-react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  stayInventoryMaxWidth,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useBrandDiscoveryCurrency } from "../../hooks/useBrandDiscoveryCurrency";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import {
  stayInventoryKeys,
  useStayInventory,
} from "../../hooks/useStayInventory";
import {
  bulkCreateStayOfferings,
  changeStayOfferingStatus,
  createStayOffering,
  attachStayOfferingMedia,
  manageStayInventory,
  materializeStayPlaceWindows,
  replaceStayOfferingFees,
  replaceStayUnits,
  removeStayOfferingMedia,
  setStayOfferingPolicy,
  setStayOfferingPrice,
  updateStayOffering,
  upsertStayPlaceSchedule,
  upsertStayPlaceWindows,
  upsertStayRoomNights,
} from "../../services/stayInventoryService";
import {
  pickStayOfferingPhotos,
  stayOfferingMediaUrl,
  uploadStayOfferingPhoto,
} from "../../services/stayMediaService";
import type {
  CreateStayOfferingInput,
  StayBookingMode,
  StayInventorySnapshot,
  StayMediaInput,
  StayOfferingKind,
  StayOfferingRecord,
} from "../../types/stayInventory";
import {
  formatCurrency,
  majorFromMinor,
  minorFromMajor,
} from "../../utils/currency";
import { randomId } from "../../utils/randomId";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import {
  matchesStayInventoryFilter,
  stayOfferingReadinessErrors,
  type StayInventoryFilter,
} from "./stayInventoryPresentation";
import {
  buildStayPlaceSchedule,
  stayRoomNightCalendarKey,
  type StayPlaceScheduleMode,
} from "./stayAvailabilityContracts";

const FILTERS: readonly { id: StayInventoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "room", label: "Rooms" },
  { id: "place", label: "Places" },
  { id: "draft", label: "Draft" },
  { id: "live", label: "Live" },
  { id: "paused", label: "Paused" },
];

const asPositiveInteger = (value: string, fallback = 1): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const splitList = (value: string): string[] => [
  ...new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

function mutationCopy(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code.includes("stay_version_conflict")) {
    return "This Stay changed elsewhere. Reload before trying again.";
  }
  if (
    code.includes("paid_currency_not_ready") ||
    code.includes("stay_currency_required")
  ) {
    return "Connect a bank or choose the brand’s draft currency first.";
  }
  if (code.includes("currency_mismatch")) {
    return "The price must use this brand’s currency.";
  }
  if (code.includes("forbidden")) {
    return "Your staff permission does not allow this change.";
  }
  if (code.includes("stay_publish_incomplete")) {
    return "Finish the listed readiness items before making this live.";
  }
  return "That change did not save. Check your connection and try again.";
}

function Choice({
  label,
  selected,
  onPress,
  testID,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={[
        styles.choice,
        selected && styles.choiceActive,
        disabled && styles.choiceDisabled,
      ]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType,
  testID,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric" | "decimal-pad";
  testID: string;
  editable?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={textTokens.tertiary}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        style={[
          styles.input,
          multiline && styles.multiline,
          !editable && styles.inputDisabled,
        ]}
        testID={testID}
      />
    </View>
  );
}

interface OfferingEditorProps {
  brandId: string;
  venueId: string;
  existing?: StayOfferingRecord | null;
  canManageInventory: boolean;
  canManageFinance: boolean;
  onClose: () => void;
}

function OfferingEditor({
  brandId,
  venueId,
  existing = null,
  canManageInventory,
  canManageFinance,
  onClose,
}: OfferingEditorProps): React.ReactElement {
  // #1484 — desktop gate ONLY via the canonical hook (I-DESKTOP-GATE-VIA-HOOK).
  const { isWideDesktop } = useResponsiveLayout();
  const queryClient = useQueryClient();
  const currency = useBrandDiscoveryCurrency(brandId);
  const currencyCode = currency.data?.currencyCode ?? null;
  const [kind, setKind] = useState<StayOfferingKind>(existing?.kind ?? "room");
  const [bulk, setBulk] = useState(false);
  const [name, setName] = useState(existing?.name ?? "");
  const [bulkNames, setBulkNames] = useState("");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [quantity, setQuantity] = useState(String(existing?.quantity ?? 1));
  const [capacity, setCapacity] = useState(String(existing?.capacity ?? 10));
  const [maxGuests, setMaxGuests] = useState(String(existing?.max_guests ?? 2));
  const [price, setPrice] = useState(
    existing?.currentPrice && currencyCode
      ? String(
          majorFromMinor(
            existing.currentPrice.amount_minor,
            existing.currentPrice.currency_code,
          ),
        )
      : "",
  );
  const existingFee = existing?.currentFees?.[0] ?? null;
  const [feeLabel, setFeeLabel] = useState(existingFee?.label ?? "");
  const [feeAmount, setFeeAmount] = useState(
    existingFee?.amount_minor && existingFee.currency_code
      ? String(
          majorFromMinor(existingFee.amount_minor, existingFee.currency_code),
        )
      : "",
  );
  const [policy, setPolicy] = useState(
    existing?.currentPolicy?.cancellation_policy ?? "",
  );
  const [noShowPercent, setNoShowPercent] = useState(
    existing?.currentPolicy
      ? String(existing.currentPolicy.no_show_refund_basis_points / 100)
      : "0",
  );
  const [amenities, setAmenities] = useState(
    (existing?.amenities ?? []).join(", "),
  );
  const [unitNames, setUnitNames] = useState(
    (existing?.units ?? []).map((unit) => unit.name).join("\n"),
  );
  const [confirmationMode, setConfirmationMode] = useState<StayBookingMode>(
    existing?.confirmation_mode ?? "request",
  );
  const [namedUnits, setNamedUnits] = useState(
    existing?.unit_naming_mode === "named",
  );
  const [sharedCapacity, setSharedCapacity] = useState(
    existing?.inventory_basis === "shared_capacity",
  );
  const [overnightOnly, setOvernightOnly] = useState(
    existing?.access_scope === "overnight_guests_only",
  );
  const [media, setMedia] = useState<StayMediaInput[]>([]);
  const [removedMediaIds, setRemovedMediaIds] = useState<string[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [resultCopy, setResultCopy] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (): Promise<StayInventorySnapshot> => {
      const names = bulk ? splitList(bulkNames) : [name.trim()];
      if (names.length === 0 || names.some((item) => item.length === 0)) {
        throw new Error("name_required");
      }
      if (canManageFinance && Number(price) > 0 && currencyCode === null) {
        throw new Error("stay_currency_required");
      }
      const count = asPositiveInteger(quantity);
      const parsedUnits = splitList(unitNames);
      if (canManageInventory && namedUnits && parsedUnits.length !== count) {
        throw new Error("named_units_incomplete");
      }
      const fees: CreateStayOfferingInput["fees"] =
        canManageFinance &&
        feeLabel.trim() &&
        Number(feeAmount) > 0 &&
        currencyCode
          ? [
              {
                feeKey: `custom_${feeLabel
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "_")}`,
                label: feeLabel.trim(),
                calculation:
                  kind === "room"
                    ? "fixed_per_room_night"
                    : "fixed_per_place_booking",
                amountMinor: minorFromMajor(Number(feeAmount), currencyCode),
                currencyCode,
                displayMode: "separate",
              },
            ]
          : [];
      const policyInput: CreateStayOfferingInput["policy"] =
        canManageFinance && policy.trim()
          ? {
              cancellationPolicy: policy.trim(),
              noShowRefundBasisPoints: Math.max(
                0,
                Math.min(10000, Math.round(Number(noShowPercent) * 100)),
              ),
              operatorCancelRefundBasisPoints: 10000,
            }
          : undefined;
      const priceInput: CreateStayOfferingInput["price"] =
        canManageFinance && Number(price) > 0 && currencyCode
          ? {
              amountMinor: minorFromMajor(Number(price), currencyCode),
              currencyCode,
            }
          : undefined;
      const makeOffering = (itemName: string): CreateStayOfferingInput => ({
        kind,
        name: itemName,
        description: description.trim(),
        confirmationMode,
        inventoryBasis:
          kind === "room"
            ? "pooled_units"
            : sharedCapacity
              ? "shared_capacity"
              : "exclusive_units",
        unitNamingMode: namedUnits ? "named" : "interchangeable",
        quantity: sharedCapacity ? undefined : count,
        capacity: sharedCapacity ? asPositiveInteger(capacity) : undefined,
        minGuests: 1,
        maxGuests: asPositiveInteger(maxGuests),
        maxAdults: kind === "room" ? asPositiveInteger(maxGuests) : undefined,
        maxChildren: kind === "room" ? 0 : undefined,
        placePricingBasis: kind === "place" ? "per_booking" : undefined,
        amenities: splitList(amenities),
        accessScope:
          kind === "place" && overnightOnly
            ? "overnight_guests_only"
            : "public",
        units: namedUnits
          ? parsedUnits.map((unitName) => ({ name: unitName }))
          : undefined,
        media: canManageInventory ? media : [],
        price: priceInput,
        fees,
        policy: policyInput,
      });

      if (existing) {
        let inventory =
          queryClient.getQueryData<StayInventorySnapshot>(
            stayInventoryKeys.detail(venueId),
          ) ??
          (await manageStayInventory<StayInventorySnapshot>({
            action: "get",
            venueId,
          }));
        if (canManageInventory) {
          inventory = (
            await updateStayOffering({
              venueId,
              offeringId: existing.id,
              expectedVersion: existing.version,
              patch: {
                name: names[0],
                description: description.trim(),
                confirmationMode,
                amenities: splitList(amenities),
                accessScope:
                  kind === "place" && overnightOnly
                    ? "overnight_guests_only"
                    : "public",
              },
            })
          ).inventory;
        }
        const nextVersion = (): number => {
          const current = inventory.offerings.find(
            (item) => item.id === existing.id,
          );
          if (!current) throw new Error("stay_offering_not_found");
          return current.version;
        };
        if (canManageFinance && priceInput) {
          inventory = (
            await setStayOfferingPrice({
              venueId,
              offeringId: existing.id,
              expectedVersion: nextVersion(),
              price: priceInput,
            })
          ).inventory;
        }
        if (canManageFinance && policyInput) {
          inventory = (
            await setStayOfferingPolicy({
              venueId,
              offeringId: existing.id,
              expectedVersion: nextVersion(),
              policy: policyInput,
            })
          ).inventory;
        }
        if (canManageFinance) {
          inventory = (
            await replaceStayOfferingFees({
              venueId,
              offeringId: existing.id,
              expectedVersion: nextVersion(),
              fees,
            })
          ).inventory;
        }
        if (canManageInventory && namedUnits) {
          inventory = (
            await replaceStayUnits({
              venueId,
              offeringId: existing.id,
              expectedVersion: nextVersion(),
              units: parsedUnits.map((unitName) => ({ name: unitName })),
            })
          ).inventory;
        }
        for (const photo of canManageInventory ? media : []) {
          inventory = (
            await attachStayOfferingMedia({
              venueId,
              offeringId: existing.id,
              expectedVersion: nextVersion(),
              media: photo,
            })
          ).inventory;
        }
        return inventory;
      }
      if (!canManageInventory) throw new Error("forbidden");
      if (bulk) {
        const response = await bulkCreateStayOfferings({
          venueId,
          idempotencyKey: randomId(),
          items: names.map(makeOffering),
        });
        if (response.job.failed_count > 0) {
          setResultCopy(
            `${response.job.succeeded_count} created; ${response.job.failed_count} need review. Nothing was auto-published.`,
          );
        }
        const refreshed = await manageStayInventory<StayInventorySnapshot>({
          action: "get",
          venueId,
        });
        return refreshed;
      }
      return (
        await createStayOffering({
          venueId,
          offering: makeOffering(names[0]),
        })
      ).inventory;
    },
    onSuccess: (inventory) => {
      queryClient.setQueryData(stayInventoryKeys.detail(venueId), inventory);
      if (resultCopy === null) onClose();
    },
  });
  const removeMedia = useMutation({
    mutationFn: async (mediaId: string) => {
      if (!existing) throw new Error("stay_media_not_found");
      const latest = queryClient.getQueryData<StayInventorySnapshot>(
        stayInventoryKeys.detail(venueId),
      );
      const latestOffering = latest?.offerings.find(
        (offering) => offering.id === existing.id,
      );
      return removeStayOfferingMedia({
        venueId,
        mediaId,
        expectedVersion: latestOffering?.version ?? existing.version,
      });
    },
    onSuccess: ({ inventory }, mediaId) => {
      queryClient.setQueryData(stayInventoryKeys.detail(venueId), inventory);
      setRemovedMediaIds((current) => [...current, mediaId]);
    },
  });

  const addPhotos = async (): Promise<void> => {
    setUploading(true);
    setMediaError(null);
    try {
      const assets = await pickStayOfferingPhotos(
        Math.max(0, 20 - media.length),
      );
      const uploaded: StayMediaInput[] = [];
      for (let index = 0; index < assets.length; index += 1) {
        try {
          uploaded.push(
            await uploadStayOfferingPhoto({
              brandId,
              venueId,
              asset: assets[index],
              isCover: media.length === 0 && index === 0,
              altText: `${name || kind} photo ${media.length + index + 1}`,
            }),
          );
        } catch {
          setMediaError(
            `${uploaded.length} uploaded; ${assets.length - uploaded.length} could not upload. Retry the missing photos.`,
          );
          break;
        }
      }
      setMedia((current) => [...current, ...uploaded]);
    } catch (error) {
      setMediaError(
        error instanceof Error ? error.message : "Couldn’t open photos.",
      );
    } finally {
      setUploading(false);
    }
  };

  const localValidation =
    save.error instanceof Error &&
    ["name_required", "named_units_incomplete"].includes(save.error.message)
      ? save.error.message === "name_required"
        ? "Add a name for every Room or Place."
        : "Add exactly one name for every private unit."
      : save.isError
        ? mutationCopy(save.error)
        : null;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        isWideDesktop ? styles.pageWide : null,
      ]}
    >
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.title}>
            {existing ? `Edit ${existing.name}` : "Add Rooms or Places"}
          </Text>
          <Text style={styles.helper}>
            Drafts stay private until every server readiness check passes.
          </Text>
          {!canManageInventory && canManageFinance ? (
            <Text style={styles.warning}>
              Your role can manage prices, fees and policies, but not Room or
              Place details.
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close editor"
          onPress={onClose}
        >
          <X size={22} color={textTokens.secondary} />
        </Pressable>
      </View>
      {!existing ? (
        <>
          <View style={styles.choices}>
            <Choice
              label="Room"
              selected={kind === "room"}
              onPress={() => setKind("room")}
              testID="stay-add-room"
            />
            <Choice
              label="Place"
              selected={kind === "place"}
              onPress={() => setKind("place")}
              testID="stay-add-place"
            />
          </View>
          <View style={styles.choices}>
            <Choice
              label="Single"
              selected={!bulk}
              onPress={() => setBulk(false)}
              testID="stay-add-single"
            />
            <Choice
              label="Bulk"
              selected={bulk}
              onPress={() => setBulk(true)}
              testID="stay-add-bulk"
            />
          </View>
        </>
      ) : null}
      <GlassCard variant="base" style={styles.form}>
        {bulk ? (
          <LabeledInput
            label={`${kind === "room" ? "Room" : "Place"} names`}
            value={bulkNames}
            onChangeText={setBulkNames}
            placeholder={"One name per line"}
            multiline
            editable={canManageInventory}
            testID="stay-bulk-names"
          />
        ) : (
          <LabeledInput
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder={kind === "room" ? "Ocean suite" : "Pool cabana"}
            editable={canManageInventory}
            testID="stay-offering-name"
          />
        )}
        <LabeledInput
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="What guests are reserving"
          multiline
          editable={canManageInventory}
          testID="stay-offering-description"
        />
        <LabeledInput
          label="Amenities"
          value={amenities}
          onChangeText={setAmenities}
          placeholder="Wi-Fi, air conditioning, accessible entrance"
          editable={canManageInventory}
          testID="stay-offering-amenities"
        />
        <View style={styles.choices}>
          <Choice
            label="Instant"
            selected={confirmationMode === "instant"}
            onPress={() => setConfirmationMode("instant")}
            disabled={!canManageInventory}
            testID="stay-offering-instant"
          />
          <Choice
            label="Request"
            selected={confirmationMode === "request"}
            onPress={() => setConfirmationMode("request")}
            disabled={!canManageInventory}
            testID="stay-offering-request"
          />
        </View>
        {kind === "place" ? (
          <View style={styles.choices}>
            <Choice
              label="Exclusive units"
              selected={!sharedCapacity}
              onPress={() => setSharedCapacity(false)}
              disabled={!canManageInventory}
              testID="stay-place-exclusive"
            />
            <Choice
              label="Shared capacity"
              selected={sharedCapacity}
              onPress={() => setSharedCapacity(true)}
              disabled={!canManageInventory}
              testID="stay-place-capacity"
            />
          </View>
        ) : null}
        <View style={styles.twoCol}>
          {!sharedCapacity ? (
            <LabeledInput
              label="Quantity"
              value={quantity}
              onChangeText={setQuantity}
              placeholder="1"
              keyboardType="numeric"
              editable={canManageInventory}
              testID="stay-offering-quantity"
            />
          ) : (
            <LabeledInput
              label="Capacity"
              value={capacity}
              onChangeText={setCapacity}
              placeholder="10"
              keyboardType="numeric"
              editable={canManageInventory}
              testID="stay-offering-capacity"
            />
          )}
          <LabeledInput
            label="Maximum guests"
            value={maxGuests}
            onChangeText={setMaxGuests}
            placeholder="2"
            keyboardType="numeric"
            editable={canManageInventory}
            testID="stay-offering-guests"
          />
        </View>
        {!sharedCapacity ? (
          <>
            <View style={styles.choices}>
              <Choice
                label="Interchangeable"
                selected={!namedUnits}
                onPress={() => setNamedUnits(false)}
                disabled={!canManageInventory}
                testID="stay-units-pooled"
              />
              <Choice
                label="Named units"
                selected={namedUnits}
                onPress={() => setNamedUnits(true)}
                disabled={!canManageInventory}
                testID="stay-units-named"
              />
            </View>
            {namedUnits ? (
              <LabeledInput
                label="Private unit names"
                value={unitNames}
                onChangeText={setUnitNames}
                placeholder="Room 101\nRoom 102"
                multiline
                editable={canManageInventory}
                testID="stay-unit-names"
              />
            ) : null}
          </>
        ) : null}
        {kind === "place" ? (
          <View style={styles.choices}>
            <Choice
              label="Public"
              selected={!overnightOnly}
              onPress={() => setOvernightOnly(false)}
              disabled={!canManageInventory}
              testID="stay-place-public"
            />
            <Choice
              label="Overnight guests only"
              selected={overnightOnly}
              onPress={() => setOvernightOnly(true)}
              disabled={!canManageInventory}
              testID="stay-place-overnight-only"
            />
          </View>
        ) : null}
        {canManageFinance ? (
          <>
            <View style={styles.twoCol}>
              <LabeledInput
                label={`Base price${currencyCode ? ` (${currencyCode})` : ""}`}
                value={price}
                onChangeText={setPrice}
                placeholder="0.00"
                keyboardType="decimal-pad"
                testID="stay-offering-price"
              />
              <LabeledInput
                label="Fee amount"
                value={feeAmount}
                onChangeText={setFeeAmount}
                placeholder="0.00"
                keyboardType="decimal-pad"
                testID="stay-offering-fee-amount"
              />
            </View>
            <LabeledInput
              label="Optional fee name"
              value={feeLabel}
              onChangeText={setFeeLabel}
              placeholder="Resort fee"
              testID="stay-offering-fee-label"
            />
            <LabeledInput
              label="Cancellation policy"
              value={policy}
              onChangeText={setPolicy}
              placeholder="Free cancellation until 48 hours before arrival"
              multiline
              testID="stay-offering-policy"
            />
            <LabeledInput
              label="No-show refund percent"
              value={noShowPercent}
              onChangeText={setNoShowPercent}
              placeholder="0"
              keyboardType="numeric"
              testID="stay-offering-no-show"
            />
          </>
        ) : (
          <Text style={styles.warning} testID="stay-finance-permission-copy">
            Pricing, fees and cancellation policies require Stay finance
            permission. You can save this as an unpriced draft.
          </Text>
        )}
        {canManageInventory ? (
          <View style={styles.photoBlock}>
            <Text style={styles.label}>Photos</Text>
            <Text style={styles.helper}>
              Add up to 20. The first successful upload becomes the cover.
            </Text>
            <Button
              label={uploading ? "Uploading…" : "Add photos"}
              onPress={addPhotos}
              loading={uploading}
              variant="secondary"
              size="sm"
              testID="stay-offering-add-photos"
            />
            {existing ? (
              <View style={styles.mediaStrip}>
                {(existing.media ?? [])
                  .filter((item) => !removedMediaIds.includes(item.id))
                  .map((item) => (
                    <View key={item.id} style={styles.mediaThumbWrap}>
                      <Image
                        source={{
                          uri: stayOfferingMediaUrl(item.storage_object_name),
                        }}
                        accessibilityLabel={
                          item.alt_text ?? `${existing.name} photo`
                        }
                        style={styles.mediaThumb}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.alt_text ?? "photo"}`}
                        disabled={removeMedia.isPending}
                        onPress={() => removeMedia.mutate(item.id)}
                        style={styles.mediaRemove}
                        testID={`stay-media-remove-${item.id}`}
                      >
                        <X size={14} color={textTokens.primary} />
                      </Pressable>
                    </View>
                  ))}
              </View>
            ) : null}
            <Text style={styles.helper}>
              {(existing?.media?.length ?? 0) + media.length} total after save
            </Text>
            {mediaError ? <Text style={styles.error}>{mediaError}</Text> : null}
            {removeMedia.isError ? (
              <Text style={styles.error}>
                {mutationCopy(removeMedia.error)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </GlassCard>
      {canManageFinance && currencyCode === null ? (
        <Text style={styles.error}>
          Choose the brand’s provisional currency or connect its bank before
          adding prices.
        </Text>
      ) : null}
      {localValidation ? (
        <Text style={styles.error}>{localValidation}</Text>
      ) : null}
      {resultCopy ? <Text style={styles.warning}>{resultCopy}</Text> : null}
      <Button
        label={
          existing ? "Save changes" : bulk ? "Create drafts" : "Create draft"
        }
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={uploading || (!canManageInventory && !canManageFinance)}
        fullWidth
        testID="stay-offering-save"
      />
    </ScrollView>
  );
}

function OfferingRow({
  offering,
  venueId,
  onEdit,
  canManageInventory,
  canManageFinance,
}: {
  offering: StayOfferingRecord;
  venueId: string;
  onEdit: () => void;
  canManageInventory: boolean;
  canManageFinance: boolean;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const errors = stayOfferingReadinessErrors(offering);
  const statusMutation = useMutation({
    mutationFn: (status: "live" | "paused") =>
      changeStayOfferingStatus({
        venueId,
        offeringId: offering.id,
        expectedVersion: offering.version,
        status,
      }),
    onSuccess: ({ inventory }) =>
      queryClient.setQueryData(stayInventoryKeys.detail(venueId), inventory),
  });
  const cover = (offering.media ?? []).find(
    (item) => item.is_cover && item.status === "ready",
  );
  const inventoryCopy =
    offering.inventory_basis === "shared_capacity"
      ? `${offering.capacity ?? 0} guests`
      : offering.unit_naming_mode === "named"
        ? `${offering.quantity ?? 0} named units`
        : `${offering.quantity ?? 0} interchangeable`;
  return (
    <GlassCard variant="base" style={styles.rowCard}>
      <View style={styles.rowTop}>
        {cover ? (
          <Image
            source={{ uri: stayOfferingMediaUrl(cover.storage_object_name) }}
            accessibilityLabel={cover.alt_text ?? `${offering.name} cover`}
            style={styles.cover}
          />
        ) : (
          <View style={styles.coverFallback}>
            <BedDouble size={24} color={accent.warm} />
          </View>
        )}
        <View style={styles.flex}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.cardTitle}>{offering.name}</Text>
            <Text style={styles.status}>{offering.status.toUpperCase()}</Text>
          </View>
          <Text style={styles.helper}>
            {offering.kind === "room" ? "Room" : "Place"} · {inventoryCopy} ·{" "}
            {offering.confirmation_mode === "instant" ? "Instant" : "Request"}
          </Text>
          <Text style={styles.price}>
            {offering.currentPrice
              ? formatCurrency(
                  offering.currentPrice.amount_minor,
                  offering.currentPrice.currency_code,
                  true,
                )
              : "Price not set"}
          </Text>
          <Text style={styles.helper}>
            {offering.nextAvailability
              ? `Next: ${offering.nextAvailability}`
              : "No open future availability"}
          </Text>
        </View>
      </View>
      {errors.length > 0 ? (
        <View style={styles.readiness}>
          {errors.map((error) => (
            <Text key={error} style={styles.warning}>
              • {error}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.ready}>
          <Check size={14} color={semantic.success} /> Ready for status review
        </Text>
      )}
      {statusMutation.isError ? (
        <Text style={styles.error}>{mutationCopy(statusMutation.error)}</Text>
      ) : null}
      <View style={styles.actions}>
        {canManageInventory || canManageFinance ? (
          <Button
            label={canManageInventory ? "Edit" : "Pricing"}
            onPress={onEdit}
            variant="secondary"
            size="sm"
            leadingIcon="edit"
            testID={`stay-edit-${offering.id}`}
          />
        ) : null}
        {canManageInventory && offering.status === "live" ? (
          <Button
            label="Pause"
            onPress={() => statusMutation.mutate("paused")}
            variant="secondary"
            size="sm"
            loading={statusMutation.isPending}
            testID={`stay-pause-${offering.id}`}
          />
        ) : canManageInventory ? (
          <Button
            label="Make live"
            onPress={() => statusMutation.mutate("live")}
            size="sm"
            disabled={errors.length > 0}
            loading={statusMutation.isPending}
            testID={`stay-live-${offering.id}`}
          />
        ) : null}
      </View>
    </GlassCard>
  );
}

function AvailabilityManager({
  venueId,
  offerings,
  timezone,
  canManageFinance,
}: {
  venueId: string;
  offerings: StayOfferingRecord[];
  timezone: string;
  canManageFinance: boolean;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(offerings[0]?.id ?? "");
  const selected =
    offerings.find((item) => item.id === selectedId) ?? offerings[0];
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [quantity, setQuantity] = useState("1");
  const [stopSell, setStopSell] = useState(false);
  const [overridePrice, setOverridePrice] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [mode, setMode] = useState<StayPlaceScheduleMode>("fixed_slots");
  const currencyCode = selected?.currentPrice?.currency_code ?? null;

  const save = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("stay_offering_not_found");
      if (selected.kind === "room") {
        const start = new Date(`${fromDate}T12:00:00Z`);
        const end = new Date(`${toDate}T12:00:00Z`);
        if (
          !Number.isFinite(start.getTime()) ||
          !Number.isFinite(end.getTime()) ||
          end < start
        ) {
          throw new Error("invalid_date_range");
        }
        const nights: Record<string, unknown>[] = [];
        for (
          let cursor = start;
          cursor <= end;
          cursor = new Date(cursor.getTime() + 86400000)
        ) {
          const row: Record<string, unknown> = {
            localDate: cursor.toISOString().slice(0, 10),
            sellableQuantity: asPositiveInteger(quantity),
            stopSell,
            minimumNights: 1,
          };
          const existing = (selected.roomNights ?? []).find(
            (night) => night.local_date === row.localDate,
          );
          if (existing) row.expectedVersion = existing.version;
          if (overridePrice && currencyCode) {
            row.priceOverrideMinor = minorFromMajor(
              Number(overridePrice),
              currencyCode,
            );
            row.currencyCode = currencyCode;
          }
          nights.push(row);
        }
        return upsertStayRoomNights({
          venueId,
          offeringId: selected.id,
          nights,
        });
      }
      const existingWindows = (selected.placeWindows ?? []).filter(
        (windowRow) =>
          windowRow.local_date >= fromDate && windowRow.local_date <= toDate,
      );
      if (existingWindows.length > 0) {
        return upsertStayPlaceWindows({
          venueId,
          windows: existingWindows.map((windowRow) => ({
            windowId: windowRow.id,
            expectedVersion: windowRow.version,
            stopSell,
            ...(overridePrice && currencyCode
              ? {
                  priceOverrideMinor: minorFromMajor(
                    Number(overridePrice),
                    currencyCode,
                  ),
                  currencyCode,
                }
              : {}),
          })),
        });
      }
      const scheduled = await upsertStayPlaceSchedule({
        venueId,
        offeringId: selected.id,
        schedule: buildStayPlaceSchedule({
          mode,
          timezone,
          fromDate,
          toDate,
          startTime,
          endTime,
          stopSell,
        }),
      });
      if (stopSell) return scheduled;
      const updated = scheduled.inventory.offerings.find(
        (offering) => offering.id === selected.id,
      );
      const rule = [...(updated?.placeScheduleRules ?? [])]
        .sort((left, right) => left.id.localeCompare(right.id))
        .at(-1);
      if (!rule) throw new Error("stay_schedule_rule_not_found");
      const materialized = await materializeStayPlaceWindows({
        venueId,
        scheduleRuleId: rule.id,
        fromDate,
        toDate: mode === "fixed_slots" ? fromDate : toDate,
      });
      const created =
        materialized.inventory.offerings
          .find((offering) => offering.id === selected.id)
          ?.placeWindows?.filter(
            (windowRow) =>
              windowRow.local_date >= fromDate &&
              windowRow.local_date <= toDate,
          ) ?? [];
      if (!overridePrice || !currencyCode || created.length === 0) {
        return materialized;
      }
      return upsertStayPlaceWindows({
        venueId,
        windows: created.map((windowRow) => ({
          windowId: windowRow.id,
          expectedVersion: windowRow.version,
          priceOverrideMinor: minorFromMajor(
            Number(overridePrice),
            currencyCode,
          ),
          currencyCode,
          stopSell: false,
        })),
      });
    },
    onSuccess: ({ inventory }) =>
      queryClient.setQueryData(stayInventoryKeys.detail(venueId), inventory),
  });

  if (!selected) {
    return (
      <Text style={styles.helper}>
        Add a Room or Place before setting availability.
      </Text>
    );
  }
  return (
    <View style={styles.availability}>
      <Text style={styles.label}>Offering</Text>
      <View style={styles.choices}>
        {offerings.map((offering) => (
          <Choice
            key={offering.id}
            label={offering.name}
            selected={offering.id === selected.id}
            onPress={() => setSelectedId(offering.id)}
            testID={`stay-availability-${offering.id}`}
          />
        ))}
      </View>
      <View style={styles.twoCol}>
        <LabeledInput
          label={selected.kind === "room" ? "First night" : "Start date"}
          value={fromDate}
          onChangeText={setFromDate}
          placeholder="YYYY-MM-DD"
          testID="stay-availability-from"
        />
        <LabeledInput
          label={selected.kind === "room" ? "Last night" : "End date"}
          value={toDate}
          onChangeText={setToDate}
          placeholder="YYYY-MM-DD"
          testID="stay-availability-to"
        />
      </View>
      {selected.kind === "room" ? (
        <View style={styles.twoCol}>
          <LabeledInput
            label="Sellable rooms"
            value={quantity}
            onChangeText={setQuantity}
            placeholder="1"
            keyboardType="numeric"
            testID="stay-night-quantity"
          />
          {canManageFinance ? (
            <LabeledInput
              label={`Price override${currencyCode ? ` (${currencyCode})` : ""}`}
              value={overridePrice}
              onChangeText={setOverridePrice}
              placeholder="Optional"
              keyboardType="decimal-pad"
              testID="stay-night-price"
            />
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.choices}>
            <Choice
              label="Fixed"
              selected={mode === "fixed_slots"}
              onPress={() => setMode("fixed_slots")}
              testID="stay-place-fixed"
            />
            <Choice
              label="Repeating"
              selected={mode === "repeating_windows"}
              onPress={() => setMode("repeating_windows")}
              testID="stay-place-repeating"
            />
            <Choice
              label="Full day"
              selected={mode === "full_day"}
              onPress={() => setMode("full_day")}
              testID="stay-place-full-day"
            />
          </View>
          <View style={styles.twoCol}>
            <LabeledInput
              label="Starts"
              value={startTime}
              onChangeText={setStartTime}
              placeholder="09:00"
              testID="stay-place-start-time"
            />
            <LabeledInput
              label="Ends"
              value={endTime}
              onChangeText={setEndTime}
              placeholder="17:00"
              testID="stay-place-end-time"
            />
            {canManageFinance ? (
              <LabeledInput
                label={`Price override${currencyCode ? ` (${currencyCode})` : ""}`}
                value={overridePrice}
                onChangeText={setOverridePrice}
                placeholder="Optional"
                keyboardType="decimal-pad"
                testID="stay-place-price"
              />
            ) : null}
          </View>
        </>
      )}
      <Choice
        label="Stop sell / blackout"
        selected={stopSell}
        onPress={() => setStopSell((value) => !value)}
        testID="stay-stop-sell"
      />
      {save.isError ? (
        <Text style={styles.error}>{mutationCopy(save.error)}</Text>
      ) : null}
      <Button
        label={stopSell ? "Save blackout" : "Open availability"}
        onPress={() => save.mutate()}
        loading={save.isPending}
        fullWidth
        testID="stay-availability-save"
      />
      <Text style={styles.helper}>
        The server checks dates, quantities, permissions, currency and edit
        versions before saving.
      </Text>
      {!canManageFinance ? (
        <Text style={styles.warning} testID="stay-availability-finance-copy">
          Your inventory changes will use the saved base price. Price overrides
          require Stay finance permission.
        </Text>
      ) : null}
      <View style={styles.calendarList}>
        <Text style={styles.label}>Current calendar</Text>
        {selected.kind === "room" ? (
          (selected.roomNights ?? []).length > 0 ? (
            (selected.roomNights ?? []).slice(0, 40).map((night) => (
              <View
                key={stayRoomNightCalendarKey(selected.id, night.local_date)}
                style={styles.calendarRow}
              >
                <Text style={styles.calendarDate}>{night.local_date}</Text>
                <Text style={styles.helper}>
                  {night.stop_sell
                    ? "Blackout"
                    : `${night.sellable_quantity} room${night.sellable_quantity === 1 ? "" : "s"}`}
                  {night.price_override_minor && night.currency_code
                    ? ` · ${formatCurrency(
                        night.price_override_minor,
                        night.currency_code,
                        true,
                      )}`
                    : ""}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.helper}>No Room nights saved yet.</Text>
          )
        ) : (selected.placeWindows ?? []).length > 0 ? (
          (selected.placeWindows ?? []).slice(0, 40).map((windowRow) => (
            <View key={windowRow.id} style={styles.calendarRow}>
              <Text style={styles.calendarDate}>{windowRow.local_date}</Text>
              <Text style={styles.helper}>
                {windowRow.stop_sell
                  ? "Blackout"
                  : `${new Date(windowRow.starts_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}–${new Date(windowRow.ends_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`}
                {windowRow.price_override_minor && windowRow.currency_code
                  ? ` · ${formatCurrency(
                      windowRow.price_override_minor,
                      windowRow.currency_code,
                      true,
                    )}`
                  : ""}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.helper}>No Place windows saved yet.</Text>
        )}
      </View>
    </View>
  );
}

export function StayInventoryManager({
  brandId,
  venueId,
  mode,
}: {
  brandId: string;
  venueId: string;
  mode: "inventory" | "availability";
}): React.ReactElement {
  // #1484 — desktop gate ONLY via the canonical hook (I-DESKTOP-GATE-VIA-HOOK).
  const { isWideDesktop } = useResponsiveLayout();
  const inventory = useStayInventory(venueId);
  const [filter, setFilter] = useState<StayInventoryFilter>("all");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<StayOfferingRecord | "new" | null>(null);
  const offerings = useMemo(
    () => inventory.data?.offerings ?? [],
    [inventory.data?.offerings],
  );
  const canManageInventory =
    inventory.data?.permissions.canManageInventory ?? false;
  const canManageFinance =
    inventory.data?.permissions.canManageFinance ?? false;
  const filtered = useMemo(
    () =>
      offerings.filter((offering) =>
        matchesStayInventoryFilter({ offering, filter, search }),
      ),
    [filter, offerings, search],
  );

  if (inventory.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={accent.warm} />
        <Text style={styles.helper}>Loading Stay inventory…</Text>
      </View>
    );
  }
  if (inventory.isError && !inventory.data) {
    return (
      <View style={styles.center}>
        <Text style={styles.cardTitle}>Rooms & Places could not load</Text>
        <Text style={styles.helper}>
          Your saved data is safe. Check your connection and retry.
        </Text>
        <Button
          label="Retry"
          onPress={async () => {
            await inventory.refetch();
          }}
          testID="stay-inventory-retry"
        />
      </View>
    );
  }
  if (editor !== null) {
    return (
      <OfferingEditor
        brandId={brandId}
        venueId={venueId}
        existing={editor === "new" ? null : editor}
        canManageInventory={canManageInventory}
        canManageFinance={canManageFinance}
        onClose={() => setEditor(null)}
      />
    );
  }
  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        isWideDesktop ? styles.pageWide : null,
      ]}
    >
      {inventory.isError ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.warning}>
            You’re seeing saved inventory while offline. Reconnect before
            changing it.
          </Text>
        </View>
      ) : null}
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.title}>
            {mode === "inventory" ? "Rooms & Places" : "Availability & pricing"}
          </Text>
          <Text style={styles.helper}>
            {mode === "inventory"
              ? "Rooms and reservable Places share one Stay manager."
              : "Manage Room nights and scheduled Place windows together."}
          </Text>
        </View>
        {mode === "inventory" ? (
          <Button
            label="Add"
            onPress={() => setEditor("new")}
            disabled={!canManageInventory}
            size="sm"
            testID="stay-inventory-add"
          />
        ) : null}
      </View>
      {mode === "inventory" ? (
        <>
          {!canManageInventory ? (
            <Text
              style={styles.warning}
              testID="stay-inventory-permission-copy"
            >
              Your role can view Rooms and Places, but Stay inventory permission
              is required to add or change them.
            </Text>
          ) : null}
          <TextInput
            accessibilityLabel="Search Rooms and Places"
            value={search}
            onChangeText={setSearch}
            placeholder="Search Rooms & Places"
            placeholderTextColor={textTokens.tertiary}
            style={styles.input}
            testID="stay-inventory-search"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.choices}
          >
            {FILTERS.map((item) => (
              <Choice
                key={item.id}
                label={item.label}
                selected={filter === item.id}
                onPress={() => setFilter(item.id)}
                testID={`stay-filter-${item.id}`}
              />
            ))}
          </ScrollView>
          {filtered.length === 0 ? (
            <GlassCard variant="base" style={styles.empty}>
              <BedDouble size={30} color={accent.warm} />
              <Text style={styles.cardTitle}>
                {offerings.length === 0
                  ? "No Rooms or Places yet"
                  : "No matching inventory"}
              </Text>
              <Text style={styles.helper}>
                Add one Room or Place, or create several drafts in bulk.
              </Text>
              <Button
                label="Add Room or Place"
                onPress={() => setEditor("new")}
                disabled={!canManageInventory}
                testID="stay-inventory-empty-add"
              />
            </GlassCard>
          ) : (
            filtered.map((offering) => (
              <OfferingRow
                key={offering.id}
                offering={offering}
                venueId={venueId}
                onEdit={() => setEditor(offering)}
                canManageInventory={canManageInventory}
                canManageFinance={canManageFinance}
              />
            ))
          )}
        </>
      ) : (
        <GlassCard variant="base" style={styles.form}>
          <CalendarDays size={26} color={accent.warm} />
          {canManageInventory ? (
            <AvailabilityManager
              venueId={venueId}
              offerings={offerings}
              timezone={inventory.data?.settings?.timezone ?? "UTC"}
              canManageFinance={canManageFinance}
            />
          ) : (
            <Text
              style={styles.warning}
              testID="stay-availability-permission-copy"
            >
              Stay inventory permission is required to open Room nights or Place
              windows.
            </Text>
          )}
        </GlassCard>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: spacing.md,
    paddingBottom: spacing.xxl * 3,
    gap: spacing.md,
    // Phone / web-phone readable measure (unchanged; now tokenised).
    maxWidth: stayInventoryMaxWidth,
    width: "100%",
    alignSelf: "center",
  },
  // #1484 — WIDE DESKTOP ONLY. Inside the shared SuiteDesktopShell the
  // workspace already owns the gutters and the left anchor, so Rooms & Places
  // and Availability & pricing run UNCAPPED and left-anchored instead of a
  // centred 900 column with symmetric dead gutters.
  pageWide: {
    maxWidth: undefined,
    alignSelf: "flex-start",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  title: { ...typography.h2, color: textTokens.primary },
  cardTitle: { ...typography.h3, color: textTokens.primary },
  helper: { ...typography.bodySm, color: textTokens.secondary },
  label: { ...typography.bodySm, color: textTokens.primary, fontWeight: "700" },
  flex: { flex: 1, minWidth: 0 },
  form: { gap: spacing.md },
  field: { flex: 1, minWidth: 140, gap: spacing.xs },
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: textTokens.primary,
  },
  multiline: { minHeight: 92, textAlignVertical: "top" },
  inputDisabled: { opacity: 0.55 },
  twoCol: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: {
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: glass.tint.profileBase,
  },
  choiceActive: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235,120,37,0.14)",
  },
  choiceDisabled: { opacity: 0.55 },
  choiceText: { ...typography.bodySm, color: textTokens.secondary },
  choiceTextActive: { color: accent.warm, fontWeight: "700" },
  photoBlock: { gap: spacing.sm },
  mediaStrip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  mediaThumbWrap: { position: "relative" },
  mediaThumb: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  mediaRemove: {
    position: "absolute",
    right: 4,
    top: 4,
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,14,18,0.82)",
  },
  error: { ...typography.bodySm, color: semantic.error },
  warning: { ...typography.bodySm, color: semantic.warning },
  ready: {
    ...typography.bodySm,
    color: semantic.success,
    flexDirection: "row",
    alignItems: "center",
  },
  empty: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  rowCard: { gap: spacing.md },
  rowTop: { flexDirection: "row", gap: spacing.md },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cover: {
    width: 104,
    height: 104,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  coverFallback: {
    width: 104,
    height: 104,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
  },
  status: { ...typography.caption, color: accent.warm, fontWeight: "800" },
  price: { ...typography.body, color: textTokens.primary, fontWeight: "700" },
  readiness: { gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  availability: { gap: spacing.md },
  offlineBanner: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: semantic.warning,
    backgroundColor: semantic.warningTint,
    padding: spacing.md,
  },
  calendarList: { gap: spacing.sm, marginTop: spacing.md },
  calendarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  calendarDate: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
});

export default StayInventoryManager;
