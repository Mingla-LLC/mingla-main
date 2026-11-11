// #4382 Wave 3 — Send to Product: search the board first ("Link here, +1
// reporter"), or create a new item with four fields (type, title, what's
// wrong prefilled, product area). Replaces the 11-field private signal form.
// Any Support staff member may do this (D3). Nothing reaches GitHub here:
// public wording is written later, in Triage, by an admin or founding partner.
import { useMemo, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { SearchInput } from "../ui/SearchInput";
import { Segmented, TEXTAREA_CLASS } from "../crm/fields";
import { PRODUCT_AREAS } from "./supportOptions";
import { SIGNAL_TYPE_OPTIONS, STAGE_LABEL, searchOpenItems, signalTypeLabel } from "./productBoardModel";
import {
  createClientRequestId,
  createProductSignal,
  linkSourceToProductSignal,
} from "../../services/supportProductWorkflowService";

const CUSTOMER_LINE = "We've passed this to our product team. We'll tell you here when it's fixed.";

/**
 * source: { id, source_kind, subject, details, priority, product_area, label }
 * (label names the source, for example "S-1048").
 */
function SendToProductForm({ source, signals, onClose, onCreated, onLinked, onError }) {
  const [query, setQuery] = useState(source.subject || "");
  const [form, setForm] = useState(() => ({
    clientRequestId: createClientRequestId(),
    signalKind: "bug",
    title: source.subject || "",
    problemStatement: source.details || source.subject || "",
    productArea: source.product_area || "",
  }));
  const [saving, setSaving] = useState(false);
  const [linkingId, setLinkingId] = useState(null);

  const matches = useMemo(() => searchOpenItems(signals, query), [signals, query]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const valid = form && form.title.trim() && form.problemStatement.trim() && form.productArea.trim();
  const label = source?.label || "this report";

  async function create() {
    if (!source || !valid || saving) return;
    setSaving(true);
    try {
      const id = await createProductSignal({
        clientRequestId: form.clientRequestId,
        sourceKind: source.source_kind,
        sourceId: source.id,
        signalKind: form.signalKind,
        title: form.title.trim(),
        problemStatement: form.problemStatement.trim(),
        productArea: form.productArea.trim(),
        userJourney: `Reported through ${label}.`,
        impactSummary: "Reported to Support.",
        affectedPeople: 1,
        priority: source.priority || "normal",
        nextUpdateAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        nextStep: "Product triages this item.",
        customerReplyDraft: CUSTOMER_LINE,
      });
      await onCreated?.(id);
      onClose();
    } catch (error) {
      onError?.(error);
    } finally {
      setSaving(false);
    }
  }

  async function link(signal) {
    if (!source || linkingId) return;
    setLinkingId(signal.id);
    try {
      await linkSourceToProductSignal({
        signalId: signal.id,
        expectedRevision: signal.revision,
        sourceKind: source.source_kind,
        sourceId: source.id,
      });
      await onLinked?.(signal.id);
      onClose();
    } catch (error) {
      onError?.(error);
    } finally {
      setLinkingId(null);
    }
  }

  return (
    <>
      <ModalBody>
        {form && (
          <div className="space-y-5">
            <section className="space-y-2" aria-label="Search the Product board">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">Is this already on the board?</p>
              <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="Search Product items" aria-label="Search Product items" />
              {matches.length === 0 ? (
                <p className="text-xs text-[var(--color-text-tertiary)]">{query.trim() ? "No open item matches. Create a new one below." : "Type a few words to search."}</p>
              ) : (
                <ul className="space-y-2">
                  {matches.map((signal) => (
                    <li key={signal.id} className="flex flex-col gap-2 rounded-xl border border-[var(--gray-200)] p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{signal.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                          <Badge variant="info">Product · {STAGE_LABEL[signal.state] || signal.state}</Badge>
                          <span>{signalTypeLabel(signal.signal_kind)}</span>
                          <span>· {signal.affected_people} reporter{signal.affected_people === 1 ? "" : "s"}</span>
                        </p>
                      </div>
                      <Button size="sm" variant="secondary" loading={linkingId === signal.id} disabled={!!linkingId || saving} onClick={() => void link(signal)}>
                        Link {label} here (+1 reporter)
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
              <span className="h-px flex-1 bg-[var(--gray-200)]" />or create a new item<span className="h-px flex-1 bg-[var(--gray-200)]" />
            </div>
            <section className="space-y-4" aria-label="Create a new Product item">
              <div>
                <p className="mb-1.5 text-sm font-medium text-[var(--color-text-primary)]">Type</p>
                <Segmented label="Type" options={SIGNAL_TYPE_OPTIONS} value={form.signalKind} onChange={(value) => set("signalKind", value)} />
              </div>
              <Input label="Title" value={form.title} onChange={(event) => set("title", event.target.value)} maxLength={200} />
              <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                What's wrong <span className="font-normal text-[var(--color-text-tertiary)]">(prefilled from the ticket)</span>
                <textarea className={`${TEXTAREA_CLASS} mt-1.5`} rows={4} value={form.problemStatement} onChange={(event) => set("problemStatement", event.target.value)} maxLength={8000} />
              </label>
              <Input label="Product area" list="support-product-areas" value={form.productArea} onChange={(event) => set("productArea", event.target.value)} placeholder="Host app · Payouts" maxLength={120} />
              <datalist id="support-product-areas">{PRODUCT_AREAS.map((area) => <option key={area} value={area} />)}</datalist>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                This stays inside Mingla. Nothing goes to GitHub until an admin or founding partner writes public-safe wording in Triage. The reporter is not messaged now; they hear back when it is live.
              </p>
            </section>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={!valid || saving || !!linkingId} onClick={() => void create()}>
          Send to Product
        </Button>
      </ModalFooter>
    </>
  );
}

export function SendToProductModal({ source, onClose, ...props }) {
  return (
    <Modal open={!!source} onClose={onClose} title={`Send to Product · from ${source?.label || "this report"}`} size="lg">
      {source && <SendToProductForm key={`${source.source_kind}:${source.id}`} source={source} onClose={onClose} {...props} />}
    </Modal>
  );
}
