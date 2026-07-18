/**
 * ISSUE-864 WP4 — Step: Review & create (SPEC §2.7 + A4.e, blueprint §1.8).
 * The launch-confirmation summary — per-channel rows, blocked channels WITH
 * the reason inline, destination + creative + copy check lines, amber
 * warnings — and "Create campaign (paused)".
 *
 * SC-10 / I-PROPOSED-864-CREATE-PAUSED: NO path here (or anywhere in the
 * builder) sets a campaign ACTIVE — Launch is a separate, explicit action on
 * the campaign surface (#/campaigns), never in the builder.
 */

import { CheckCircle2, ExternalLink, Megaphone, ShieldCheck } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";

export function StepReview({
  summary,
  name,
  onNameChange,
  submitting,
  validatingShapes,
  createResults,
  onCreate,
  onValidateShapes,
  onJumpToStep,
}) {
  const anySuccess = Object.values(createResults ?? {}).some((r) => r?.campaign);
  const hardBlocked = summary.channels.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{summary.headline}</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Everything is created <span className="font-semibold">paused</span>. Launch is a
          separate, explicit step on the campaign page — nothing spends from here.
        </p>
      </div>

      <Input
        label="Campaign name"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Lorne — Tuesdays — 2026-07-16"
      />

      {/* Per-channel rows (§1.8 confirmation shape). */}
      <div className="rounded-xl border border-[var(--gray-200)] divide-y divide-[var(--gray-100)]">
        {summary.channels.map((line) => (
          <div key={line.platform} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
            <span className="font-medium w-20">{line.label}</span>
            <span className="font-mono text-xs">{line.dailyLabel}</span>
            <span className="text-xs text-[var(--color-text-secondary)]">{line.statusLine}</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">{line.goalLabel}</span>
          </div>
        ))}
        {summary.blocked.map((line) => (
          <div key={line.platform} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm opacity-70">
            <span className="font-medium w-20">{line.label}</span>
            <span className="text-xs">—</span>
            <span className="text-xs text-[var(--color-text-secondary)]">{line.reason}</span>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--gray-200)] px-3 py-2.5 text-xs space-y-1.5">
        <p><span className="font-semibold">Destination</span> — {summary.destinationLine}</p>
        <p><span className="font-semibold">Creative</span> — {summary.creativeLine}</p>
        <p><span className="font-semibold">Copy</span> — {summary.copyLine}</p>
      </div>

      {summary.warnings.map((warning) => (
        <AlertCard key={warning} variant="warning" title="Heads-up">
          {warning}
        </AlertCard>
      ))}

      {/* Per-channel create outcomes. */}
      {createResults && Object.entries(createResults).map(([platform, result]) => {
        if (!result) return null;
        if (result.campaign) {
          return (
            <AlertCard key={platform} variant="success" title={`Created on ${PLATFORM_LABELS[platform]} — Paused.`}>
              Nothing is spending yet.{" "}
              <a
                className="underline inline-flex items-center gap-1"
                href={`#/campaigns?campaignId=${result.campaign.id}`}
              >
                Open the campaign to launch it <ExternalLink size={10} />
              </a>
            </AlertCard>
          );
        }
        if (result.validated) {
          return (
            <AlertCard key={platform} variant="info" title={`${PLATFORM_LABELS[platform]}: shapes validated — nothing created.`}>
              Validated layers: {(result.validated_layers ?? []).join(", ") || "none"}
              {Array.isArray(result.skipped_layers) && result.skipped_layers.length > 0 && (
                <> (skipped: {result.skipped_layers.map((s) => s.layer).join(", ")})</>
              )}
            </AlertCard>
          );
        }
        if (result.error) {
          const isDestination = result.error.code === "destination_not_public";
          const isBudget = result.error.code === "budget_below_minimum";
          return (
            <AlertCard
              key={platform}
              variant="error"
              title={`${PLATFORM_LABELS[platform]} create failed${result.error.code ? ` — ${result.error.code}` : ""}`}
              action={
                isDestination ? (
                  <Button size="sm" variant="secondary" onClick={() => onJumpToStep("destination")}>
                    Pick another page
                  </Button>
                ) : isBudget ? (
                  <Button size="sm" variant="secondary" onClick={() => onJumpToStep("budget")}>
                    Fix the budget
                  </Button>
                ) : null
              }
            >
              {result.error.message}
              {result.error.trace && <div className="text-xs mt-1">fbtrace_id: {result.error.trace}</div>}
            </AlertCard>
          );
        }
        return null;
      })}

      {anySuccess && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-success-700)]">
          <CheckCircle2 size={16} />
          Created — paused. Launch and review live on the{" "}
          <a className="underline" href="#/campaigns">Campaigns page</a>.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={ShieldCheck}
          loading={validatingShapes}
          disabled={hardBlocked || submitting || anySuccess}
          onClick={onValidateShapes}
        >
          Validate shapes (nothing created)
        </Button>
        <Button
          icon={Megaphone}
          loading={submitting}
          disabled={hardBlocked || anySuccess}
          onClick={onCreate}
        >
          Create campaign (paused)
        </Button>
        {hardBlocked && (
          <Badge variant="error">No channel can run an ad right now. Fix at least one blocker to continue.</Badge>
        )}
      </div>
    </div>
  );
}
