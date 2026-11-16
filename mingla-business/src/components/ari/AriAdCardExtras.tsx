/**
 * #4238 W6b — the Host ad lines on Ari's proposal card, loaded lazily so the
 * Host Ads words and services stay out of the Ari chunk until an ad card
 * shows (I-4238 one lazy chunk).
 *
 * - propose_ad_plan: the goal, the apps the Host agreed may count page
 *   visits for now, and how many videos and photos are picked.
 * - apply_ad_suggestion: the money confirm. The card reads the ad's report
 *   (the same suggestion the server will re-check) and shows what the Host
 *   pays now, what they'll pay, the change and the 15% Mingla fee inside a
 *   raise. Only the suggestion id is ever sent; nothing here is an amount
 *   the server takes.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space } from "../../constants/designSystem";
import { getHostAdCampaign, type HostAdSuggestion } from "../../services/hostAdCampaignService";
import { platformNames } from "../marketing/ads/hostAdCopy";
import { hostAdGoalName } from "../marketing/ads/hostAdBuilderCopy";
import { formatHostAdMoneyCents } from "../marketing/ads/hostAdMoney";
import { hm } from "../marketing/ads/hostAdManageCopy";
import { hostAdSuggestionMoneyRows } from "../marketing/ads/hostAdManageModel";

function Row(props: { label: string; value: string; testID?: string }): React.ReactElement {
  return (
    <View style={s.row}>
      <Text style={s.label}>{props.label}</Text>
      <Text style={s.value} testID={props.testID}>{props.value}</Text>
    </View>
  );
}

/** The propose_ad_plan lines, from the tool's own arguments. */
export function AriAdPlanExtras(props: { args: Record<string, unknown> }): React.ReactElement | null {
  const goal = props.args.optimize_for;
  const fallback = Array.isArray(props.args.acknowledged_visits_fallback)
    ? props.args.acknowledged_visits_fallback.map(String).filter(Boolean)
    : [];
  const media = Array.isArray(props.args.creative_library_ids) ? props.args.creative_library_ids.length : 0;
  if (goal !== "sales" && goal !== "signups" && goal !== "visits" && fallback.length === 0 && media === 0) {
    return null;
  }
  return (
    <View style={s.wrap} testID="ari-ad-plan-extras">
      {goal === "sales" || goal === "signups" || goal === "visits" ? (
        <Row label={hm("ari.goal")} value={hostAdGoalName(goal)} testID="ari-ad-plan-goal" />
      ) : null}
      {fallback.length > 0 ? (
        <Row label={hm("ari.fallback")} value={platformNames(fallback)} testID="ari-ad-plan-fallback" />
      ) : null}
      {media > 0 ? <Row label={hm("ari.media")} value={hm("ari.mediaCount", { count: media })} testID="ari-ad-plan-media" /> : null}
    </View>
  );
}

/** The apply_ad_suggestion money, read from the ad's report. */
export function AriAdSuggestionMoney(props: { args: Record<string, unknown> }): React.ReactElement | null {
  const brandId = typeof props.args.brand_id === "string" ? props.args.brand_id : null;
  const campaignId = typeof props.args.campaign_id === "string" ? props.args.campaign_id : null;
  const suggestionId = typeof props.args.suggestion_id === "string" ? props.args.suggestion_id : null;
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; suggestion: HostAdSuggestion; currency: string } | { kind: "stale" } | { kind: "error" }
  >({ kind: "loading" });
  useEffect(() => {
    if (!brandId || !campaignId || !suggestionId) {
      setState({ kind: "error" });
      return undefined;
    }
    let live = true;
    getHostAdCampaign(brandId, campaignId)
      .then((report) => {
        if (!live) return;
        const suggestion = report.suggestion ?? null;
        const currency = report.plan_currency ?? suggestion?.money?.currency ?? null;
        if (!suggestion || suggestion.suggestion_id !== suggestionId || !currency) setState({ kind: "stale" });
        else setState({ kind: "ready", suggestion, currency });
      })
      .catch(() => {
        if (live) setState({ kind: "error" });
      });
    return () => {
      live = false;
    };
  }, [brandId, campaignId, suggestionId]);
  if (state.kind === "loading") {
    return <Text style={s.label} testID="ari-ad-suggestion-loading">{hm("withdraw.checking")}</Text>;
  }
  if (state.kind === "stale") return <Text style={s.note} testID="ari-ad-suggestion-stale">{hm("ari.stale")}</Text>;
  if (state.kind === "error") return <Text style={s.note} testID="ari-ad-suggestion-error">{hm("detail.actionFailed")}</Text>;
  const money = (cents: number): string => formatHostAdMoneyCents(cents, state.currency) ?? "";
  const rows = hostAdSuggestionMoneyRows(state.suggestion.money ?? null);
  const signed = (cents: number): string =>
    cents > 0 ? `+${money(cents)}` : cents < 0 ? `−${money(-cents)}` : money(0);
  return (
    <View style={s.wrap} testID="ari-ad-suggestion-money">
      {rows ? (
        <>
          <Row label={hm("ari.paysNow")} value={money(rows.nowPay)} testID="ari-ad-suggestion-now" />
          <Row label={hm("ari.paysAfter")} value={money(rows.afterPay)} testID="ari-ad-suggestion-after" />
          <Row label={hm("ari.change")} value={signed(rows.changePay)} testID="ari-ad-suggestion-change" />
          {rows.direction === "raise" ? (
            <Text style={s.note} testID="ari-ad-suggestion-fee">{hm("ari.feeLine", { fee: money(rows.feePay) })}</Text>
          ) : rows.direction === "lower" ? (
            <Text style={s.note}>{hm("ari.backLine", { amount: money(-rows.changePay) })}</Text>
          ) : null}
        </>
      ) : null}
      {state.suggestion.ends_at ? (
        <Text style={s.note}>
          {hm("ari.endsLine", { date: new Date(state.suggestion.ends_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) })}
        </Text>
      ) : null}
    </View>
  );
}

export default function AriAdCardExtras(props: {
  toolName: string;
  args: Record<string, unknown>;
}): React.ReactElement | null {
  if (props.toolName === "apply_ad_suggestion") return <AriAdSuggestionMoney args={props.args} />;
  if (props.toolName === "propose_ad_plan") return <AriAdPlanExtras args={props.args} />;
  return null;
}

const s = StyleSheet.create({
  wrap: { gap: space[2], paddingVertical: space[2] },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space[3] },
  label: { fontSize: 11, color: color.text2 },
  value: { fontSize: 13, color: color.text1, fontWeight: "600", textAlign: "right", flexShrink: 1 },
  note: { fontSize: 12, color: color.text2 },
});
