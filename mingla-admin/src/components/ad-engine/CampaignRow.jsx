/**
 * Issue #3697 — one campaign on the Campaigns page, in plain words.
 *
 * One status chip, start → end in the campaign's own schedule zone (labelled),
 * spend against the provider hard cap from the spend-sync rows, the daily
 * budget, the 98% auto-pause point and the last sync. Row actions: Pause or
 * Launch, Change budget and Open in <provider>; End plan and Sync live in the
 * overflow menu so they cannot be hit by accident. Every target is 44px.
 *
 * The page owns every action and its safety gates (LAUNCH / END PLAN typed
 * phrases and reasons); this component only renders and calls back.
 */

import {
  ExternalLink,
  MoreHorizontal,
  Pause,
  RefreshCw,
  Rocket,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dropdown, DropdownItem } from "../ui/Dropdown";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";
import {
  campaignAutoPauseLabel,
  campaignMoneyFacts,
  campaignScheduleInZone,
  campaignStatusChip,
  providerManagerLabel,
  providerManagerUrl,
  relativeTimeLabel,
} from "../../lib/adCampaignRow";

const TOUCH = "min-h-11";

export function CampaignRow({
  campaign,
  selected = false,
  warning = null,
  busy = null,
  canLaunch = false,
  launchBlocked = false,
  canPause = false,
  canEnd = false,
  canChangeBudget = false,
  changeBudgetUnavailableReason = null,
  onOpen,
  onLaunch,
  onPause,
  onChangeBudget,
  onEnd,
  onSync,
  now = new Date(),
}) {
  const platformLabel = PLATFORM_LABELS[campaign.platform] ?? campaign.platform;
  const chip = campaignStatusChip(campaign, now);
  const autoPauseLabel = campaignAutoPauseLabel(campaign);
  const schedule = campaignScheduleInZone({
    startsAt: campaign.starts_at,
    endsAt: campaign.ends_at,
    timeZone: campaign.plan_version?.schedule_time_zone ?? null,
    now,
  });
  const money = campaignMoneyFacts(campaign);
  const managerUrl = providerManagerUrl(campaign);
  const synced = relativeTimeLabel(money.lastSyncedAt, now);
  const ownerLine =
    campaign.owner_kind === "mingla"
      ? `${platformLabel} · Mingla house account`
      : `${platformLabel} · ${campaign.owner_label ?? "Host brand"}`;

  return (
    <div
      className={[
        "rounded-xl border p-4 space-y-3",
        selected
          ? "border-[var(--color-brand-500)] ring-1 ring-[var(--color-brand-500)]"
          : "border-[var(--gray-200)]",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={chip.variant} dot>
              {chip.label}
            </Badge>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {ownerLine}
            </span>
          </div>
          <button
            type="button"
            className={`${TOUCH} block max-w-full truncate text-left text-base font-semibold hover:underline`}
            onClick={onOpen}
          >
            {campaign.name}
          </button>
          <div className="text-xs text-[var(--color-text-secondary)]">
            {campaign.owner_label} · {campaign.objective} ·{" "}
            <a
              className="inline-flex items-center gap-1 underline"
              href={campaign.dest_url}
              target="_blank"
              rel="noreferrer"
            >
              destination <ExternalLink size={10} aria-hidden="true" />
            </a>
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            {schedule.range ?? "No schedule recorded"}{" "}
            <span className="font-medium text-[var(--color-text-primary)]">
              {schedule.zoneLabel}
            </span>
            {schedule.daysLeftLabel && <> · {schedule.daysLeftLabel}</>}
          </div>
          {autoPauseLabel && (
            <div className="text-xs font-medium text-[var(--color-warning-700)]">
              {autoPauseLabel}
            </div>
          )}
          {warning && (
            <div className="text-xs text-[var(--color-warning-700)]">
              {warning}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canLaunch && (
            <Button
              size="sm"
              icon={Rocket}
              className={TOUCH}
              loading={busy === "launch"}
              onClick={onLaunch}
            >
              Launch
            </Button>
          )}
          {launchBlocked && (
            <Badge variant="error">Provider money unresolved</Badge>
          )}
          {canPause && (
            <Button
              size="sm"
              variant="secondary"
              icon={Pause}
              className={TOUCH}
              loading={busy === "pause"}
              onClick={onPause}
            >
              Pause
            </Button>
          )}
          {canChangeBudget ? (
            <Button
              size="sm"
              variant="secondary"
              icon={SlidersHorizontal}
              className={TOUCH}
              loading={busy === "change_budget"}
              onClick={onChangeBudget}
            >
              Change budget
            </Button>
          ) : (
            changeBudgetUnavailableReason && (
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {changeBudgetUnavailableReason}
              </span>
            )
          )}
          {managerUrl && (
            <a
              href={managerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${TOUCH} inline-flex items-center gap-1.5 rounded-lg border border-[var(--gray-300)] px-3 text-xs font-semibold hover:bg-[var(--gray-50)]`}
            >
              {providerManagerLabel(platformLabel)}{" "}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
          <Dropdown
            ariaLabel={`More actions for ${campaign.name}`}
            trigger={
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--gray-300)] hover:bg-[var(--gray-50)]">
                <MoreHorizontal size={16} aria-hidden="true" />
              </span>
            }
          >
            {(close) => (
              <>
                <DropdownItem onClick={onSync} onClose={close}>
                  <RefreshCw size={14} className="mr-2" aria-hidden="true" />
                  {busy === "sync" ? "Syncing…" : "Sync"}
                </DropdownItem>
                {canEnd && (
                  <DropdownItem destructive onClick={onEnd} onClose={close}>
                    <XCircle size={14} className="mr-2" aria-hidden="true" />
                    End plan
                  </DropdownItem>
                )}
              </>
            )}
          </Dropdown>
        </div>
      </div>

      <div className="grid gap-3 text-xs md:grid-cols-3">
        <div className="space-y-1" aria-label="Spend vs cap">
          <div className="text-[var(--color-text-tertiary)] uppercase">
            Spend vs cap
          </div>
          <div className="font-semibold text-sm">
            {money.spendLabel} of {money.capLabel}
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-[var(--gray-100)]"
            role="progressbar"
            aria-label="Spend against the hard cap"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              money.barRatio === null ? undefined : Math.round(money.barRatio * 100)
            }
          >
            {money.barRatio !== null && (
              <div
                className={[
                  "h-full rounded-full",
                  money.atPauseThreshold
                    ? "bg-[var(--color-warning-600)]"
                    : "bg-[var(--color-brand-500)]",
                ].join(" ")}
                style={{ width: `${Math.round(money.barRatio * 100)}%` }}
              />
            )}
          </div>
          <div className="text-[var(--color-text-secondary)]">
            {money.pauseAtCents === null
              ? "Auto-pause point unknown — no hard cap recorded"
              : `Auto-pauses at ${money.pauseAtLabel} (98%)`}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[var(--color-text-tertiary)] uppercase">
            {money.cadence === "lifetime" ? "Delivery budget" : "Daily budget"}
          </div>
          <div className="font-semibold text-sm">
            {money.dailyLabel}
            {money.cadence === "daily" && money.dailyCents !== null && " / day"}
          </div>
          {money.busyDayLabel && (
            <div className="text-[var(--color-text-secondary)]">
              {platformLabel} may spend up to {money.busyDayLabel} on a busy day
            </div>
          )}
        </div>
        <div className="space-y-1">
          <div className="text-[var(--color-text-tertiary)] uppercase">
            Last synced with {platformLabel}
          </div>
          <div className="font-semibold text-sm">{synced ?? "—"}</div>
        </div>
      </div>
    </div>
  );
}
