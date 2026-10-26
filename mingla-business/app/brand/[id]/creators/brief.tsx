/**
 * #3872 — Hire a creator: the brief (approved P-brief / M-brief / M-daterange).
 * Goal, format with an example, a brand-free public brief checked live, a
 * private brief, platforms, shoot dates anchored to the event, post-by, how
 * many creators, pay up to, sales share, usage and the max spend.
 */
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../../src/components/ui/Button";
import { DateField } from "../../../../src/components/ui/DateField";
import { Input } from "../../../../src/components/ui/Input";
import { NumberStepper } from "../../../../src/components/ui/NumberStepper";
import { Sheet } from "../../../../src/components/ui/Sheet";
import { DateRangeSheet } from "../../../../src/components/programs/DateRangeSheet";
import {
  Card,
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
  programStyles,
} from "../../../../src/components/programs/ProgramKit";
import { useProgramParams } from "../../../../src/components/programs/useProgramParams";
import {
  FORMAT_EXAMPLES,
  PLATFORM_DELIVERABLES,
  briefFromGig,
  briefServerErrors,
  emptyBrief,
  gigPayload,
  validateBrief,
  type BriefErrors,
  type BriefForm,
  type BriefPlatform,
  type UsageDays,
} from "../../../../src/components/programs/gigBrief";
import { CREATOR_FORMATS } from "../../../../src/services/creatorProgramContract";
import { creatorGigsService } from "../../../../src/services/creatorGigsService";
import {
  fetchProgramCities,
  fetchPromoteListing,
  matchCity,
  type ProgramCity,
  type PromoteListing,
} from "../../../../src/services/promoteListingService";
import {
  bandsForCurrency,
  bookingFeeMinor,
  briefLintMessage,
  dateRangeLabel,
  formatName,
  lintPublicBrief,
  programErrorMessage,
  programMoney,
  toIsoDay,
  wholeCurrencyToMinor,
  type BudgetBandRange,
} from "../../../../src/utils/creatorProgramFormat";
import { semantic, spacing, text as textTokens } from "../../../../src/constants/designSystem";

const SHARE_OPTIONS = [5, 10, 15, 20] as const;
const USAGE_OPTIONS: ReadonlyArray<readonly [UsageDays, string]> = [[30, "30 days"], [90, "90 days"], [365, "1 year"]];
const LEVELS = ["b1", "b2", "b3", "b4"] as const;

export default function GigBriefEditor(): React.ReactElement {
  const router = useRouter();
  const { brandId, params, brand, currency } = useProgramParams("listingKind", "listingId", "gigId", "fromGigId");
  const listingKind = params.listingKind === "venue" ? "venue" : "event";
  const [listingId, setListingId] = useState(params.listingId ?? "");
  const [listing, setListing] = useState<PromoteListing | null>(null);
  const [cities, setCities] = useState<ProgramCity[]>([]);
  const [bands, setBands] = useState<BudgetBandRange[]>([]);
  const [form, setForm] = useState<BriefForm>(emptyBrief);
  const [ready, setReady] = useState(false);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<BriefErrors>({});
  const [busy, setBusy] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const today = toIsoDay(new Date());
  const editingGigId = params.gigId ?? null;

  useEffect(() => {
    let active = true;
    void (async () => {
      const sourceGigId = params.gigId ?? params.fromGigId;
      const [home, nextCities, nextBands] = await Promise.all([
        sourceGigId ? creatorGigsService.hostHome(brandId).catch(() => null) : Promise.resolve(null),
        fetchProgramCities().catch(() => [] as ProgramCity[]),
        creatorGigsService.budgetBands(),
      ]);
      if (!active) return;
      const source = home?.gigs.find((gig) => gig.id === sourceGigId) ?? null;
      const nextListingId = source?.listing_id ?? params.listingId ?? "";
      const nextListing = nextListingId ? await fetchPromoteListing(source?.listing_kind ?? listingKind, nextListingId).catch(() => null) : null;
      if (!active) return;
      setCities(nextCities);
      setBands(nextBands);
      setListingId(nextListingId);
      setListing(nextListing);
      setForm(() => {
        if (source) {
          const prefill = briefFromGig(source, currency);
          // Book again starts fresh dates; edit keeps them.
          return params.gigId ? prefill : { ...prefill, shoot: null, postBy: "" };
        }
        const base = emptyBrief();
        return { ...base, cityId: matchCity(nextCities, nextListing?.cityName ?? null)?.id ?? null };
      });
      setReady(true);
    })();
    return () => { active = false; };
    // Load once per screen open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const update = <K extends keyof BriefForm>(key: K, value: BriefForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => ({ ...current, form: undefined }));
  };

  const payMinor = wholeCurrencyToMinor(form.payText, currency);
  const ctx = useMemo(() => ({ currency, today, bands, brandName: brand?.displayName, brandSlug: brand?.slug, listingTitle: listing?.title }), [currency, today, bands, brand?.displayName, brand?.slug, listing?.title]);
  const errors: BriefErrors = { ...(touched ? validateBrief(form, ctx, payMinor) : {}), ...serverErrors };
  const liveLint = lintPublicBrief(form.briefPublic, { brandName: brand?.displayName, brandSlug: brand?.slug, listingTitle: listing?.title });
  const ranges = bandsForCurrency(bands, currency);
  const formatRange = ranges.length > 0 ? `${programMoney(ranges[0].min_minor, currency)}–${programMoney(ranges[ranges.length - 1].max_minor, currency)}` : null;
  const fee = payMinor ?? 0;
  const perCreator = fee + bookingFeeMinor(fee);
  const maxSpend = payMinor === null
    ? "Set pay to see your max spend"
    : `${programMoney(fee * form.slots, currency)} + ${programMoney(bookingFeeMinor(fee) * form.slots, currency)} booking fee`;

  const post = async () => {
    setTouched(true);
    setServerErrors({});
    const found = validateBrief(form, ctx, payMinor);
    if (Object.keys(found).length > 0 || !listingId) return;
    setBusy(true);
    try {
      const result = await creatorGigsService.saveGig(gigPayload({ form, ctx, payMinor, brandId, listingKind: listing?.kind ?? listingKind, listingId, gigId: editingGigId }));
      if (!result.ok) {
        setServerErrors(briefServerErrors(result));
        return;
      }
      const gigId = result.id ?? editingGigId;
      if (gigId) router.replace(`/brand/${brandId}/creators/${gigId}/interest` as never);
      else router.back();
    } catch (error) {
      setServerErrors({ form: programErrorMessage(error, "We couldn't post this gig. Check the details and try again.") });
    } finally {
      setBusy(false);
    }
  };

  const togglePlatform = (platform: BriefPlatform) =>
    update("platforms", form.platforms.includes(platform) ? form.platforms.filter((item) => item !== platform) : [...form.platforms, platform]);

  return (
    <ProgramScreen
      title={editingGigId ? "Edit gig" : "Hire a creator"}
      leading="close"
      fallback={listingId ? `/brand/${brandId}/promote?kind=${listingKind}&listingId=${listingId}` : `/brand/${brandId}/creators`}
      footer={ready ? (
        <View style={styles.footer}>
          <View style={styles.spendRow}>
            <Text style={styles.spendLabel}>Max spend</Text>
            <Text style={styles.spendValue} numberOfLines={2}>{maxSpend}</Text>
          </View>
          {payMinor !== null && form.slots > 1 ? <Muted>{`${programMoney(perCreator, currency)} per creator × ${form.slots}`}</Muted> : null}
          <FieldError message={errors.form ?? (touched && Object.keys(validateBrief(form, ctx, payMinor)).length > 0 ? "Fix the highlighted fields to post." : null)} />
          <Button fullWidth label={editingGigId ? "Save changes" : "Post gig"} loading={busy} disabled={busy || !listingId} onPress={() => void post()} />
        </View>
      ) : undefined}
      overlay={
        <>
          <DateRangeSheet
            visible={rangeOpen}
            onClose={() => setRangeOpen(false)}
            value={form.shoot}
            onChange={(range) => {
              update("shoot", range);
              if (!form.postBy || form.postBy < range.end) {
                const post = new Date(Number(range.end.slice(0, 4)), Number(range.end.slice(5, 7)) - 1, Number(range.end.slice(8)) + 7);
                update("postBy", toIsoDay(post));
              }
            }}
            anchorDay={listing?.startDay ?? null}
            minDay={today}
          />
          <Sheet visible={formatOpen} onClose={() => setFormatOpen(false)} snapPoint="full">
            <SheetBody title="Format">
              <Muted>A proven structure creators can price consistently.</Muted>
              <ListGroup>
                {CREATOR_FORMATS.map((item) => (
                  <ListRow
                    key={item.key}
                    title={item.name}
                    subtitle={FORMAT_EXAMPLES[item.key]}
                    chevron={false}
                    right={form.formatKey === item.key ? <Text style={styles.check}>Selected</Text> : undefined}
                    onPress={() => { update("formatKey", item.key); setFormatOpen(false); }}
                  />
                ))}
              </ListGroup>
            </SheetBody>
          </Sheet>
        </>
      }
    >
      {!ready ? <ProgramLoading /> : (
        <>
          {listing ? <Muted>{listing.title}</Muted> : <FieldError message="Open this from a listing's Promote page to choose what creators promote." />}

          <SectionLabel>Goal</SectionLabel>
          <Segmented options={[["sell", "Sell tickets"], ["seen", "Get seen"]] as const} value={form.goal} onChange={(goal) => update("goal", goal)} />
          <Card>
            <Text style={programStyles.body}>
              {form.goal === "sell"
                ? "You pay a fixed fee, plus a share of every sale through their link or code. Results show sales."
                : "You pay a fixed fee for the video. Results show views and link clicks."}
            </Text>
          </Card>

          <SectionLabel>What they make</SectionLabel>
          <ListGroup>
            <ListRow title={formatName(form.formatKey)} subtitle={FORMAT_EXAMPLES[form.formatKey]} onPress={() => setFormatOpen(true)} accessibilityLabel={`Format: ${formatName(form.formatKey)}. Change format`} />
          </ListGroup>
          <View style={styles.chips}>
            {(Object.keys(PLATFORM_DELIVERABLES) as BriefPlatform[]).map((platform) => (
              <Chip key={platform} label={PLATFORM_DELIVERABLES[platform].label} selected={form.platforms.includes(platform)} onPress={() => togglePlatform(platform)} />
            ))}
          </View>
          <FieldError message={errors.platforms} />

          <SectionLabel>Brief</SectionLabel>
          <Input value={form.title} onChangeText={(value) => update("title", value)} placeholder="Title, e.g. Rooftop night out" accessibilityLabel="Gig title" error={errors.title ?? null} />
          <Text style={styles.label}>Public brief · creators see this before they're hired</Text>
          <Input
            value={form.briefPublic}
            onChangeText={(value) => update("briefPublic", value)}
            placeholder="What should the creator film? Keep names, links and handles out."
            multiline
            accessibilityLabel="Public brief"
            error={errors.briefPublic ?? null}
          />
          {!errors.briefPublic ? (
            liveLint.length > 0
              ? <FieldError message={briefLintMessage(liveLint)} />
              : form.briefPublic.trim().length >= 40
                ? <Text style={styles.ok}>No brand names, links or contacts</Text>
                : <Text style={styles.counter}>{`${form.briefPublic.trim().length} / 40 characters minimum`}</Text>
          ) : null}
          <Text style={styles.label}>Private brief · shown after they accept</Text>
          <Input value={form.briefPrivate} onChangeText={(value) => update("briefPrivate", value)} placeholder="Who to ask for at the door, parking, what to avoid" multiline accessibilityLabel="Private brief" error={errors.briefPrivate ?? null} />

          <SectionLabel>When</SectionLabel>
          <ListGroup>
            <ListRow title="Shoot dates" right={form.shoot ? dateRangeLabel(form.shoot.start, form.shoot.end) : "Choose"} onPress={() => setRangeOpen(true)} />
          </ListGroup>
          <FieldError message={errors.shoot} />
          <DateField label="Post by" value={form.postBy} onChangeValue={(value) => update("postBy", value)} accessibilityLabel="Post by date" min={form.shoot?.end ?? today} placeholder="Choose a date" hasError={Boolean(errors.postBy)} />
          <FieldError message={errors.postBy} />
          <Text style={styles.label}>Shoot city</Text>
          <View style={styles.chips}>
            {cities.map((city) => <Chip key={city.id} label={city.name} selected={form.cityId === city.id} onPress={() => update("cityId", city.id)} />)}
          </View>
          <FieldError message={errors.city} />

          <SectionLabel>Deal</SectionLabel>
          <NumberStepper label="Creators to hire" value={form.slots} min={1} max={10} onChange={(value) => update("slots", value)} />
          <FieldError message={errors.slots} />
          <Input
            value={form.payText}
            onChangeText={(value) => update("payText", value.replace(/[^0-9]/g, ""))}
            variant="number"
            placeholder={`Pay each creator up to (${currency})`}
            accessibilityLabel={`Pay each creator up to, in ${currency}`}
            error={errors.pay ?? null}
          />
          {formatRange ? <Muted>{`Creators charge ${formatRange} for this kind of work.`}</Muted> : null}
          {ranges.length === 0 ? (
            <>
              <Text style={styles.label}>Budget level creators see</Text>
              <View style={styles.chips}>
                {LEVELS.map((level, index) => <Chip key={level} label={`Level ${index + 1}`} selected={form.level === level} onPress={() => update("level", level)} />)}
              </View>
              <Muted>Level 1 suits newer creators; level 4 suits established ones.</Muted>
            </>
          ) : null}
          {form.goal === "sell" ? (
            <>
              <ListGroup>
                <ListRow title="Plus a sales share" subtitle="Paid automatically from each sale through their link or code" chevron={false} right={<Chip label={form.salesShare ? "On" : "Off"} selected={form.salesShare} onPress={() => update("salesShare", !form.salesShare)} accessibilityLabel={form.salesShare ? "Turn sales share off" : "Turn sales share on"} />} />
              </ListGroup>
              {form.salesShare ? (
                <View style={styles.chips}>
                  {SHARE_OPTIONS.map((percent) => <Chip key={percent} label={`${percent}%`} selected={form.salesSharePercent === percent} onPress={() => update("salesSharePercent", percent)} />)}
                </View>
              ) : null}
            </>
          ) : null}
          <Text style={styles.label}>You can reuse the video for</Text>
          <View style={styles.chips}>
            {USAGE_OPTIONS.map(([days, label]) => <Chip key={days} label={label} selected={form.usageDays === days} onPress={() => update("usageDays", days)} />)}
          </View>
        </>
      )}
    </ProgramScreen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.xs },
  spendRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  spendLabel: { color: textTokens.secondary, fontSize: 14 },
  spendValue: { color: textTokens.primary, fontSize: 16, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  label: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  ok: { color: semantic.success, fontSize: 13, fontWeight: "600" },
  counter: { color: textTokens.tertiary, fontSize: 12 },
  check: { color: semantic.success, fontWeight: "700", fontSize: 13 },
});
