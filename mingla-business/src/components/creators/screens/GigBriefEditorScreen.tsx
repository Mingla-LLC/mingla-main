/**
 * #3872 — Hire a creator. Round 2 (approved M-brief1 / M-brief2 /
 * M-keyboard): two steps. Brief — goal, format, platforms, title and tall
 * public/private brief boxes with counters. Timing and pay — "Video needed
 * by" (date and time, required), "Shoot" (optional; The event day / Any day
 * before; blank lets the creator propose a time), city, creators, a money
 * field ("Pay each creator up to"), sales share and the standard marketing licence. The footer
 * total never overflows; the keyboard rule hides it while typing.
 */
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../components/ui/Button";
import { DateField } from "../../../components/ui/DateField";
import { NumberStepper } from "../../../components/ui/NumberStepper";
import { ProgramSheet } from "../../../components/programs/ProgramSheet";
import { Input } from "../../../components/ui/Input";
import { TimeField } from "../../../components/programs/TimeField";
import {
  Chip,
  FieldError,
  ListGroup,
  ListRow,
  Muted,
  ProgramLoading,
  ProgramScreen,
  SectionLabel,
  Segmented,
  SheetBody,
} from "../../../components/programs/ProgramKit";
import { useProgramParams } from "../../../components/programs/useProgramParams";
import {
  FORMAT_EXAMPLES,
  PLATFORM_DELIVERABLES,
  PRIVATE_BRIEF_MAX,
  PUBLIC_BRIEF_MAX,
  briefFromGig,
  briefMaxSpend,
  briefServerErrors,
  emptyBrief,
  gigPayload,
  stepForErrors,
  validateBrief,
  validateBriefStep,
  type BriefErrors,
  type BriefForm,
  type BriefPlatform,
  type BriefStep,
  type ShootMode,
} from "../../../components/programs/gigBrief";
import { CREATOR_FORMATS } from "../../../services/creatorProgramContract";
import { creatorGigsService } from "../../../services/creatorGigsService";
import {
  fetchProgramCities,
  fetchPromoteListing,
  matchCity,
  type ProgramCity,
  type PromoteListing,
} from "../../../services/promoteListingService";
import {
  bookingFeeMinor,
  briefLintMessage,
  formatName,
  lintPublicBrief,
  programErrorMessage,
  programMoney,
  shortDate,
  toIsoDay,
  wholeCurrencyToMinor,
} from "../../../utils/creatorProgramFormat";
import { formatCurrencyRound } from "../../../utils/currency";
import { blastHubHref } from "../../../components/marketing/marketingSubNavTabs";
import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../../constants/designSystem";

const SHARE_OPTIONS = [5, 10, 15, 20] as const;
/** A tall brief box with its label and a character count under it. */
function BriefBox({
  value,
  onChange,
  placeholder,
  caption,
  max,
  minHeight,
  error,
  accessibilityLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  caption: string;
  max: number;
  minHeight: number;
  error?: string | null;
  accessibilityLabel: string;
}): React.ReactElement {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.boxWrap}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={textTokens.tertiary}
        multiline
        textAlignVertical="top"
        maxLength={max}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.box,
          { minHeight },
          focused && styles.boxFocused,
          error ? styles.boxError : null,
        ]}
      />
      <View style={styles.counterRow}>
        <Text style={styles.counter} numberOfLines={1}>
          {caption}
        </Text>
        <Text style={styles.counter}>{`${value.length} / ${max}`}</Text>
      </View>
      <FieldError message={error} />
    </View>
  );
}

export default function GigBriefEditor(): React.ReactElement {
  const router = useRouter();
  const { brandId, params, brand, currency } = useProgramParams(
    "listingKind",
    "listingId",
    "gigId",
    "fromGigId",
  );
  const listingKind = params.listingKind === "venue" ? "venue" : "event";
  const [listingId, setListingId] = useState(params.listingId ?? "");
  const [listing, setListing] = useState<PromoteListing | null>(null);
  const [cities, setCities] = useState<ProgramCity[]>([]);
  const [form, setForm] = useState<BriefForm>(emptyBrief);
  const [ready, setReady] = useState(false);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<BriefErrors>({});
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<BriefStep>(1);
  const [formatOpen, setFormatOpen] = useState(false);
  const today = toIsoDay(new Date());
  const editingGigId = params.gigId ?? null;

  useEffect(() => {
    let active = true;
    void (async () => {
      const sourceGigId = params.gigId ?? params.fromGigId;
      const [home, nextCities] = await Promise.all([
        sourceGigId
          ? creatorGigsService.hostHome(brandId).catch(() => null)
          : Promise.resolve(null),
        fetchProgramCities().catch(() => [] as ProgramCity[]),
      ]);
      if (!active) return;
      const source = home?.gigs.find((gig) => gig.id === sourceGigId) ?? null;
      const nextListingId = source?.listing_id ?? params.listingId ?? "";
      const nextListing = nextListingId
        ? await fetchPromoteListing(
            source?.listing_kind ?? listingKind,
            nextListingId,
          ).catch(() => null)
        : null;
      if (!active) return;
      setCities(nextCities);
      setListingId(nextListingId);
      setListing(nextListing);
      setForm(() => {
        if (source) {
          const prefill = briefFromGig(source, currency);
          // Book again starts fresh dates; edit keeps them.
          return params.gigId
            ? prefill
            : {
                ...prefill,
                videoDueDay: "",
                videoDueTime: "",
                shootMode: "open",
                shootDay: "",
                shootTime: "",
              };
        }
        const base = emptyBrief();
        return {
          ...base,
          cityId:
            matchCity(nextCities, nextListing?.cityName ?? null)?.id ?? null,
        };
      });
      setReady(true);
    })();
    return () => {
      active = false;
    };
    // Load once per screen open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const update = <K extends keyof BriefForm>(key: K, value: BriefForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    // A server answer is about what was sent; editing anything clears it.
    setServerErrors({});
  };

  const payMinor = wholeCurrencyToMinor(form.payText, currency);
  const ctx = useMemo(
    () => ({
      currency,
      today,
      eventDay: listing?.kind === "event" ? listing.startDay : null,
      brandName: brand?.displayName,
      brandSlug: brand?.slug,
      listingTitle: listing?.title,
    }),
    [currency, today, listing?.kind, listing?.startDay, brand?.displayName, brand?.slug, listing?.title],
  );
  const errors: BriefErrors = {
    ...(touched ? validateBriefStep(step, form, ctx, payMinor) : {}),
    ...serverErrors,
  };
  const liveLint = lintPublicBrief(form.briefPublic, {
    brandName: brand?.displayName,
    brandSlug: brand?.slug,
    listingTitle: listing?.title,
  });
  const fee = payMinor ?? 0;
  const shareOn = form.goal === "sell" && form.salesShare;
  const maxSpend = briefMaxSpend({
    payMinor,
    slots: form.slots,
    bookingFeeMinor: bookingFeeMinor(fee),
    shareLabel: shareOn ? `${form.salesSharePercent}%` : null,
    money: (minor) => programMoney(minor, currency),
  });
  const currencyGlyph = formatCurrencyRound(0, currency).replace(/[0\s.,]/g, "");

  const next = () => {
    setTouched(true);
    if (Object.keys(validateBriefStep(1, form, ctx, payMinor)).length > 0) return;
    setTouched(false);
    setStep(2);
  };

  const post = async () => {
    setTouched(true);
    setServerErrors({});
    const found = validateBrief(form, ctx, payMinor);
    if (Object.keys(found).length > 0) {
      setStep(stepForErrors(found));
      return;
    }
    if (!listingId) return;
    setBusy(true);
    try {
      const result = await creatorGigsService.saveGig(
        gigPayload({
          form,
          ctx,
          payMinor,
          brandId,
          listingKind: listing?.kind ?? listingKind,
          listingId,
          gigId: editingGigId,
        }),
      );
      if (!result.ok) {
        const mapped = briefServerErrors(result);
        setServerErrors(mapped);
        setStep(stepForErrors(mapped));
        return;
      }
      const gigId = result.id ?? editingGigId;
      if (gigId)
        router.replace(`/brand/${brandId}/creators/${gigId}/interest` as never);
      else router.back();
    } catch (error) {
      setServerErrors({
        form: programErrorMessage(
          error,
          "We couldn't post this gig. Check the details and try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  };

  const togglePlatform = (platform: BriefPlatform) =>
    update(
      "platforms",
      form.platforms.includes(platform)
        ? form.platforms.filter((item) => item !== platform)
        : [...form.platforms, platform],
    );
  const setShootMode = (mode: ShootMode) =>
    setForm((current) => ({
      ...current,
      shootMode: current.shootMode === mode ? "open" : mode,
      shootDay: mode === "day" ? current.shootDay : "",
      shootTime: mode === "day" ? current.shootTime : "",
    }));

  const listingChip = listing
    ? [listing.title, listing.startDay ? shortDate(listing.startDay) : null]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <ProgramScreen
      title={editingGigId ? "Edit gig" : "Hire a creator"}
      leading={step === 1 ? "close" : "back"}
      onBack={step === 2 ? () => setStep(1) : undefined}
      right={<Text style={styles.stepCount}>{`${step}/2`}</Text>}
      fallback={blastHubHref("creators")}
      footer={
        ready ? (
          step === 1 ? (
            <Button
              fullWidth
              size="lg"
              label="Next: timing and pay"
              disabled={!listingId}
              onPress={next}
            />
          ) : (
            <View style={styles.footer}>
              <View style={styles.spendRow}>
                <Text style={styles.spendLabel}>Most you’ll spend</Text>
                <Text
                  style={styles.spendValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {maxSpend ?? "Set pay first"}
                </Text>
              </View>
              <FieldError
                message={
                  errors.form ??
                  (touched &&
                  Object.keys(validateBrief(form, ctx, payMinor)).length > 0
                    ? "Fix the highlighted fields to post."
                    : null)
                }
              />
              <Button
                fullWidth
                size="lg"
                label={editingGigId ? "Save changes" : "Post gig"}
                loading={busy}
                disabled={busy || !listingId}
                onPress={() => void post()}
              />
            </View>
          )
        ) : undefined
      }
      overlay={
        <ProgramSheet
          visible={formatOpen}
          onClose={() => setFormatOpen(false)}
          snapPoint="full"
        >
          <SheetBody title="Format">
            <Muted>A proven structure creators can price consistently.</Muted>
            <ListGroup>
              {CREATOR_FORMATS.map((item) => (
                <ListRow
                  key={item.key}
                  title={item.name}
                  subtitle={FORMAT_EXAMPLES[item.key]}
                  chevron={false}
                  right={
                    form.formatKey === item.key ? (
                      <Text style={styles.check}>Selected</Text>
                    ) : undefined
                  }
                  onPress={() => {
                    update("formatKey", item.key);
                    setFormatOpen(false);
                  }}
                />
              ))}
            </ListGroup>
          </SheetBody>
        </ProgramSheet>
      }
    >
      {!ready ? (
        <ProgramLoading />
      ) : step === 1 ? (
        <>
          {listingChip ? (
            <View style={styles.listingChip}>
              <Text style={styles.listingChipText} numberOfLines={1}>
                {listingChip}
              </Text>
            </View>
          ) : (
            <FieldError message="Open this from Blast › Creators and pick what creators promote." />
          )}
          <Segmented
            options={
              [
                ["sell", "Sell tickets"],
                ["seen", "Get seen"],
              ] as const
            }
            value={form.goal}
            onChange={(goal) => update("goal", goal)}
          />
          <Text style={styles.tiny}>
            {form.goal === "sell"
              ? "Fixed fee plus a share of each sale from their link."
              : "Fixed fee for the video. Results show views and clicks."}
          </Text>
          <ListGroup>
            <ListRow
              compact
              title={formatName(form.formatKey)}
              subtitle={FORMAT_EXAMPLES[form.formatKey]}
              onPress={() => setFormatOpen(true)}
              accessibilityLabel={`Format: ${formatName(form.formatKey)}. Change format`}
            />
          </ListGroup>
          <View style={styles.chips}>
            {(Object.keys(PLATFORM_DELIVERABLES) as BriefPlatform[]).map(
              (platform) => (
                <Chip
                  key={platform}
                  label={PLATFORM_DELIVERABLES[platform].label}
                  selected={form.platforms.includes(platform)}
                  onPress={() => togglePlatform(platform)}
                />
              ),
            )}
          </View>
          <FieldError message={errors.platforms} />
          <Input
            value={form.title}
            onChangeText={(value) => update("title", value)}
            placeholder="Title, e.g. Rooftop night out"
            accessibilityLabel="Gig title"
            error={errors.title ?? null}
          />
          <BriefBox
            value={form.briefPublic}
            onChange={(value) => update("briefPublic", value)}
            placeholder="What should the creator film? Keep names, links and handles out."
            caption="Public brief · seen before hiring"
            max={PUBLIC_BRIEF_MAX}
            minHeight={140}
            accessibilityLabel="Public brief"
            error={
              errors.briefPublic ??
              (liveLint.length > 0 ? briefLintMessage(liveLint) : null)
            }
          />
          <BriefBox
            value={form.briefPrivate}
            onChange={(value) => update("briefPrivate", value)}
            placeholder="Who to ask for at the door, parking, what to avoid"
            caption="Private brief · hired creators only"
            max={PRIVATE_BRIEF_MAX}
            minHeight={110}
            accessibilityLabel="Private brief"
            error={errors.briefPrivate}
          />
        </>
      ) : (
        <>
          <SectionLabel>Video needed by</SectionLabel>
          <View style={styles.pair}>
            <View style={styles.pairDate}>
              <DateField
                label="Date"
                value={form.videoDueDay}
                onChangeValue={(value) => update("videoDueDay", value)}
                accessibilityLabel="Video needed by date"
                min={today}
                placeholder="Choose"
                hasError={Boolean(errors.videoDue)}
              />
            </View>
            <TimeField
              label="Time"
              value={form.videoDueTime}
              onChangeValue={(value) => update("videoDueTime", value)}
              accessibilityLabel="Video needed by time"
              hasError={Boolean(errors.videoDue)}
            />
          </View>
          <FieldError message={errors.videoDue} />

          <View style={styles.labelRow}>
            <SectionLabel>Shoot</SectionLabel>
            <Text style={styles.optional}>Optional</Text>
          </View>
          <View style={styles.pair}>
            <View style={styles.pairDate}>
              <DateField
                label="Date"
                value={
                  form.shootMode === "day"
                    ? form.shootDay
                    : form.shootMode === "event_day"
                      ? (ctx.eventDay ?? "")
                      : ""
                }
                onChangeValue={(value) =>
                  setForm((current) => ({
                    ...current,
                    shootMode: value ? "day" : "open",
                    shootDay: value,
                  }))
                }
                accessibilityLabel="Shoot date"
                min={today}
                placeholder={form.shootMode === "any_before" ? "Any day before" : "Creator suggests"}
                hasError={Boolean(errors.shoot)}
              />
            </View>
            <TimeField
              label="Time"
              value={form.shootMode === "day" ? form.shootTime : ""}
              onChangeValue={(value) =>
                setForm((current) => ({
                  ...current,
                  shootTime: value,
                  shootMode: current.shootMode === "event_day" && ctx.eventDay ? "day" : current.shootMode,
                  shootDay: current.shootMode === "event_day" && ctx.eventDay ? ctx.eventDay : current.shootDay,
                }))
              }
              accessibilityLabel="Shoot time"
              placeholder="Any"
            />
          </View>
          <View style={styles.chips}>
            {ctx.eventDay ? (
              <Chip
                label="The event day"
                selected={form.shootMode === "event_day"}
                onPress={() => setShootMode("event_day")}
              />
            ) : null}
            <Chip
              label="Any day before"
              selected={form.shootMode === "any_before"}
              onPress={() => setShootMode("any_before")}
            />
          </View>
          {form.shootMode === "open" ? (
            <Text style={styles.tiny}>
              Left blank, the creator suggests a shoot time and you approve it.
            </Text>
          ) : null}
          <FieldError message={errors.shoot} />
          <Text style={styles.fieldLabel}>Shoot city</Text>
          <View style={styles.chips}>
            {cities.map((city) => (
              <Chip
                key={city.id}
                label={city.name}
                selected={form.cityId === city.id}
                onPress={() => update("cityId", city.id)}
              />
            ))}
          </View>
          <FieldError message={errors.city} />

          <SectionLabel>Deal</SectionLabel>
          <NumberStepper
            label="Creators to hire"
            value={form.slots}
            min={1}
            max={10}
            onChange={(value) => update("slots", value)}
          />
          <FieldError message={errors.slots} />
          <Text style={styles.fieldLabel}>Pay each creator up to</Text>
          <View style={[styles.money, errors.pay ? styles.boxError : null]}>
            <Text style={styles.moneyGlyph}>{currencyGlyph || currency}</Text>
            <TextInput
              value={form.payText}
              onChangeText={(value) =>
                update("payText", value.replace(/[^0-9]/g, ""))
              }
              keyboardType="number-pad"
              placeholder="300"
              placeholderTextColor={textTokens.tertiary}
              accessibilityLabel={`Pay each creator up to, in ${currency}`}
              style={styles.moneyInput}
            />
          </View>
          <Text style={styles.tiny}>Creators see this as the most the gig pays.</Text>
          <FieldError message={errors.pay} />
          {form.goal === "sell" ? (
            <>
              <ListGroup>
                <ListRow
                  compact
                  title="Share of each sale"
                  subtitle="Paid from each sale through their link"
                  chevron={false}
                  right={
                    <Chip
                      label={form.salesShare ? "On" : "Off"}
                      selected={form.salesShare}
                      onPress={() => update("salesShare", !form.salesShare)}
                      accessibilityLabel={
                        form.salesShare
                          ? "Turn sales share off"
                          : "Turn sales share on"
                      }
                    />
                  }
                />
              </ListGroup>
              {form.salesShare ? (
                <View style={styles.chips}>
                  {SHARE_OPTIONS.map((percent) => (
                    <Chip
                      key={percent}
                      label={`${percent}%`}
                      selected={form.salesSharePercent === percent}
                      onPress={() => update("salesSharePercent", percent)}
                    />
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
          <ListGroup>
            <ListRow
              compact
              title="Marketing rights"
              subtitle="After the full Creator fee is released, your brand and Mingla may reuse, edit and advertise with the approved video worldwide, forever. The Creator keeps copyright."
              chevron={false}
            />
          </ListGroup>
        </>
      )}
    </ProgramScreen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.xs },
  spendRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  spendLabel: { color: textTokens.secondary, fontSize: 13 },
  spendValue: {
    color: textTokens.primary,
    fontSize: 15,
    fontWeight: "800",
    flexShrink: 1,
    textAlign: "right",
  },
  stepCount: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fieldLabel: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  tiny: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
  optional: { color: textTokens.tertiary, fontSize: 12 },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  check: { color: semantic.success, fontWeight: "700", fontSize: 13 },
  listingChip: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  listingChipText: { color: textTokens.primary, fontSize: 13, fontWeight: "700" },
  boxWrap: { gap: 6 },
  box: {
    color: textTokens.primary,
    fontSize: 15,
    lineHeight: 21,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  boxFocused: { borderColor: accent.warm },
  boxError: { borderColor: semantic.error },
  counterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  counter: { color: textTokens.tertiary, fontSize: 12, flexShrink: 1 },
  pair: { flexDirection: "row", gap: spacing.sm },
  pairDate: { flex: 1.4 },
  money: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: 14,
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  moneyGlyph: { color: textTokens.secondary, fontSize: 17, fontWeight: "700" },
  moneyInput: {
    flex: 1,
    color: textTokens.primary,
    fontSize: 17,
    fontWeight: "700",
    paddingVertical: spacing.sm,
  },
});
