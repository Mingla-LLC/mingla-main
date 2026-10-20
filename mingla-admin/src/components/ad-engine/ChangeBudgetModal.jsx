/**
 * Issue #3697 — Change budget for a live Mingla plan.
 *
 * New daily budget and/or new hard cap (plan totals, provider-account
 * currency), the end date shown unchanged, a required reason, and a "what
 * happens when you save" summary computed from the real values. Save calls
 * the governed admin-ad-campaign-action `change_budget`; the server refuses a
 * cap below spend-to-date and records an append-only amendment.
 */

import { useState } from "react";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input, Textarea } from "../ui/Input";
import { AlertCard } from "../ui/Card";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";
import { budgetChangeSummary } from "../../lib/adBudgetChangeSummary";
import { campaignScheduleInZone } from "../../lib/adCampaignRow";
import { formatCampaignMoney } from "../../lib/adSpendCap";

export function ChangeBudgetModal({
  open,
  campaign,
  planCampaigns = [],
  onClose,
  onSave,
  now = new Date(),
}) {
  const [dailyText, setDailyText] = useState("");
  const [capText, setCapText] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const close = () => {
    setDailyText("");
    setCapText("");
    setReason("");
    setSaving(false);
    setError(null);
    onClose?.();
  };

  if (!campaign) return null;
  const platformLabel = PLATFORM_LABELS[campaign.platform] ?? campaign.platform;
  const rows = planCampaigns.length > 0 ? planCampaigns : [campaign];
  const summary = budgetChangeSummary({
    planCampaigns: rows,
    platform: campaign.platform,
    dailyText,
    capText,
    reason,
    endsAt: campaign.ends_at,
    now,
  });
  const { current } = summary;
  const money = (cents) => formatCampaignMoney(current.currency, cents);
  const schedule = campaignScheduleInZone({
    startsAt: campaign.starts_at,
    endsAt: campaign.ends_at,
    timeZone: campaign.plan_version?.schedule_time_zone ?? null,
    now,
  });
  const endOnly = campaignScheduleInZone({
    endsAt: campaign.ends_at,
    timeZone: campaign.plan_version?.schedule_time_zone ?? null,
    now,
  });
  const currencyCode = current.currency ?? "—";

  const save = async () => {
    if (!summary.canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...(summary.newDailyCents !== null
          ? { daily_budget_cents: summary.newDailyCents }
          : {}),
        ...(summary.newCapCents !== null ? { cap_cents: summary.newCapCents } : {}),
        reason: reason.trim(),
      });
      close();
    } catch (err) {
      setError(err?.message || "The budget was not changed.");
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Change budget">
      <ModalBody className="space-y-4">
        <p className="text-sm text-[var(--color-text-secondary)]">
          {campaign.name} · {platformLabel}
          {schedule.range ? ` · ${schedule.range} ${schedule.zoneLabel}` : ""}
          {rows.length > 1 ? ` · ${rows.length} providers share this plan's budget` : ""}
        </p>
        <Input
          label={`Daily budget (${currencyCode})`}
          inputMode="decimal"
          value={dailyText}
          onChange={(event) => setDailyText(event.target.value)}
          placeholder={current.dailyCents === null ? "" : String(current.dailyCents / 100)}
          helper={`Now ${money(current.dailyCents)} / day`}
        />
        <Input
          label={`Hard cap (${currencyCode})`}
          inputMode="decimal"
          value={capText}
          onChange={(event) => setCapText(event.target.value)}
          placeholder={current.capCents === null ? "" : String(current.capCents / 100)}
          helper={`Now ${money(current.capCents)} · spent so far ${money(current.spendCents)}`}
        />
        <div>
          <p className="text-sm font-medium">End date ({schedule.zoneLabel})</p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {endOnly.range ? endOnly.range.replace(/^Ends /, "") : "—"} · unchanged
          </p>
        </div>

        {summary.errors.length > 0 && (dailyText || capText) && (
          <AlertCard variant="error" title="Can't save this budget">
            {summary.errors.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </AlertCard>
        )}

        {summary.lines.length > 0 && (
          <div
            className="rounded-lg bg-[var(--gray-50)] px-3 py-2 text-xs space-y-1"
            aria-label="What happens when you save"
          >
            <p className="font-semibold">What happens when you save</p>
            <ul className="space-y-1">
              {summary.lines.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
            <p className="text-[var(--color-text-secondary)]">
              A budget amendment is recorded on this plan; the original plan
              and every earlier amendment stay in the audit history.
            </p>
          </div>
        )}

        <Textarea
          label="Why? (saved in the audit log)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Clicks are cheap on day 1; pushing harder before the weekend."
        />
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Never edit the budget in {platformLabel} Ads Manager directly —
          Mingla&apos;s cap and spend tracking would stop matching.
        </p>
        {error && (
          <AlertCard variant="error" title="The budget was not changed">
            {error}
          </AlertCard>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" className="min-h-11" onClick={close} disabled={saving}>
          Cancel
        </Button>
        <Button
          className="min-h-11"
          loading={saving}
          disabled={!summary.canSave}
          onClick={save}
        >
          Save new budget
        </Button>
      </ModalFooter>
    </Modal>
  );
}
