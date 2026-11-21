/**
 * #4490 P6-2 — the membership plan editor (`mb-plans` "New plan"): one
 * screen. Name, the monthly or yearly price, what's included (free entry on one Entry
 * offer with guest passes, room hours on By the hour offers, a member price
 * on the kinds the host picks, and up to 6 lines of their own), how many
 * members the plan takes, and the terms copied onto each membership when it
 * starts (minimum months, notice, grace, when the payment email goes out).
 *
 * Save draft / Publish; what still stands in the way of
 * publishing is said in plain words (with the switch to turn Memberships on
 * for owners and admins). A price change applies from each member's next
 * billing period (said under the price). Every write carries the version the host last
 * saw; "someone else saved first" offers a reload.
 */
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useVenueEditAccess } from "../../../../hooks/useVenueEditAccess";
import { useSetVenueFeature } from "../../../../hooks/useVenueFeatures";
import { useManageMembershipPlan, useVenueMembershipPlans } from "../../../../hooks/useVenueMembershipPlans";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import type { MemberDiscountKind, MembershipPlan } from "../../../../types/venueMembers";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { BrandSwitch } from "../../../ui/BrandSwitch";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { ChipInput } from "../../../ui/ChipInput";
import { Input } from "../../../ui/Input";
import { MoneyField } from "../../../ui/MoneyField";
import { NumberStepper } from "../../../ui/NumberStepper";
import { Chip } from "../../../ui/Pill";
import { SelectSheet } from "../../../ui/SelectSheet";
import { Skeleton } from "../../../ui/Skeleton";
import { revealFocusedFieldWithin } from "../../offers/revealFocusedField";
import type { VenueModuleLeaveHandle } from "../../venueLeaveContract";
import { money } from "../offers/offersModel";
import {
  DISCOUNT_KIND_LABEL,
  DISCOUNT_OPTIONS,
  GRACE_OPTIONS,
  MIN_MONTH_OPTIONS,
  NOTICE_OPTIONS,
  RENEWAL_NOTICE_OPTIONS,
  YEARLY_RENEWAL_NOTICE_OPTIONS,
  planDraftFrom,
  planErrorCopy,
  planIncludesLines,
  planIssueList,
  planIssues,
  planPayload,
  planPeriodDraft,
  type PlanDraft,
} from "./membersModel";

const INCLUSION_SUGGESTIONS = [
  "Power and fast internet",
  "Cooling all day",
  "A locker",
  "Printing",
  "Free coffee",
  "Your own desk",
] as const;

const DISCOUNT_KINDS: readonly MemberDiscountKind[] = ["by_the_hour", "entry", "group_package", "private_hire"];

export interface PlanEditorProps {
  brandId: string | null;
  venueId: string | null;
  venueName: string;
  planId: string | null;
  onClose: (result?: { published: boolean; name: string }) => void;
  onOpenOffers?: () => void;
}

export const PlanEditor = forwardRef<VenueModuleLeaveHandle, PlanEditorProps>(function PlanEditor(
  { brandId, venueId, venueName, planId, onClose, onOpenOffers },
  ref,
): React.ReactElement {
  const currency = useBrandCurrency(brandId);
  const plansQuery = useVenueMembershipPlans(brandId, venueId);
  const offersQuery = useVenueOffers(brandId, venueId);
  const access = useVenueEditAccess(brandId, venueId);
  const setFeature = useSetVenueFeature(brandId, venueId);
  const manage = useManageMembershipPlan(brandId, venueId);
  const state = plansQuery.data;
  const [currentId, setCurrentId] = useState<string | null>(planId);
  const [savedPlan, setSavedPlan] = useState<MembershipPlan | null>(null);
  const listPlan = state?.plans.find((p) => p.id === currentId) ?? null;
  const plan = savedPlan !== null && savedPlan.id === currentId ? savedPlan : listPlan;
  const entryOffers = useMemo(() => state?.entryOffers ?? [], [state?.entryOffers]);
  const hourOffers = useMemo(() => state?.hourOffers ?? [], [state?.hourOffers]);
  const spaces = useMemo(() => state?.spaces ?? [], [state?.spaces]);
  const defaults = { entryOfferingId: entryOffers.length === 1 ? entryOffers[0]?.id ?? null : null };
  const [draft, setDraft] = useState<PlanDraft>(() => planDraftFrom(plan, defaults));
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(planDraftFrom(plan, defaults)));
  const loadedFor = useRef<string | null>(plan?.id ?? (state !== undefined ? "new" : null));
  useEffect(() => {
    // The plans arrive after mount when opened from a link.
    if (state === undefined) return;
    const key = plan?.id ?? "new";
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    const d = planDraftFrom(plan, { entryOfferingId: entryOffers.length === 1 ? entryOffers[0]?.id ?? null : null });
    setDraft(d);
    setBaseline(JSON.stringify(d));
  }, [entryOffers, plan, state]);
  const dirty = JSON.stringify(draft) !== baseline;
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const issues = planIssues(draft, currency ?? "NGN");
  const issueList = planIssueList(issues);
  const patch = (next: Partial<PlanDraft>): void => {
    setDraft((d) => ({ ...d, ...next }));
    setError(null);
    setSaved(null);
  };

  const featureOn = state?.featureOn === true;
  const canCollectOnline = offersQuery.data?.canCollectOnline !== false;
  const status = plan?.status ?? "draft";

  const persist = async (): Promise<MembershipPlan> => {
    if (venueId === null) throw new Error("venue_required");
    const payload = planPayload(draft, plan?.id ?? null);
    const next =
      plan === null
        ? await manage.mutateAsync({ action: "create", payload })
        : await manage.mutateAsync({ action: "update", payload, expectedVersion: plan.version });
    setCurrentId(next.id);
    setSavedPlan(next);
    loadedFor.current = next.id;
    const d = planDraftFrom(next);
    setDraft(d);
    setBaseline(JSON.stringify(d));
    return next;
  };

  const run = async (publish: boolean): Promise<void> => {
    if (busy !== null) return;
    setShowErrors(true);
    if (issueList.length > 0) {
      setError(issueList[0] ?? null);
      return;
    }
    setBusy(publish ? "publish" : "save");
    setError(null);
    try {
      let current = dirty || plan === null ? await persist() : (plan as MembershipPlan);
      if (publish && current.status !== "live") {
        current = await manage.mutateAsync({ action: "publish", payload: { planId: current.id }, expectedVersion: current.version });
        setSavedPlan(current);
      }
      if (publish) {
        onClose({ published: true, name: current.name });
        return;
      }
      setSaved("Draft saved");
    } catch (e) {
      const err = toVenueOfferError(e);
      if (err.code === "stale_write") setStale(true);
      setError(planErrorCopy(err.code, err.detail));
    } finally {
      setBusy(null);
    }
  };

  useImperativeHandle(
    ref,
    (): VenueModuleLeaveHandle => ({
      isDirty: () => dirty,
      changedLabels: () => (dirty ? [draft.name.trim() || "Membership plan"] : []),
      isValid: () => issueList.length === 0,
      save: async () => {
        await persist();
      },
      discard: () => setDraft(JSON.parse(baseline) as PlanDraft),
    }),
  );

  if (plansQuery.isLoading) {
    return (
      <View style={styles.host} testID="plan-editor-loading">
        <Skeleton height={32} width="40%" />
        <Skeleton height={200} radius="md" />
      </View>
    );
  }
  if (plansQuery.isError || state === undefined) {
    return (
      <CenteredState title="Couldn't load your plans" body="Check your connection and try again." tone="error" testID="plan-editor-error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void plansQuery.refetch()} />
      </CenteredState>
    );
  }
  if (planId !== null && plan === null) {
    return (
      <CenteredState title="This plan isn't here any more" body="It may have been archived. Go back to Plans." testID="plan-editor-missing">
        <Button label="Back to plans" variant="secondary" size="md" onPress={() => onClose()} />
      </CenteredState>
    );
  }

  const entryName = entryOffers.find((o) => o.id === draft.entryOfferingId)?.name ?? null;
  const roomNames =
    draft.hourOfferingIds.length === 0 ? hourOffers.map((o) => o.name) : hourOffers.filter((o) => draft.hourOfferingIds.includes(o.id)).map((o) => o.name);
  const includes = planIncludesLines(draft, { entryOffer: entryName, hourOffers: roomNames });
  const archived = status === "archived";

  return (
    <View style={styles.host} testID="plan-editor">
      <View style={styles.head}>
        <Button label="Back to plans" variant="ghost" size="sm" leadingIcon="chevL" onPress={() => onClose()} testID="plan-editor-back" />
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          {plan === null ? "New plan" : draft.name || "Plan"}
        </Text>
        <Text style={styles.status}>{status === "live" ? "ON SALE" : status === "paused" ? "NOT TAKING NEW MEMBERS" : status === "archived" ? "ARCHIVED" : "DRAFT"}</Text>
      </View>
      {plan === null ? (
        // #4490 N60: New offer › Membership lands here, so say where plans live.
        <Text style={styles.hint} testID="plan-editor-where">
          Membership plans live in Members › Plans. After you save, you&apos;ll find this plan there, and its members under Members.
        </Text>
      ) : null}
      {stale ? (
        <Banner
          tone="warning"
          title="Someone else saved this plan first"
          body="Reload to see their changes, then make yours again."
          action={{
            label: "Reload",
            onPress: () => {
              setStale(false);
              setSavedPlan(null);
              loadedFor.current = null;
              void plansQuery.refetch();
            },
            testID: "plan-editor-reload",
          }}
        />
      ) : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.form} ref={revealFocusedFieldWithin}>
          {!featureOn ? (
            <Banner
              tone="warning"
              title="Memberships is off"
              body={
                access.canSwitchFeatures
                  ? "You can set up a plan now. It can go on sale once Memberships is on."
                  : "You can set up a plan now. Ask a brand owner or admin to turn on Memberships so it can go on sale."
              }
              action={
                access.canSwitchFeatures
                  ? {
                      label: setFeature.isPending ? "Turning on…" : "Turn on Memberships",
                      onPress: () =>
                        setFeature.mutate(
                          { key: "memberships", enabled: true, cascade: true },
                          {
                            onSuccess: () => void plansQuery.refetch(),
                            onError: () => setError("Couldn't turn on Memberships. Try again, or switch it on in Settings."),
                          },
                        ),
                      testID: "plan-editor-turn-on",
                    }
                  : undefined
              }
              testID="plan-editor-feature-off"
            />
          ) : null}
          {!canCollectOnline ? (
            <Banner
              tone="warning"
              title="Online payments aren't set up"
              body={`Members pay each ${draft.period} online. Set up your brand's payments before people can join.`}
              testID="plan-editor-payments-off"
            />
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>What it&apos;s called</Text>
            <Input
              value={draft.name}
              onChangeText={(name) => patch({ name: name.slice(0, 80) })}
              placeholder="Hot desk, Dedicated desk, Friends of the house"
              accessibilityLabel="Plan name"
              error={showErrors ? issues.name : null}
              disabled={archived}
              testID="plan-editor-name"
            />
            <Input
              value={draft.summary}
              onChangeText={(summary) => patch({ summary: summary.slice(0, 300) })}
              placeholder="One line guests see (optional)"
              accessibilityLabel="One line guests see"
              disabled={archived}
              testID="plan-editor-summary"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Price</Text>
            <SelectSheet
              label="Billed"
              value={draft.period}
              options={[
                { value: "month" as const, label: "Monthly" },
                { value: "year" as const, label: "Yearly" },
              ]}
              onChange={(period) => patch(planPeriodDraft(draft, period))}
              disabled={archived || plan?.periodLocked === true}
              testID="plan-editor-period"
            />
            {plan?.periodLocked === true ? <Text style={styles.hint}>Billing is locked because someone has joined or requested this plan.</Text> : null}
            <MoneyField
              label={draft.period === "year" ? "Each year" : "Each month"}
              valueMinor={draft.priceMinor}
              onChangeMinor={(priceMinor) => patch({ priceMinor })}
              currency={currency}
              error={showErrors ? issues.price : null}
              disabled={archived}
              testID="plan-editor-price"
            />
            <Text style={styles.hint}>
              {plan !== null && plan.members > 0
                ? `A new price applies from each member's next ${draft.period}. Members always pay for one ${draft.period} at a time.`
                : `Members pay for one ${draft.period} at a time. VAT follows your Terms and tax.`}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How people join</Text>
            <SelectSheet
              label="Joining"
              value={draft.joinMode}
              options={[
                { value: "instant" as const, label: "Join and pay" },
                { value: "request" as const, label: "Ask to join" },
              ]}
              onChange={(joinMode) => patch({ joinMode })}
              disabled={archived}
              testID="plan-editor-join-mode"
            />
            <Text style={styles.hint}>
              {draft.joinMode === "request"
                ? `Guests send a request without paying. ${venueName} approves first, then they have 3 days to pay their first ${draft.period}.`
                : `Guests pay their first ${draft.period} when they join.`}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>What&apos;s included</Text>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchTitle}>Free entry</Text>
                <Text style={styles.hint}>Members get in free on one Entry offer, once a day.</Text>
              </View>
              <BrandSwitch
                value={draft.entryIncluded}
                onValueChange={(entryIncluded) => patch({ entryIncluded })}
                disabled={archived || (entryOffers.length === 0 && !draft.entryIncluded)}
                accessibilityLabel="Free entry"
                testID="plan-editor-entry"
              />
            </View>
            {entryOffers.length === 0 ? (
              <View style={styles.inline}>
                <Text style={styles.hint}>This venue has no Entry offer yet. Add one in Offers to include free entry.</Text>
                {onOpenOffers !== undefined ? (
                  <Button label="Open Offers" variant="secondary" size="sm" onPress={onOpenOffers} testID="plan-editor-open-offers" />
                ) : null}
              </View>
            ) : null}
            {draft.entryIncluded && entryOffers.length > 0 ? (
              <View style={styles.inset}>
                <SelectSheet
                  label="Entry offer"
                  value={draft.entryOfferingId}
                  options={entryOffers.map((o) => ({ value: o.id, label: o.name }))}
                  onChange={(entryOfferingId) => patch({ entryOfferingId })}
                  hasError={showErrors && issues.entry !== null}
                  placeholder="Pick an Entry offer"
                  testID="plan-editor-entry-offer"
                />
                {showErrors && issues.entry !== null ? <Text style={styles.error}>{issues.entry}</Text> : null}
                <NumberStepper
                  label={`Guest passes a ${draft.period}`}
                  value={draft.guestPasses}
                  min={0}
                  max={draft.period === "year" ? 1200 : 100}
                  onChange={(guestPasses) => patch({ guestPasses })}
                  testID="plan-editor-guest-passes"
                />
                <Text style={styles.hint}>{`A member can bring a guest in free with a pass. Unused passes end with the ${draft.period}.`}</Text>
              </View>
            ) : null}

            <NumberStepper
              label={`Room hours a ${draft.period}`}
              value={Math.round(draft.roomHours)}
              min={0}
              max={draft.period === "year" ? 8784 : 744}
              onChange={(roomHours) => patch({ roomHours })}
              testID="plan-editor-room-hours"
            />
            {draft.roomHours > 0 ? (
              hourOffers.length === 0 ? (
                <View style={styles.inline}>
                  <Text style={styles.hint}>No By the hour offer yet. Members can use their hours once you sell rooms by the hour.</Text>
                  {onOpenOffers !== undefined ? (
                    <Button label="Open Offers" variant="secondary" size="sm" onPress={onOpenOffers} testID="plan-editor-open-offers-hour" />
                  ) : null}
                </View>
              ) : (
                <View style={styles.inset}>
                  <Text style={styles.label}>Hours can be used on</Text>
                  <View style={styles.chips}>
                    <Chip
                      label="Every room"
                      selected={draft.hourOfferingIds.length === 0}
                      onPress={() => patch({ hourOfferingIds: [] })}
                      testID="plan-editor-rooms-all"
                    />
                    {hourOffers.map((o) => (
                      <Chip
                        key={o.id}
                        label={o.name}
                        selected={draft.hourOfferingIds.includes(o.id)}
                        onPress={() =>
                          patch({
                            hourOfferingIds: draft.hourOfferingIds.includes(o.id)
                              ? draft.hourOfferingIds.filter((x) => x !== o.id)
                              : [...draft.hourOfferingIds, o.id],
                          })
                        }
                        testID={`plan-editor-room-${o.id}`}
                      />
                    ))}
                  </View>
                  <Text style={styles.hint}>{`Members use their hours first; anything over is charged at the room's price. Unused hours end with the ${draft.period}.`}</Text>
                </View>
              )
            ) : null}

            <SelectSheet
              label="Member price"
              value={draft.discountPercent}
              options={DISCOUNT_OPTIONS}
              onChange={(discountPercent) => patch({ discountPercent, discountKinds: discountPercent > 0 && draft.discountKinds.length === 0 ? ["by_the_hour"] : draft.discountKinds })}
              testID="plan-editor-discount"
            />
            {draft.discountPercent > 0 ? (
              <View style={styles.inset}>
                {/* #4490 fix 2 (N80): say what the chips choose, and which are chosen. */}
                <Text style={styles.label}>{`${draft.discountPercent}% off on`}</Text>
                <View style={styles.chips}>
                  {DISCOUNT_KINDS.map((k) => (
                    <Chip
                      key={k}
                      label={DISCOUNT_KIND_LABEL[k]}
                      selected={draft.discountKinds.includes(k)}
                      onPress={() =>
                        patch({
                          discountKinds: draft.discountKinds.includes(k)
                            ? draft.discountKinds.filter((x) => x !== k)
                            : [...draft.discountKinds, k],
                        })
                      }
                      testID={`plan-editor-discount-${k}`}
                    />
                  ))}
                </View>
                <Text style={styles.hint}>
                  {draft.discountKinds.length > 0
                    ? `Members pay ${100 - draft.discountPercent}% of the price on ${draft.discountKinds.map((k) => DISCOUNT_KIND_LABEL[k]).join(" and ")}.`
                    : "Tap what the member price applies to."}
                </Text>
                {showErrors && issues.discount !== null ? <Text style={styles.error}>{issues.discount}</Text> : null}
              </View>
            ) : null}

            <ChipInput
              label="Also included"
              helper="Up to 6 short lines guests see, like power, internet or a locker."
              values={draft.inclusions}
              onChange={(inclusions) => patch({ inclusions: inclusions.map((l) => l.slice(0, 80)).slice(0, 6) })}
              suggestions={INCLUSION_SUGGESTIONS}
              placeholder="Add a line"
              editable={!archived && draft.inclusions.length < 6}
              testID="plan-editor-inclusions"
            />
            {showErrors && issues.inclusions !== null ? <Text style={styles.error}>{issues.inclusions}</Text> : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Places on this plan</Text>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchTitle}>Limit the number of members</Text>
                <Text style={styles.hint}>When it&apos;s full, the plan shows as full and nobody new can join.</Text>
              </View>
              <BrandSwitch
                value={draft.limitMembers}
                onValueChange={(limitMembers) => patch({ limitMembers })}
                disabled={archived}
                accessibilityLabel="Limit the number of members"
                testID="plan-editor-limit"
              />
            </View>
            {draft.limitMembers ? (
              <NumberStepper label="Most members" value={draft.maxMembers} min={1} max={100000} onChange={(maxMembers) => patch({ maxMembers })} testID="plan-editor-max-members" />
            ) : null}
            <View style={styles.inset}>
              <Text style={styles.label}>Desks you can assign</Text>
              {spaces.length === 0 ? (
                <Text style={styles.hint}>Add spaces before assigning a dedicated desk to a member.</Text>
              ) : (
                <View style={styles.chips}>
                  {spaces.map((spaceOption) => (
                    <Chip
                      key={spaceOption.id}
                      label={spaceOption.name}
                      selected={draft.deskSpaceIds.includes(spaceOption.id)}
                      onPress={() =>
                        patch({
                          deskSpaceIds: draft.deskSpaceIds.includes(spaceOption.id)
                            ? draft.deskSpaceIds.filter((id) => id !== spaceOption.id)
                            : [...draft.deskSpaceIds, spaceOption.id],
                        })
                      }
                      disabled={archived}
                      testID={`plan-editor-desk-${spaceOption.id}`}
                    />
                  ))}
                </View>
              )}
              <Text style={styles.hint}>A desk assigned to a member is held for them until they leave, lapse, pause or you unassign it.</Text>
              {showErrors && issues.desks !== null ? <Text style={styles.error}>{issues.desks}</Text> : null}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Terms</Text>
            <Text style={styles.hint}>Copied onto each membership when it starts, so later edits never change a deal already made.</Text>
            <View style={styles.row2}>
              <View style={styles.cell}>
                {draft.period === "year" ? (
                  <SelectSheet label="Minimum stay" value={12} options={[{ value: 12, label: "1 year" }]} onChange={() => undefined} disabled testID="plan-editor-min-months" />
                ) : (
                  <SelectSheet label="Minimum stay" value={draft.minMonths} options={MIN_MONTH_OPTIONS} onChange={(minMonths) => patch({ minMonths })} testID="plan-editor-min-months" />
                )}
              </View>
              <View style={styles.cell}>
                <SelectSheet label="Notice to leave" value={draft.noticeDays} options={NOTICE_OPTIONS} onChange={(noticeDays) => patch({ noticeDays })} testID="plan-editor-notice" />
              </View>
              <View style={styles.cell}>
                <SelectSheet label="Payment email goes out" value={draft.renewalNoticeDays} options={draft.period === "year" ? YEARLY_RENEWAL_NOTICE_OPTIONS : RENEWAL_NOTICE_OPTIONS} onChange={(renewalNoticeDays) => patch({ renewalNoticeDays })} testID="plan-editor-renewal-notice" />
              </View>
              <View style={styles.cell}>
                <SelectSheet label="Grace after the due day" value={draft.graceDays} options={GRACE_OPTIONS} onChange={(graceDays) => patch({ graceDays })} testID="plan-editor-grace" />
              </View>
            </View>
            <Text style={styles.hint}>
              {`Before each ${draft.period} we email a link to pay ${draft.renewalNoticeDays} days ahead. Nothing renews by itself. ${
                draft.graceDays > 0
                  ? `If it isn't paid, they can still come in for ${draft.graceDays} days, then the membership lapses until it's paid.`
                  : "If it isn't paid on the day, the membership lapses until it's paid."
              }`}
            </Text>
          </View>

          <View style={styles.section} testID="plan-editor-preview">
            <Text style={styles.sectionTitle}>Guests will see</Text>
            <Text style={styles.previewTitle}>{draft.name.trim() || "Your plan"}</Text>
            <Text style={styles.previewPrice}>
              {draft.priceMinor !== null && draft.priceMinor > 0 ? `${money(draft.priceMinor, currency)} a ${draft.period}` : "Set a price"}
            </Text>
            {includes.length > 0 ? (
              includes.map((line) => (
                <Text key={line} style={styles.hint}>{`• ${line}`}</Text>
              ))
            ) : (
              <Text style={styles.hint}>Add what&apos;s included above.</Text>
            )}
            <Text style={styles.hint}>{draft.joinMode === "request" ? "Ask to join · the venue approves before payment" : "Join and pay"}</Text>
            {draft.deskSpaceIds.length > 0 ? <Text style={styles.hint}>An assigned desk may be available.</Text> : null}
          </View>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        {error !== null ? (
          <Text style={styles.error} accessibilityRole="alert" testID="plan-editor-error-line">{error}</Text>
        ) : saved !== null ? (
          <Text style={styles.saved} accessibilityLiveRegion="polite">{saved}</Text>
        ) : showErrors && issueList.length > 0 ? (
          <Text style={styles.error}>{`Before it can go on sale: ${issueList.join(". ")}.`}</Text>
        ) : !featureOn ? (
          <Text style={styles.hint}>Publishing opens once Memberships is on.</Text>
        ) : dirty ? (
          <Text style={styles.hint}>Unsaved changes</Text>
        ) : (
          <Text style={styles.hint}>{`Sold at ${venueName}`}</Text>
        )}
        <View style={styles.footerButtons}>
          <Button label="Save draft" variant="secondary" size="md" onPress={() => void run(false)} loading={busy === "save"} disabled={busy !== null || archived || (status !== "draft" && !dirty)} testID="plan-editor-save" />
          <Button
            label={status === "live" ? "Save changes" : status === "paused" ? "Save and put on sale" : "Publish"}
            variant="primary"
            size="md"
            onPress={() => void run(true)}
            loading={busy === "publish"}
            disabled={busy !== null || archived || !featureOn}
            testID="plan-editor-publish"
          />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  host: { flex: 1, gap: space[3] },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingTop: space[4] },
  title: { ...type.h1, color: color.text1, flexShrink: 1 },
  status: { ...type.label, color: color.text2 },
  scroll: { flex: 1 },
  content: { gap: space[4], paddingHorizontal: space[4], paddingBottom: space[8], width: "100%", maxWidth: 720, alignSelf: "center" },
  form: { gap: space[4] },
  section: { gap: space[3], padding: space[4], borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.fill.tile },
  sectionTitle: { ...type.row, color: color.text1 },
  label: { ...type.label, color: color.text2 },
  hint: { ...type.caption, color: color.text2 },
  error: { ...type.small, color: color.errorText },
  saved: { ...type.small, color: color.successText },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  row2: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  cell: { flexGrow: 1, flexBasis: 220 },
  inline: { gap: space[2], alignItems: "flex-start" },
  inset: { gap: space[3], paddingLeft: space[3], borderLeftWidth: 2, borderLeftColor: color.line },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 44 },
  switchText: { flex: 1, gap: 2 },
  switchTitle: { ...type.row, color: color.text1 },
  previewTitle: { ...type.h2, color: color.text1 },
  previewPrice: { ...type.row, color: color.text1 },
  footer: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    backgroundColor: color.canvas,
  },
  footerButtons: { flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "flex-end" },
});
