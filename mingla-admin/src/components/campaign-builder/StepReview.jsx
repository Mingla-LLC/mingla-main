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

import {
  CheckCircle2,
  ExternalLink,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";
import {
  CREATE_PAUSED_PHRASE,
  createBlockReason,
} from "../../lib/adBuilder/housePlanPath";

const STEP_STATE_LABELS = {
  pending: "Waiting",
  running: "In progress",
  done: "Done",
  failed: "Failed",
};
const STEP_STATE_VARIANTS = {
  pending: "default",
  running: "warning",
  done: "success",
  failed: "error",
};

function estimateLabel(estimate) {
  if (
    estimate?.state === "available" &&
    Number.isFinite(estimate.lower_bound) &&
    Number.isFinite(estimate.upper_bound)
  ) {
    return `${estimate.lower_bound.toLocaleString()}–${estimate.upper_bound.toLocaleString()} potential reach`;
  }
  return String(estimate?.state ?? "unavailable").replaceAll("_", " ");
}

export function StepReview({
  summary,
  name,
  onNameChange,
  submitting,
  validatingShapes,
  createResults,
  allExpectedPairsSucceeded,
  onCreate,
  onValidateShapes,
  onJumpToStep,
  currencyBlockedReason = null,
  planPreview = null,
  broaderAccepted = false,
  onBroaderAcceptedChange,
  confirmationPhrase = "",
  onConfirmationPhraseChange,
  certificationMode = false,
  certificationState = null,
  certificationApprovalReference = "",
  onCertificationApprovalReferenceChange,
  certificationApprovalPhrase = "",
  onCertificationApprovalPhraseChange,
  certificationApprovalBusy = false,
  onApproveCertification,
  createSteps = null,
  createError = null,
}) {
  const anySuccess = Object.values(createResults ?? {}).some(
    (r) => r?.campaign,
  );
  const planBlocked =
    planPreview?.status === "blocked" ||
    (planPreview?.status === "broader" && !broaderAccepted);
  // #3697: the phrase is required for every real create and its field is
  // visible before the first click. Validate (nothing created) never needs it.
  const hardBlocked =
    summary.channels.length === 0 ||
    Boolean(currencyBlockedReason) ||
    planBlocked;
  const createBlocked = createBlockReason({
    channelCount: summary.channels.length,
    currencyBlockedReason,
    planBlocked,
    phrase: confirmationPhrase,
  });
  const videoPreparedAtCreate = summary.channels.some(
    (line) => line.videoReadiness === "Video not ready",
  );
  const certificationAwaitingApproval =
    certificationMode && certificationState?.status === "approval_required";
  const approvalInputValid =
    certificationAwaitingApproval &&
    certificationApprovalReference.trim().length >= 8 &&
    certificationApprovalPhrase === certificationState.required_phrase;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{summary.headline}</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Everything is created <span className="font-semibold">paused</span>.
          {certificationMode
            ? " This certification plan binds one app, OS, provider, currency and hard cap. Owner approval is required before even the paused provider object exists."
            : " Launch is a separate, explicit step on the campaign page — nothing spends from here."}
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
          <div
            key={line.platform}
            className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm"
          >
            <span className="font-medium w-20">{line.label}</span>
            <span className="font-mono text-xs">{line.dailyLabel}</span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {line.statusLine}
            </span>
            <span
              className="text-xs text-[var(--color-text-tertiary)] font-mono"
              title="The resolved objective this platform's create payload will actually send."
            >
              {line.objectiveLabel}
            </span>
            {line.videoReadiness && (
              <span className="text-xs text-[var(--color-text-secondary)]">
                {line.videoReadiness}
              </span>
            )}
          </div>
        ))}
        {summary.blocked.map((line) => (
          <div
            key={line.platform}
            className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm opacity-70"
          >
            <span className="font-medium w-20">{line.label}</span>
            <span className="text-xs">—</span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {line.reason}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--gray-200)] px-3 py-2.5 text-xs space-y-1.5">
        <p>
          <span className="font-semibold">Destination</span> —{" "}
          {summary.destinationLine}
        </p>
        <p>
          <span className="font-semibold">Creative</span> —{" "}
          {summary.creativeLine}
        </p>
        <p>
          <span className="font-semibold">Copy</span> — {summary.copyLine}
        </p>
        {summary.budgetLine && (
          <p>
            <span className="font-semibold">Budget</span> — {summary.budgetLine}
          </p>
        )}
        {summary.hardCapLine && (
          <p>
            <span className="font-semibold">Hard cap</span> —{" "}
            {summary.hardCapLine}
          </p>
        )}
        {summary.scheduleLine && (
          <p>
            <span className="font-semibold">Schedule</span> —{" "}
            {summary.scheduleLine}
          </p>
        )}
      </div>

      {summary.warnings.map((warning) => (
        <AlertCard key={warning} variant="warning" title="Heads-up">
          {warning}
        </AlertCard>
      ))}

      {currencyBlockedReason && (
        <AlertCard variant="error" title="Currency setup is incomplete">
          {currencyBlockedReason}
        </AlertCard>
      )}

      {planPreview && (
        <div className="rounded-xl border border-[var(--gray-200)] p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Immutable plan</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Every provider object must match this exact version and hash.
              </p>
            </div>
            <code className="text-[10px] break-all text-[var(--color-text-tertiary)]">
              {planPreview.plan_hash}
            </code>
          </div>
          <div className="space-y-2">
            {planPreview.measurement && (
              <div className="rounded-lg bg-[var(--gray-50)] px-3 py-2 text-xs space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Measurement</span>
                  <Badge
                    variant={
                      planPreview.measurement.quality === "trusted"
                        ? "success"
                        : "info"
                    }
                  >
                    {String(planPreview.measurement.quality).replaceAll("_", " ")}
                  </Badge>
                </div>
                <p>
                  Result order: {(planPreview.measurement.result_hierarchy ?? [])
                    .map((value) => String(value).replaceAll("_", " "))
                    .join(" → ")}
                </p>
                <p className="text-[var(--color-text-secondary)]">
                  Browser pixels and platform conversion sharing require
                  consent. Trusted Mingla results remain visible in aggregate
                  reporting when outbound sharing is withheld.
                </p>
              </div>
            )}
            {planPreview.media_rights && (
              <div className="rounded-lg bg-[var(--gray-50)] px-3 py-2 text-xs space-y-1">
                <p className="font-semibold">Media rights attested</p>
                <p>
                  {String(planPreview.media_rights.rights_basis).replaceAll(
                    "_",
                    " ",
                  )} · {planPreview.media_rights.ai_generated
                    ? "AI-generated"
                    : "not marked AI-generated"}
                </p>
                <p className="text-[var(--color-text-secondary)]">
                  Paid-ad use only; Mingla house reuse is not authorized.
                </p>
              </div>
            )}
            {(planPreview.targeting_snapshots ?? []).length > 0 && (
              <AlertCard variant="warning" title="Provider estimates overlap">
                Read each platform separately. Do not add these estimates into
                a cross-platform total because the same person may appear on
                more than one platform.
              </AlertCard>
            )}
            {(planPreview.targeting_snapshots ?? []).map((row) => (
              <div
                key={row.platform}
                className="rounded-lg bg-[var(--gray-50)] px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    {PLATFORM_LABELS[row.platform] ?? row.platform}
                  </span>
                  <Badge
                    variant={
                      row.verdict === "exact"
                        ? "success"
                        : row.verdict === "broader"
                          ? "warning"
                          : "error"
                    }
                  >
                    {row.verdict === "exact"
                      ? "Exact"
                      : row.verdict === "broader"
                        ? "Broader"
                        : "Action required"}
                  </Badge>
                </div>
                {[
                  ...(row.widening_summary ?? []),
                  ...(row.checks_required ?? []),
                ].map((message) => (
                  <p
                    key={message}
                    className="mt-1 text-[var(--color-text-secondary)]"
                  >
                    {message}
                  </p>
                ))}
                {row.provider_estimate && (
                  <div className="mt-2 border-t border-[var(--gray-200)] pt-2 space-y-1">
                    <p className="font-semibold">
                      Provider estimate · {estimateLabel(row.provider_estimate)}
                    </p>
                    <p className="text-[var(--color-text-secondary)]">
                      Observed {row.estimate_observed_at
                        ? new Date(row.estimate_observed_at).toLocaleString()
                        : "time unavailable"} · {row.provider_estimate.source}
                    </p>
                    {row.provider_estimate.state !== "available" && (
                      <p className="text-[var(--color-text-secondary)]">
                        {String(row.provider_estimate.detail).replaceAll("_", " ")}
                      </p>
                    )}
                    {(row.provider_estimate.assumptions ?? []).map((assumption) => (
                      <p
                        key={assumption}
                        className="text-[var(--color-text-secondary)]"
                      >
                        {assumption}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {planPreview.status === "broader" && (
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={broaderAccepted}
                onChange={(event) =>
                  onBroaderAcceptedChange?.(event.target.checked)
                }
              />
              <span>
                I accept the named provider widenings. Mingla will create a new
                immutable version recording this acceptance before any provider
                object is created.
              </span>
            </label>
          )}
          {planPreview.status === "blocked" && (
            <AlertCard variant="error" title="Resolve targeting first">
              This version cannot be funded or sent to a provider. Return to
              Audience and resolve every provider check; nothing has been
              created and no money has moved.
            </AlertCard>
          )}
        </div>
      )}

      {videoPreparedAtCreate && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          “Video not ready” means the provider copy does not exist yet. Create
          prepares it on each platform after the plan is funded and confirmed —
          you do not need to do anything first.
        </p>
      )}

      {!planBlocked && (
        <Input
          label={`Type “${CREATE_PAUSED_PHRASE}” to bind this exact plan`}
          value={confirmationPhrase}
          onChange={(event) =>
            onConfirmationPhraseChange?.(event.target.value)
          }
          placeholder={CREATE_PAUSED_PHRASE}
          helper="Create binds the plan, holds the cap on Mingla's own ad account (no charge now), prepares the video, and creates everything paused. Launch stays a separate step on the Campaigns page."
        />
      )}

      {createSteps && createSteps.length > 0 && (
        <ol
          aria-label="Create progress"
          className="rounded-xl border border-[var(--gray-200)] divide-y divide-[var(--gray-100)]"
        >
          {createSteps.map((step, index) => (
            <li
              key={step.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
            >
              <span>
                {index + 1}. {step.label}
                {step.detail && (
                  <span className="block text-[var(--color-text-tertiary)] break-all">
                    {step.detail}
                  </span>
                )}
              </span>
              <Badge variant={STEP_STATE_VARIANTS[step.state] ?? "default"}>
                {STEP_STATE_LABELS[step.state] ?? step.state}
              </Badge>
            </li>
          ))}
        </ol>
      )}

      {createError && (
        <AlertCard variant="error" title={createError.title}>
          <p>{createError.message}</p>
          <p className="mt-1">
            Nothing launched and no spend began. Fix the cause, then press
            Create again — it resumes this same plan. You can also resume it
            from Ads → Campaigns → Mingla plans that need recovery.
          </p>
        </AlertCard>
      )}

      {certificationMode && certificationState && (
        <div className="rounded-xl border-2 border-[var(--color-brand-500)] bg-[var(--color-brand-50)] p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold">Provider certification gate</p>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {String(certificationState.provider).toUpperCase()} ·{" "}
                {String(certificationState.app_key).toUpperCase()} ·{" "}
                {String(certificationState.os).toUpperCase()}
              </p>
            </div>
            <Badge
              variant={
                certificationState.status === "approved_to_prepare" ||
                certificationState.status === "paused_ready" ||
                certificationState.status === "passed"
                  ? "success"
                  : certificationState.status === "failed"
                    ? "error"
                    : "warning"
              }
            >
              {String(certificationState.status).replaceAll("_", " ")}
            </Badge>
          </div>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <p>
              <span className="font-semibold">Hard ceiling:</span>{" "}
              {certificationState.approved_currency}{" "}
              {Number(
                certificationState.approved_spend_ceiling_cents ?? 0,
              ).toLocaleString()}{" "}
              minor units
            </p>
            <p>
              <span className="font-semibold">Plan hash:</span>{" "}
              <code className="break-all">{certificationState.plan_hash}</code>
            </p>
          </div>
          {certificationAwaitingApproval && (
            <div className="grid gap-3 border-t border-[var(--color-brand-200)] pt-3">
              <AlertCard
                variant="warning"
                title="Owner approval is financial authority"
              >
                Confirm only the named provider, app, OS, currency and ceiling.
                Approval expires after 24 hours and does not launch the
                campaign.
              </AlertCard>
              <Input
                label="Approval record reference"
                value={certificationApprovalReference}
                onChange={(event) =>
                  onCertificationApprovalReferenceChange?.(event.target.value)
                }
                placeholder="#3697 comment or approval record"
              />
              <Input
                label={`Type “${certificationState.required_phrase}”`}
                value={certificationApprovalPhrase}
                onChange={(event) =>
                  onCertificationApprovalPhraseChange?.(event.target.value)
                }
                placeholder={certificationState.required_phrase}
              />
              <Button
                type="button"
                loading={certificationApprovalBusy}
                disabled={!approvalInputValid}
                onClick={onApproveCertification}
              >
                Approve this exact certification scope
              </Button>
            </div>
          )}
          {certificationState.status === "approved_to_prepare" && (
            <p className="text-xs font-medium text-[var(--color-success-700)]">
              Approved to create paused provider objects only. Activation
              remains a separate typed action in App-download readiness.
            </p>
          )}
        </div>
      )}

      {/* Per-channel create outcomes. ISSUE-1002 [multi-destination fan-out]:
          createResults is keyed per (platform × destination) — the entry key is a
          composite string, so the platform label comes from `result.platform` and
          the destination title is appended on a multi-destination fan-out (a
          single-destination build shows no suffix, byte-identical to before). */}
      {createResults &&
        Object.entries(createResults).map(([key, result]) => {
          if (!result) return null;
          const platform = result.platform ?? key;
          const label = PLATFORM_LABELS[platform] ?? platform;
          const destSuffix =
            result.multiDest && result.destTitle
              ? ` → ${result.destTitle}`
              : "";
          if (result.campaign) {
            return (
              <AlertCard
                key={key}
                variant="success"
                title={`Created on ${label}${destSuffix} — Paused.`}
              >
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
              <AlertCard
                key={key}
                variant="info"
                title={`${label}${destSuffix}: shapes validated — nothing created.`}
              >
                Validated layers:{" "}
                {(result.validated_layers ?? []).join(", ") || "none"}
                {Array.isArray(result.skipped_layers) &&
                  result.skipped_layers.length > 0 && (
                    <>
                      {" "}
                      (skipped:{" "}
                      {result.skipped_layers.map((s) => s.layer).join(", ")})
                    </>
                  )}
              </AlertCard>
            );
          }
          if (result.noPlatformValidate) {
            // ISSUE-979 Bug 2: the honest state for a validate-only call to a
            // platform with no dry-run (TikTok/Snap/Reddit) — nothing was created
            // or validated. Surfaced instead of a false "Created" toast.
            return (
              <AlertCard
                key={key}
                variant="info"
                title={`${label}${destSuffix}: nothing created or validated.`}
              >
                This platform has no dry-run, so the real create is its first
                check. Use “Create campaign (paused)” to build it.
                {Array.isArray(result.skipped_layers) &&
                  result.skipped_layers.length > 0 && (
                    <>
                      {" "}
                      (skipped:{" "}
                      {result.skipped_layers
                        .map((s) => s.layer ?? s)
                        .join(", ")}
                      )
                    </>
                  )}
              </AlertCard>
            );
          }
          if (result.error) {
            const isDestination =
              result.error.code === "destination_not_public";
            const isBudget = result.error.code === "budget_below_minimum";
            return (
              <AlertCard
                key={key}
                variant="error"
                title={`${label}${destSuffix} create failed${result.error.code ? ` — ${result.error.code}` : ""}`}
                action={
                  isDestination ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onJumpToStep("destination")}
                    >
                      Pick another page
                    </Button>
                  ) : isBudget ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onJumpToStep("budget")}
                    >
                      Fix the budget
                    </Button>
                  ) : null
                }
              >
                {result.error.message}
                {result.error.trace && (
                  <div className="text-xs mt-1">
                    fbtrace_id: {result.error.trace}
                  </div>
                )}
              </AlertCard>
            );
          }
          return null;
        })}

      {anySuccess && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-success-700)]">
          <CheckCircle2 size={16} />
          Created — paused. Launch and review live on the{" "}
          <a className="underline" href="#/campaigns">
            Campaigns page
          </a>
          .
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <p className="basis-full text-xs text-[var(--color-text-secondary)]">
          Preparation and previews created no ads. This action creates paused
          campaigns; nothing spends until Launch on the Campaigns page.
        </p>
        {!certificationMode && (
          <Button
            variant="secondary"
            icon={ShieldCheck}
            loading={validatingShapes}
            disabled={hardBlocked || submitting || allExpectedPairsSucceeded}
            onClick={onValidateShapes}
          >
            Validate shapes (nothing created)
          </Button>
        )}
        <Button
          icon={Megaphone}
          loading={submitting}
          // #3697: a missing phrase does NOT disable Create — pressing it
          // names the missing phrase inline before anything is bound.
          disabled={
            hardBlocked ||
            allExpectedPairsSucceeded ||
            certificationAwaitingApproval
          }
          onClick={onCreate}
        >
          {certificationMode &&
          certificationState?.status === "approved_to_prepare"
            ? "Create approved canary (paused)"
            : certificationMode && !certificationState
              ? "Request exact certification approval"
              : !planPreview
                ? "Create campaign (paused)"
                : planPreview.status === "broader"
                  ? "Bind accepted plan and create paused"
                  : (summary.primaryActionLabel ?? "Create campaign (paused)")}
        </Button>
        {createBlocked && !allExpectedPairsSucceeded && (
          <Badge variant={hardBlocked ? "error" : "warning"}>
            {createBlocked}
          </Badge>
        )}
      </div>
    </div>
  );
}
