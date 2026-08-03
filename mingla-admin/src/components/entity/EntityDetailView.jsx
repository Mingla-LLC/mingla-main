// ORCH-1271 [Admin authorization & audit FOUNDATION] — reusable entity detail
// view. Renders Breadcrumbs + SectionCard field blocks + a footer action row.
// Each action opens the shared HighRiskActionModal (typed-reason + confirm →
// audited primitive). In 1271 `actions` is exercised ONLY by the placeholder's
// self-test probe — no real business mutation is wired.
//
// action shape (HighRiskAction):
//   { label, title, description, confirmLabel, destructive?, requireReason?,
//     reasonLabel?, confirmPhrase?, buttonVariant?, onConfirm: async ({reason}) => void }

import { useState } from "react";
import { Breadcrumbs } from "../ui/Breadcrumbs";
import { SectionCard, AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { RotateCcw, ChevronLeft } from "lucide-react";
import { HighRiskActionModal } from "./HighRiskActionModal";

export function EntityDetailView({ header, sections = [], actions = [], loading, error, onRetry }) {
  const [openActionIdx, setOpenActionIdx] = useState(null);
  const activeAction = openActionIdx != null ? actions[openActionIdx] : null;

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-center py-16">
          <Spinner size="md" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <AlertCard
        variant="error"
        title="Couldn't load this record"
        action={
          onRetry ? (
            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      >
        {error}
      </AlertCard>
    );
  }

  const { title, subtitle, badges = [], backLabel, onBack } = header || {};

  return (
    <div className="flex flex-col gap-4">
      {/* Header + breadcrumb */}
      <div className="flex flex-col gap-2">
        {backLabel && onBack ? (
          <Breadcrumbs items={[{ label: backLabel, onClick: onBack }, { label: title }]} />
        ) : null}
        <div className="flex items-start gap-3 flex-wrap">
          {onBack && (
            <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={onBack} aria-label="Back" />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">{title}</h1>
            {subtitle && (
              <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {badges.map((b, i) => (
              <Badge key={`${b.label}-${i}`} variant={b.variant || "default"}>
                {b.label}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Section blocks */}
      {sections.map((section, si) => (
        <SectionCard key={section.label || si} title={section.label}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {section.fields.map((field, fi) => (
              <div key={field.key || `${field.label || "field"}-${fi}`} className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  {field.label}
                </dt>
                <dd className="text-sm text-[var(--color-text-primary)] break-words">
                  {field.render
                    ? field.render(field.value)
                    : field.value != null && field.value !== ""
                    ? field.value
                    : <span className="text-[var(--color-text-muted)]">&mdash;</span>}
                </dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      ))}

      {/* Footer action row */}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {actions.map((action, ai) => (
            <Button
              key={action.label || ai}
              variant={action.buttonVariant || (action.destructive ? "danger" : "secondary")}
              size="md"
              onClick={() => setOpenActionIdx(ai)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {/* Shared typed-reason + confirm modal for the active action */}
      {activeAction && (
        <HighRiskActionModal
          open={openActionIdx != null}
          onClose={() => setOpenActionIdx(null)}
          title={activeAction.title}
          description={activeAction.description}
          confirmLabel={activeAction.confirmLabel}
          destructive={activeAction.destructive}
          requireReason={activeAction.requireReason}
          reasonLabel={activeAction.reasonLabel}
          confirmPhrase={activeAction.confirmPhrase}
          onConfirm={activeAction.onConfirm}
        />
      )}
    </div>
  );
}
