import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Select, TEXTAREA_CLASS } from "../crm/fields";
import {
  createClientRequestId,
  createInternalSupportThread,
  createProductSignal,
  linkSourceToProductSignal,
  reassignProductSignal,
  setSupportNextUpdate,
  updateProductSignal,
} from "../../services/supportProductWorkflowService";
import { listSupportStaffRoster } from "../../services/communityService";
import { findRelatedSignals } from "./supportWorkflowUtils";

const labelClass = "block space-y-1.5 text-sm font-medium text-[var(--color-text-primary)]";

function futureLocal(hours = 24) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toIso(localValue) {
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isAllowedNextUpdate(localValue) {
  const value = toIso(localValue);
  return value && Date.parse(value) > Date.now() + 14 * 60 * 1000;
}

export function InternalTicketModal({ open, brands, onClose, onCreated, onError }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      clientRequestId: createClientRequestId(),
      subject: "",
      details: "",
      customerEmail: "",
      brandId: "",
      brandGroupContext: "",
      priority: "normal",
      nextUpdateAt: futureLocal(24),
      nextUpdateNote: "We will review this and share the next useful update.",
    });
  }, [open]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const valid = form && form.subject.trim() && form.details.trim()
    && form.nextUpdateNote.trim() && isAllowedNextUpdate(form.nextUpdateAt);

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const id = await createInternalSupportThread({
        ...form,
        nextUpdateAt: toIso(form.nextUpdateAt),
      });
      await onCreated(id);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a staff-created ticket" size="lg">
      <ModalBody>
        {form && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 rounded-xl border border-[var(--color-brand-100)] bg-[var(--color-brand-50)] p-3 text-sm text-[var(--color-text-secondary)]">
              This is an internal work thread. Linking a customer adds context; it does not message them or create a live chat.
            </div>
            <label className={`${labelClass} md:col-span-2`}>
              What needs attention?
              <Input value={form.subject} onChange={(event) => set("subject", event.target.value)} placeholder="Short, plain-English subject" />
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              What did the customer or team report?
              <textarea className={TEXTAREA_CLASS} rows={5} value={form.details} onChange={(event) => set("details", event.target.value)} placeholder="Include what happened, what they expected and any useful context." />
            </label>
            <label className={labelClass}>
              Link customer by email <span className="font-normal text-[var(--color-text-tertiary)]">(optional)</span>
              <Input type="email" value={form.customerEmail} onChange={(event) => set("customerEmail", event.target.value)} placeholder="customer@example.com" />
            </label>
            <label className={labelClass}>
              Link brand <span className="font-normal text-[var(--color-text-tertiary)]">(optional)</span>
              <Select
                value={form.brandId}
                onChange={(event) => set("brandId", event.target.value)}
                placeholder="No brand selected"
                options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
              />
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              Brand group context <span className="font-normal text-[var(--color-text-tertiary)]">(optional)</span>
              <Input value={form.brandGroupContext} onChange={(event) => set("brandGroupContext", event.target.value)} placeholder="Name or context only; a community group can be linked once it exists." />
            </label>
            <label className={labelClass}>
              Priority
              <Select
                value={form.priority}
                onChange={(event) => set("priority", event.target.value)}
                options={['low', 'normal', 'high', 'urgent'].map((value) => ({ value, label: value }))}
              />
            </label>
            <label className={labelClass}>
              Next update by
              <Input type="datetime-local" min={futureLocal(0.25)} value={form.nextUpdateAt} onChange={(event) => set("nextUpdateAt", event.target.value)} />
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              What will Support do before then?
              <Input value={form.nextUpdateNote} onChange={(event) => set("nextUpdateNote", event.target.value)} />
            </label>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={!valid || saving} onClick={() => void submit()}>
          Add ticket
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function NextUpdateModal({ source, onClose, onSaved, onError }) {
  const [nextAt, setNextAt] = useState(futureLocal(24));
  const [note, setNote] = useState("We will review this and share the next useful update.");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!source) return;
    if (source.next_update_at) {
      const date = new Date(source.next_update_at);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      setNextAt(date.toISOString().slice(0, 16));
    } else {
      setNextAt(futureLocal(24));
    }
    setNote(source.next_update_note || "We will review this and share the next useful update.");
  }, [source]);

  async function submit() {
    if (!source || !note.trim() || !isAllowedNextUpdate(nextAt) || saving) return;
    setSaving(true);
    try {
      await setSupportNextUpdate({
        sourceKind: source.source_kind,
        sourceId: source.id,
        expectedRevision: source.workflow_revision,
        nextUpdateAt: toIso(nextAt),
        nextUpdateNote: note,
      });
      await onSaved();
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!source} onClose={onClose} title="Set the next customer update" size="md">
      <ModalBody>
        <div className="space-y-4">
          {source?.source_kind === "support_ticket" && (
            <div className="rounded-xl border border-[var(--color-brand-100)] bg-[var(--color-brand-50)] p-3 text-sm text-[var(--color-text-secondary)]">
              Saving this adds a visible system message to the live chat. It promises communication—not a delivery date.
            </div>
          )}
          <label className={labelClass}>
            Next update by
            <Input type="datetime-local" min={futureLocal(0.25)} value={nextAt} onChange={(event) => setNextAt(event.target.value)} />
          </label>
          <label className={labelClass}>
            What will Support do before then?
            <textarea className={TEXTAREA_CLASS} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={saving || !note.trim() || !isAllowedNextUpdate(nextAt)} onClick={() => void submit()}>
          Save next update
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function ProductSignalModal({ source, signals, onClose, onCreated, onLinked, onError }) {
  const [form, setForm] = useState(null);
  const [reviewedRelated, setReviewedRelated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkingId, setLinkingId] = useState(null);

  useEffect(() => {
    if (!source) return;
    setReviewedRelated(false);
    setForm({
      clientRequestId: createClientRequestId(),
      signalKind: "bug",
      title: source.subject || "",
      problemStatement: source.details || "",
      productArea: "",
      userJourney: "",
      impactSummary: source.requester_user_id ? "One linked customer report" : "One internal team report",
      affectedPeople: 1,
      priority: source.priority || "normal",
      nextUpdateAt: source.next_update_at ? (() => {
        const date = new Date(source.next_update_at);
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        return date.toISOString().slice(0, 16);
      })() : futureLocal(24),
      nextStep: "Product reviews the evidence and decides the next action.",
      customerReplyDraft: "Thanks for reporting this. We have shared it with Product and will send the next useful update by the time shown in your support conversation.",
    });
  }, [source]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const related = form ? findRelatedSignals(signals, form.title, form.productArea) : [];
  const valid = form && [
    form.title, form.problemStatement, form.productArea, form.userJourney,
    form.impactSummary, form.nextStep, form.customerReplyDraft,
  ].every((value) => String(value || "").trim())
    && Number(form.affectedPeople) > 0 && isAllowedNextUpdate(form.nextUpdateAt)
    && (related.length === 0 || reviewedRelated);

  async function submit() {
    if (!source || !valid || saving) return;
    setSaving(true);
    try {
      const id = await createProductSignal({
        ...form,
        sourceKind: source.source_kind,
        sourceId: source.id,
        affectedPeople: Number(form.affectedPeople),
        nextUpdateAt: toIso(form.nextUpdateAt),
      });
      await onCreated(id);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  async function linkExisting(signal) {
    if (!source || linkingId) return;
    setLinkingId(signal.id);
    try {
      await linkSourceToProductSignal({
        signalId: signal.id,
        expectedRevision: signal.revision,
        sourceKind: source.source_kind,
        sourceId: source.id,
      });
      await onLinked(signal.id);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setLinkingId(null);
    }
  }

  return (
    <Modal open={!!source} onClose={onClose} title="Send a private signal to Product" size="xl">
      <ModalBody>
        {form && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 rounded-xl border border-[var(--color-brand-100)] bg-[var(--color-brand-50)] p-3 text-sm text-[var(--color-text-secondary)]">
              This stays inside Mingla. It does not create a public GitHub issue. Product must review it first.
            </div>
            <label className={labelClass}>
              What kind of signal is this?
              <Select
                value={form.signalKind}
                onChange={(event) => set("signalKind", event.target.value)}
                options={[
                  { value: "question", label: "Question" },
                  { value: "account", label: "Account help" },
                  { value: "bug", label: "Bug" },
                  { value: "feature", label: "Feature request" },
                  { value: "trust_safety", label: "Trust & safety" },
                ]}
              />
            </label>
            <label className={labelClass}>
              Priority
              <Select
                value={form.priority}
                onChange={(event) => set("priority", event.target.value)}
                options={['low', 'normal', 'high', 'urgent'].map((value) => ({ value, label: value }))}
              />
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              Plain-English title
              <Input value={form.title} onChange={(event) => set("title", event.target.value)} />
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              What is the problem or request?
              <textarea className={TEXTAREA_CLASS} rows={4} value={form.problemStatement} onChange={(event) => set("problemStatement", event.target.value)} />
            </label>
            <label className={labelClass}>
              Product area
              <Input value={form.productArea} onChange={(event) => set("productArea", event.target.value)} placeholder="e.g. Host app · Community" />
            </label>
            <label className={labelClass}>
              People affected
              <Input type="number" min="1" value={form.affectedPeople} onChange={(event) => set("affectedPeople", event.target.value)} />
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              What was the person trying to do?
              <textarea className={TEXTAREA_CLASS} rows={2} value={form.userJourney} onChange={(event) => set("userJourney", event.target.value)} />
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              What is the impact?
              <textarea className={TEXTAREA_CLASS} rows={2} value={form.impactSummary} onChange={(event) => set("impactSummary", event.target.value)} />
            </label>
            {related.length > 0 && (
              <div className="md:col-span-2 rounded-xl border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3">
                <div className="font-medium text-[var(--color-text-primary)]">Possible related signals</div>
                <div className="mt-2 space-y-2">
                  {related.map((signal) => (
                    <div key={signal.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0"><div className="truncate">{signal.title}</div><Badge variant="warning">{signal.state.replaceAll('_', ' ')}</Badge></div>
                      <Button variant="secondary" size="sm" loading={linkingId === signal.id} disabled={!!linkingId} onClick={() => void linkExisting(signal)}>
                        Link this report
                      </Button>
                    </div>
                  ))}
                </div>
                <label className="mt-3 flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={reviewedRelated} onChange={(event) => setReviewedRelated(event.target.checked)} className="mt-1" />
                  I reviewed these. This report still needs its own signal for now.
                </label>
              </div>
            )}
            <label className={labelClass}>
              Product next update by
              <Input type="datetime-local" min={futureLocal(0.25)} value={form.nextUpdateAt} onChange={(event) => set("nextUpdateAt", event.target.value)} />
            </label>
            <label className={labelClass}>
              Product's next step
              <Input value={form.nextStep} onChange={(event) => set("nextStep", event.target.value)} />
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              Draft Support can send to the customer
              <textarea className={TEXTAREA_CLASS} rows={3} value={form.customerReplyDraft} onChange={(event) => set("customerReplyDraft", event.target.value)} />
            </label>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={!valid || saving} onClick={() => void submit()}>
          Create private signal
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function ProductInboxModal({ open, signals, onClose, onSaved, onError }) {
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [staffRoster, setStaffRoster] = useState([]);
  const [reassigning, setReassigning] = useState(false);
  const selected = signals.find((signal) => signal.id === selectedId) || null;

  useEffect(() => {
    if (!open) return;
    setSelectedId((current) => current && signals.some((signal) => signal.id === current)
      ? current
      : signals[0]?.id || null);
    void listSupportStaffRoster()
      .then((rows) => setStaffRoster((rows || []).filter((row) => row.enabled)))
      .catch(() => setStaffRoster([]));
  }, [open, signals]);

  useEffect(() => {
    if (!selected) {
      setForm(null);
      return;
    }
    const date = new Date(selected.next_update_at);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    setForm({
      state: selected.state,
      priority: selected.priority,
      nextUpdateAt: date.toISOString().slice(0, 16),
      nextStep: selected.next_step,
      customerReplyDraft: selected.customer_reply_draft,
    });
  }, [selected]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function save() {
    if (!selected || !form || saving) return;
    setSaving(true);
    try {
      await updateProductSignal({
        signalId: selected.id,
        expectedRevision: selected.revision,
        state: form.state,
        priority: form.priority,
        nextUpdateAt: toIso(form.nextUpdateAt),
        nextStep: form.nextStep,
        customerReplyDraft: form.customerReplyDraft,
      });
      await onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  async function reassignOwner(ownerUserId) {
    if (!selected || !ownerUserId || ownerUserId === selected.owner_user_id || reassigning) return;
    setReassigning(true);
    try {
      await reassignProductSignal({
        signalId: selected.id,
        expectedRevision: selected.revision,
        ownerUserId,
      });
      await onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setReassigning(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Product inbox" size="xl">
      <ModalBody className="!p-0">
        <div className="grid min-h-[520px] md:grid-cols-[320px_1fr]">
          <div className="border-r border-[var(--gray-200)] p-3">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Private signals ({signals.length})</div>
            <div className="space-y-2">
              {signals.length === 0 ? (
                <p className="rounded-xl bg-[var(--gray-50)] p-4 text-sm text-[var(--color-text-tertiary)]">No Product signals yet.</p>
              ) : signals.map((signal) => (
                <button key={signal.id} type="button" onClick={() => setSelectedId(signal.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedId === signal.id ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)]' : 'border-[var(--gray-200)] hover:bg-[var(--gray-50)]'}`}>
                  <div className="line-clamp-2 text-sm font-medium text-[var(--color-text-primary)]">{signal.title}</div>
                  <div className="mt-2 flex flex-wrap gap-1"><Badge variant="info">{signal.signal_kind.replaceAll('_', ' ')}</Badge><Badge variant="default">{signal.state.replaceAll('_', ' ')}</Badge></div>
                </button>
              ))}
            </div>
          </div>
          <div className="p-5">
            {!selected || !form ? (
              <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">Choose a signal to review.</div>
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="brand">{selected.signal_kind.replaceAll('_', ' ')}</Badge><span className="text-xs text-[var(--color-text-tertiary)]">{selected.sources.length} linked report{selected.sources.length === 1 ? '' : 's'}</span></div>
                  <h3 className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">{selected.title}</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{selected.problem_statement}</p>
                </div>
                <div className="grid gap-3 rounded-xl bg-[var(--gray-50)] p-4 text-sm md:grid-cols-2">
                  <div><span className="text-[var(--color-text-tertiary)]">Product area</span><div>{selected.product_area}</div></div>
                  <div><span className="text-[var(--color-text-tertiary)]">People affected</span><div>{selected.affected_people}</div></div>
                  <div className="md:col-span-2"><span className="text-[var(--color-text-tertiary)]">User journey</span><div>{selected.user_journey}</div></div>
                  <div className="md:col-span-2"><span className="text-[var(--color-text-tertiary)]">Impact</span><div>{selected.impact_summary}</div></div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={labelClass}>Owner
                    <Select
                      value={selected.owner_user_id || ""}
                      onChange={(event) => void reassignOwner(event.target.value)}
                      disabled={reassigning || staffRoster.length === 0}
                      options={[
                        { value: "", label: "Choose a teammate" },
                        ...staffRoster.map((row) => ({
                          value: row.user_id,
                          label: row.display_name || row.user_id.slice(0, 8),
                        })),
                      ]}
                    />
                  </label>
                  <label className={labelClass}>State<Select value={form.state} onChange={(event) => set('state', event.target.value)} options={['needs_review', 'waiting_details', 'ready_product', 'linked', 'update_due', 'released', 'closed'].map((value) => ({ value, label: value.replaceAll('_', ' ') }))} /></label>
                  <label className={labelClass}>Priority<Select value={form.priority} onChange={(event) => set('priority', event.target.value)} options={['low', 'normal', 'high', 'urgent'].map((value) => ({ value, label: value }))} /></label>
                  <label className={labelClass}>Next Product update<Input type="datetime-local" min={futureLocal(0.25)} value={form.nextUpdateAt} onChange={(event) => set('nextUpdateAt', event.target.value)} /></label>
                  <label className={labelClass}>Next step<Input value={form.nextStep} onChange={(event) => set('nextStep', event.target.value)} /></label>
                  <label className={`${labelClass} md:col-span-2`}>Customer-safe draft<textarea className={TEXTAREA_CLASS} rows={4} value={form.customerReplyDraft} onChange={(event) => set('customerReplyDraft', event.target.value)} /></label>
                </div>
                <div className="flex justify-end"><Button variant="primary" loading={saving} disabled={saving || !isAllowedNextUpdate(form.nextUpdateAt) || !form.nextStep.trim() || !form.customerReplyDraft.trim()} onClick={() => void save()}>Save review</Button></div>
              </div>
            )}
          </div>
        </div>
      </ModalBody>
      <ModalFooter><Button variant="secondary" onClick={onClose}>Done</Button></ModalFooter>
    </Modal>
  );
}
