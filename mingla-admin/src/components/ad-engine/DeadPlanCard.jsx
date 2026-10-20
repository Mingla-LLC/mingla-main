/**
 * Issue #3697 — a Mingla plan whose create didn't finish, with one action.
 *
 * Replaces three warnings and no button ("Provider attention required",
 * "Provider reconciliation hold", "Inspect the provider evidence") with: a
 * plain status, the provider object IDs Mingla recorded, why it stopped, the
 * money held, and "Check with <provider>". The server decides; this card
 * shows the answer: cleared (the page reloads and notes it), still there
 * (each object links to the provider, with an optional typed delete), or
 * couldn't check (nothing changed).
 */

import { ExternalLink, SearchCheck, Trash2 } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { deadPlanFacts, LEVEL_LABELS } from "../../lib/adBuilder/deadPlan";
import { providerObjectUrl } from "../../lib/adCampaignRow";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";

const TOUCH = "min-h-11";

export function DeadPlanCard({
  item,
  result = null,
  checking = false,
  onCheck,
  onDeleteThenClear,
}) {
  const facts = deadPlanFacts(item);
  const surviving =
    result?.verdict === "still_exists"
      ? (result.objects ?? []).filter((object) => object.verdict === "exists")
      : [];

  return (
    <div className="rounded-xl border border-[var(--gray-200)] p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{facts.name}</div>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            This attempt failed while saving
            {facts.failedAt ? ` on ${facts.failedAt}` : ""}.{" "}
            {facts.providerLabel} may still have{" "}
            {facts.objects.length === 1
              ? "one object"
              : `${facts.objects.length} objects`}{" "}
            from it. Check before anything else happens.
          </p>
        </div>
        <Badge variant="warning" dot>
          Didn&apos;t finish
        </Badge>
      </div>

      <dl className="grid gap-3 text-xs md:grid-cols-3">
        <div>
          <dt className="text-[var(--color-text-tertiary)] uppercase">
            What {facts.providerLabel} was asked to create
          </dt>
          <dd className="mt-1 space-y-0.5">
            {facts.objects.length > 0
              ? facts.objects.map((object) => (
                  <div key={`${object.platform}:${object.level}:${object.external_id}`}>
                    {LEVEL_LABELS[object.level] ?? object.level}{" "}
                    <span className="font-mono">{object.external_id}</span>{" "}
                    <span className="text-[var(--color-text-tertiary)]">
                      recorded
                    </span>
                  </div>
                ))
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-tertiary)] uppercase">
            Reason it stopped
          </dt>
          <dd className="mt-1">{facts.reason}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-tertiary)] uppercase">
            Money held
          </dt>
          <dd className="mt-1">{facts.holdLabel}</dd>
        </div>
      </dl>

      {result?.verdict === "unknown" && (
        <AlertCard
          variant="warning"
          title={`Couldn't confirm with ${facts.providerLabel}`}
        >
          Nothing was changed and the hold stays in place.{" "}
          {(result.objects ?? [])
            .filter((object) => object.verdict === "unknown")
            .map((object) => object.detail)
            .filter(Boolean)
            .join(" · ")}
        </AlertCard>
      )}

      {surviving.length > 0 && (
        <AlertCard
          variant="warning"
          title={`Still on ${facts.providerLabel}`}
        >
          <ul className="mt-1 space-y-1">
            {surviving.map((object) => {
              const url = providerObjectUrl({
                platform: object.platform,
                level: object.level,
                accountId: result.accounts?.[object.platform],
                externalId: object.external_id,
              });
              const provider = PLATFORM_LABELS[object.platform] ?? object.platform;
              return (
                <li
                  key={`${object.platform}:${object.level}:${object.external_id}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span>
                    {LEVEL_LABELS[object.level] ?? object.level}{" "}
                    <span className="font-mono">{object.external_id}</span>
                    {object.provider_status
                      ? ` · ${object.provider_status.toLowerCase()}`
                      : ""}
                  </span>
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${TOUCH} inline-flex items-center gap-1 underline`}
                    >
                      Open in {provider}{" "}
                      <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2">
            The hold stays until these are gone. Delete them on{" "}
            {facts.providerLabel} here, or remove them there and check again.
          </p>
        </AlertCard>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          icon={SearchCheck}
          className={TOUCH}
          loading={checking}
          onClick={onCheck}
        >
          {facts.checkLabel}
        </Button>
        {surviving.length > 0 && (
          <Button
            variant="danger"
            icon={Trash2}
            className={TOUCH}
            disabled={checking}
            onClick={onDeleteThenClear}
          >
            Delete on {facts.providerLabel}, then clear
          </Button>
        )}
      </div>
    </div>
  );
}
