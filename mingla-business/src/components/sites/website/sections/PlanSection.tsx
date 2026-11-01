import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useWebsite } from "../WebsiteContext";
import { partName } from "./OverviewSection";
import { Banner, CheckCircle, Chip, Hint, ListBox, SectionHead, Skeleton, WButton, ui } from "../ui";
import { useSaveBrandSitePlan } from "../../../../sites/planApi";
import { firstOfferingRoute } from "../../../../sites/planRoutes";
import { OfferingsPart } from "../../plan/OfferingsPart";
import { StoryPart } from "../../plan/StoryPart";
import { BuildPart } from "../../plan/BuildPart";
import { PlanDesignPart } from "../../plan/PlanDesignPart";
import type { SitePlanState } from "../../../../sites/sitePlanState";
import { PLAN_PARTS, type PlanPartKey } from "../../../../../../packages/site-contracts/src/sitePlan.ts";
import { BrandSitesError } from "../../../../services/brandSitesService";

const OWNER_PARTS = new Set<PlanPartKey>(["approve", "build", "publish"]);

/**
 * #2829 W11 (design contract, "Another admin opens the plan someone else
 * started"): one plan per brand, so a member who didn't start it is told who
 * did and when, and continues from the next unfinished part. Core gives the
 * starter's name or null (no name on file); the wording for null is ours.
 * Returns null when there is nothing to say.
 */
export function startedByLine(planState: SitePlanState | null, live: boolean): string | null {
  const plan = planState?.plan;
  if (!plan || plan.startedByMe || !plan.startedAt || live) return null;
  if (planState.doneCount >= planState.parts.length && planState.parts.length > 0) return null;
  const when = new Date(plan.startedAt);
  if (Number.isNaN(when.getTime())) return null;
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(when);
  return `${plan.startedByName ?? "A teammate"} started this on ${day}. Continue?`;
}

/**
 * #2829 W9r (DESIGN_SPEC §1.6 Setup plan) — the 8 parts with their ticks
 * (server truth: a live site never shows "build" as undone), the next part
 * first, "With Ari" or "Do it myself", Review for done parts. Parts open
 * inside the Website section; brand details and the first offering go to
 * their own screens.
 */
export function PlanSection({ part, planState }: { part: string | null; planState: SitePlanState | null }): React.ReactElement {
  const ctx = useWebsite();
  const { phone, headingRef, brandId, toast } = ctx;
  const router = useRouter();
  const save = useSaveBrandSitePlan(brandId);
  const [busy, setBusy] = useState<string | null>(null);
  const [showGaps, setShowGaps] = useState(false);

  if (part === "offer") return <OfferingsPart brandId={brandId} embedded />;
  if (part === "story") return <StoryPart brandId={brandId} step="questions" embedded />;
  if (part === "approve") return <StoryPart brandId={brandId} step="approve" embedded />;
  if (part === "build") return <BuildPart brandId={brandId} embedded />;

  if (!planState) {
    return <View role="status" accessibilityLabel="Loading your setup plan"><Skeleton height={32} width="40%" style={{ marginBottom: 16 }} /><Skeleton height={300} /></View>;
  }
  if (part === "look") {
    return <PlanDesignPart brandId={brandId} planState={planState} />;
  }
  const parts = planState.parts.length ? planState.parts : PLAN_PARTS.map((entry) => ({ key: entry.key, done: false, skipped: false, optional: entry.optional }));
  const doneCount = planState.doneCount;
  const total = parts.length;
  const live = planState.site?.published === true;
  const next = parts.find((entry) => !entry.done)?.key ?? null;
  const canManage = planState.canManage;
  // Server truth: a paused site pauses the plan; while someone else holds the
  // lock this member can look but not change anything.
  const paused = planState.site?.paused === true;
  const readOnly = paused || ctx.lock.heldByOther;
  const completeness = planState.completeness;
  const gaps = completeness?.fields.filter(
    (field) =>
      field.requirement !== "optional" &&
      field.state !== "verified" &&
      field.state !== "not_applicable",
  ) ?? [];

  const withAri = (key: PlanPartKey) => {
    setBusy(`ari:${key}`);
    save.mutateAsync({ revision: planState.plan?.revision ?? 0, patch: { active_part: key } })
      .then(() => router.push(
        `/brand/${brandId}/website/ari?intent=setup&part=${encodeURIComponent(key)}` as never,
      ))
      .catch((error: unknown) => toast(error instanceof BrandSitesError ? error.message : "Ari couldn’t be pointed at this part. Try again.", "error"))
      .finally(() => setBusy(null));
  };
  const myself = (key: PlanPartKey) => {
    switch (key) {
      case "offer":
      case "story":
      case "approve":
        ctx.go({ kind: "section", section: "plan", planPart: key });
        return;
      case "build":
        if (planState.site) {
          toast("Your draft already exists, so this part is done. To add pages, use Pages.");
          ctx.go({ kind: "section", section: "pages" });
          return;
        }
        ctx.go({ kind: "section", section: "plan", planPart: "build" });
        return;
      case "brand":
        router.push(`/brand/${brandId}/edit` as never);
        return;
      case "look":
        if (planState.site) ctx.go({ kind: "section", section: "design" });
        else ctx.go({ kind: "section", section: "plan", planPart: "look" });
        return;
      case "publish":
        ctx.go({ kind: "section", section: "publish" });
        return;
      case "first_offering": {
        const route = firstOfferingRoute(planState);
        if (route) router.push(route as never);
        else toast("There's nothing to add for what you ticked. Skip this part, or tick Trips, Events or Experiences in What you'll offer.");
        return;
      }
    }
  };
  const skip = (key: PlanPartKey) => {
    setBusy(`skip:${key}`);
    const current = planState.plan?.skippedParts ?? [];
    save.mutateAsync({ revision: planState.plan?.revision ?? 0, patch: { skipped_parts: [...new Set([...current, key])] } })
      .then(() => toast("Skipped. It stays on your Home to-do list.", "success"))
      .catch((error: unknown) => toast(error instanceof BrandSitesError ? error.message : "That didn’t save. Try again.", "error"))
      .finally(() => setBusy(null));
  };

  return (
    <View testID="website-plan">
      <SectionHead
        ref={headingRef}
        phone={phone}
        title="Setup plan"
        subtitle={live ? "Your website is built and live. Each part stays here so you can revisit it." : "One part at a time, with Ari or by yourself. Stop whenever; progress saves to the brand."}
        right={<Chip label={`${doneCount} of ${total} done`} tone={doneCount >= total ? "ok" : "accent"} testID="plan-count" />}
      />
      {paused ? <Banner tone="warn" icon="alert" alert title="Mingla has paused your website, so the plan is paused too." body="We'll tell you when it can carry on." testID="plan-paused" /> : null}
      {!paused && startedByLine(planState, live) && next ? (
        <Banner tone="info" icon="plan" title={startedByLine(planState, live) ?? ""} body={`There's one plan for this brand, so you both see the same progress. Next: ${partName(next)}.`} testID="plan-started-by">
          {readOnly || (!canManage && OWNER_PARTS.has(next)) ? null : <WButton label="Continue" size="sm" onPress={() => myself(next)} testID="plan-started-continue" />}
        </Banner>
      ) : null}
      {completeness && completeness.gapCount > 0 ? (
        <Banner
          tone="warn"
          icon="alert"
          title={`${completeness.gapCount} brand context ${completeness.gapCount === 1 ? "gap" : "gaps"} to resolve`}
          body="A plan tick means the minimum is present. These details still need a verified value or your explicit not-applicable decision before the first draft can be built."
          testID="plan-context-gaps"
        >
          <View style={styles.gapActions}>
            <WButton
              label={showGaps ? "Hide gaps" : "See gaps"}
              size="sm"
              variant="secondary"
              onPress={() => setShowGaps((value) => !value)}
              testID="plan-see-gaps"
            />
            <WButton
              label="Continue with Ari"
              icon="spark"
              size="sm"
              onPress={() => withAri("brand")}
              loading={busy === "ari:brand"}
              testID="plan-gaps-ari"
            />
            <WButton
              label="Add it myself"
              size="sm"
              variant="primary"
              onPress={() => router.push(`/brand/${brandId}/edit` as never)}
              testID="plan-gaps-self"
            />
          </View>
          {showGaps ? (
            <View style={styles.gapList} testID="plan-gap-list">
              {gaps.map((field) => (
                <View key={field.key} style={styles.gapRow}>
                  <Text style={styles.gapLabel}>{field.label}</Text>
                  <Text style={styles.gapState}>
                    {field.state.replace("_", " ")}
                    {field.humanActionRequired ? " · needs your upload" : ""}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Banner>
      ) : completeness?.contextComplete ? (
        <Banner
          tone="info"
          icon="check"
          title="Brand context is complete"
          body={`${completeness.verifiedCount} fields verified${completeness.exceptionCount ? ` · ${completeness.exceptionCount} explicit exceptions` : ""}. Ari will re-check this before Build your pages.`}
          testID="plan-context-complete"
        />
      ) : null}
      <ListBox>
        {parts.map((entry) => {
          const isNext = entry.key === next;
          const meta = PLAN_PARTS.find((row) => row.key === entry.key);
          const needsAdmin = !canManage && OWNER_PARTS.has(entry.key);
          return (
            <View key={entry.key} style={[styles.row, isNext ? styles.rowNext : null]} testID={`plan-part-${entry.key}`}>
              <CheckCircle state={entry.done ? "on" : "off"} />
              <View style={styles.grow}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{partName(entry.key)}</Text>
                  {isNext ? <Chip label="Next" tone="accent" /> : null}
                  {entry.optional && !entry.done ? <Chip label="Optional" /> : null}
                  {entry.key === "brand" && entry.done && (completeness?.gapCount ?? 0) > 0
                    ? <Chip label={`${completeness?.gapCount ?? 0} gaps`} tone="warn" />
                    : null}
                </View>
                <Text style={styles.sub}>{entry.done
                  ? entry.key === "brand" && (completeness?.gapCount ?? 0) > 0
                    ? `Minimum done · ${completeness?.gapCount ?? 0} website-ready gaps`
                    : (entry.skipped ? "Skipped" : live ? "Done" : "Done · you can change it any time")
                  : meta?.duration ?? ""}</Text>
              </View>
              <View style={styles.actions}>
                {entry.done ? (
                  <WButton label="Review" size="sm" onPress={() => myself(entry.key)} testID={`plan-review-${entry.key}`} />
                ) : readOnly ? null : needsAdmin ? (
                  <WButton label="Ask an admin" icon="msg" size="sm" onPress={() => ctx.askAdmin("plan")} loading={ctx.asking} testID={`plan-ask-${entry.key}`} />
                ) : (
                  <>
                    <WButton label="With Ari" icon="spark" size="sm" onPress={() => withAri(entry.key)} loading={busy === `ari:${entry.key}`} testID={`plan-ari-${entry.key}`} />
                    <WButton label="Do it myself" variant={isNext ? "primary" : "secondary"} size="sm" onPress={() => myself(entry.key)} testID={`plan-self-${entry.key}`} />
                    {meta?.skippable && entry.optional ? <WButton label="Skip" variant="ghost" size="sm" onPress={() => skip(entry.key)} loading={busy === `skip:${entry.key}`} testID={`plan-skip-${entry.key}`} /> : null}
                  </>
                )}
              </View>
            </View>
          );
        })}
      </ListBox>
      <Hint style={styles.help}>Parts tick themselves from what Mingla already knows. &quot;Build your pages&quot; never offers to create a second website once one exists.</Hint>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 140 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 64, flexWrap: "wrap" },
  rowNext: { borderLeftWidth: 3, borderLeftColor: ui.accent },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { fontSize: 14, fontWeight: "600", color: ui.t1 },
  sub: { fontSize: 12.5, lineHeight: 17, color: ui.t3 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  gapActions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 12 },
  gapList: { marginTop: 12, gap: 8 },
  gapRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  gapLabel: { color: ui.t1, fontSize: 13, fontWeight: "600" },
  gapState: { color: ui.t3, fontSize: 12.5, textTransform: "capitalize" },
  help: { marginTop: 12 },
});
