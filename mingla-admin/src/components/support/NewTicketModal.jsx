// #4382 Wave 2 — New ticket (replaces "Add a staff-created ticket").
//
// Who can see it: Internal only (staff), A person (one host or Explorer user)
// or A brand team (every member). Screenshots ride in the first internal
// note. A person or brand ticket also needs a next update and a first message,
// which reaches them as a push. One staff create call, with a client request
// id so a double click cannot make two tickets.
import { useEffect, useMemo, useState } from "react";
import { Building2, Lock, User } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { SearchInput } from "../ui/SearchInput";
import { Select, TEXTAREA_CLASS } from "../crm/fields";
import { AttachmentDropZone } from "./AttachmentUploader";
import { useSupportUploads } from "./useSupportUploads";
import { PRIORITY_OPTIONS, PRODUCT_AREAS } from "./supportOptions";
import { searchPeople } from "../../services/supportDeskService";
import { createClientRequestId, createStaffSupportTicket } from "../../services/supportProductWorkflowService";

const VISIBILITY_CARDS = [
  { value: "internal", title: "Internal only", body: "Staff only", icon: Lock },
  { value: "person", title: "A person", body: "One host or Explorer user", icon: User },
  { value: "brand", title: "A brand team", body: "Every member", icon: Building2 },
];

function localInput(date) {
  const copy = new Date(date.getTime());
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

function tomorrowNoon() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(12, 0, 0, 0);
  return date;
}

function personLabel(person) {
  return person?.display_name || person?.username || person?.email || "Unnamed person";
}

const labelClass = "block text-sm font-medium text-[var(--color-text-primary)]";

/** The form body. Mounted fresh each time the modal opens. */
function NewTicketForm({ brands, staffRoster, myUserId, onClose, onCreated, onError }) {
  const [requestId] = useState(() => createClientRequestId());
  const [visibility, setVisibility] = useState("internal");
  const [person, setPerson] = useState(null);
  const [personQuery, setPersonQuery] = useState("");
  const [personResults, setPersonResults] = useState([]);
  const [personError, setPersonError] = useState(null);
  const [brandId, setBrandId] = useState("");
  const [brandQuery, setBrandQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [productArea, setProductArea] = useState("");
  const [priority, setPriority] = useState("normal");
  const [owner, setOwner] = useState(myUserId || "");
  const [nextAt, setNextAt] = useState(localInput(tomorrowNoon()));
  const [nextNote, setNextNote] = useState("We'll send the next update by then.");
  const [firstMessage, setFirstMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [openedAt] = useState(() => Date.now());
  // Screenshots go in the first internal note, so they are uploaded as internal.
  const uploads = useSupportUploads({ ticketId: requestId, isInternal: true });

  useEffect(() => {
    if (visibility !== "person") return undefined;
    const text = personQuery.trim();
    if (text.length < 2) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      searchPeople(text)
        .then((rows) => { if (live) { setPersonResults(rows); setPersonError(null); } })
        .catch((error) => { if (live) { setPersonResults([]); setPersonError(error.message); } });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [personQuery, visibility]);

  const brandMatches = useMemo(() => {
    const text = brandQuery.trim().toLowerCase();
    if (!text) return [];
    return brands.filter((brand) => String(brand.name || "").toLowerCase().includes(text)).slice(0, 8);
  }, [brands, brandQuery]);
  const brand = brands.find((row) => row.id === brandId) || null;

  const customerFacing = visibility !== "internal";
  const nextIso = nextAt ? new Date(nextAt).toISOString() : null;
  const nextValid = !customerFacing || (nextIso && Date.parse(nextIso) > openedAt && nextNote.trim());
  const valid = subject.trim() && details.trim()
    && (visibility !== "person" || person)
    && (visibility !== "brand" || brandId)
    && (!customerFacing || firstMessage.trim())
    && nextValid
    && uploads.ready && !uploads.busy;
  const imageCount = uploads.items.length;

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const id = await createStaffSupportTicket({
        clientRequestId: requestId,
        visibility,
        subject: subject.trim(),
        details: details.trim(),
        requesterUserId: visibility === "person" ? person.id : null,
        brandId: brandId || null,
        segment: visibility === "person" ? (person.segment === "explorer" ? "explorer" : "business") : null,
        priority,
        productArea: productArea.trim() || null,
        // Nobody chosen, or me without a roster row: the server makes me the owner.
        assignedStaffId: owner && staffRoster.some((row) => row.user_id === owner) ? owner : null,
        nextUpdateAt: customerFacing ? nextIso : null,
        nextUpdateNote: customerFacing ? nextNote.trim() : null,
        firstMessage: customerFacing ? firstMessage.trim() : null,
        attachmentIds: uploads.attachmentIds,
      });
      await onCreated(id, imageCount);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  const target = visibility === "brand" ? (brand?.name ? `the ${brand.name} team` : "the brand") : person ? personLabel(person) : "them";

  return (
    <>
      <ModalBody>
        <div className="space-y-5">
          <fieldset>
            <legend className={`${labelClass} mb-2`}>Who can see this?</legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Who can see this?">
              {VISIBILITY_CARDS.map((card) => {
                const { value, title, body } = card;
                const on = visibility === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setVisibility(value)}
                    className={`flex min-h-16 items-start gap-2 rounded-xl border p-3 text-left transition-colors ${on ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] ring-2 ring-[var(--color-brand-100)]" : "border-[var(--gray-200)] hover:bg-[var(--gray-50)]"}`}
                  >
                    <card.icon className={`mt-0.5 h-4 w-4 shrink-0 ${on ? "text-[var(--color-brand-600)]" : "text-[var(--color-text-tertiary)]"}`} aria-hidden="true" />
                    <span><span className="block text-sm font-semibold text-[var(--color-text-primary)]">{title}</span><span className="block text-xs text-[var(--color-text-secondary)]">{body}</span></span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {visibility === "person" && (
            <div className="space-y-2">
              <p className={labelClass}>Person</p>
              {person ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--gray-200)] p-2.5 text-sm">
                  <span className="min-w-0 truncate"><strong>{personLabel(person)}</strong>{person.email ? ` · ${person.email}` : ""}{person.segment ? ` · ${person.segment}` : ""}</span>
                  <Button size="sm" variant="ghost" onClick={() => setPerson(null)}>Change</Button>
                </div>
              ) : (
                <>
                  <SearchInput value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} onClear={() => setPersonQuery("")} placeholder="Search by name or email" aria-label="Search people" />
                  {personError && <p role="alert" className="text-xs text-[var(--color-error-700)]">{personError}</p>}
                  {personQuery.trim().length >= 2 && personResults.length > 0 && (
                    <ul className="divide-y divide-[var(--gray-100)] rounded-xl border border-[var(--gray-200)]">
                      {personResults.map((row) => (
                        <li key={row.id}>
                          <button type="button" onClick={() => setPerson(row)} className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--gray-50)]">
                            {personLabel(row)} <span className="text-xs text-[var(--color-text-tertiary)]">{row.email} {row.segment ? `· ${row.segment}` : ""}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {personQuery.trim().length >= 2 && personResults.length === 0 && !personError && (
                    <p className="text-xs text-[var(--color-text-tertiary)]">Nobody matches yet.</p>
                  )}
                </>
              )}
            </div>
          )}

          {(visibility === "brand" || visibility === "internal") && (
            <div className="space-y-2">
              <p className={labelClass}>
                Brand {visibility === "internal" && <span className="font-normal text-[var(--color-text-tertiary)]">(optional, for context)</span>}
              </p>
              {brand ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--gray-200)] p-2.5 text-sm">
                  <strong className="truncate">{brand.name}</strong>
                  <Button size="sm" variant="ghost" onClick={() => setBrandId("")}>Change</Button>
                </div>
              ) : (
                <>
                  <SearchInput value={brandQuery} onChange={(event) => setBrandQuery(event.target.value)} onClear={() => setBrandQuery("")} placeholder="Search brands" aria-label="Search brands" />
                  {brandMatches.length > 0 && (
                    <ul className="divide-y divide-[var(--gray-100)] rounded-xl border border-[var(--gray-200)]">
                      {brandMatches.map((row) => (
                        <li key={row.id}>
                          <button type="button" onClick={() => setBrandId(row.id)} className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--gray-50)]">{row.name}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <Input label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} placeholder="Short, plain-English subject" />
          <label className={labelClass}>
            What happened <span className="font-normal text-[var(--color-text-tertiary)]">(the first internal note; only staff see it)</span>
            <textarea className={`${TEXTAREA_CLASS} mt-1.5`} rows={4} value={details} onChange={(event) => setDetails(event.target.value)} onPaste={uploads.onPaste} maxLength={8000} />
          </label>
          <div>
            <p className={`${labelClass} mb-1.5`}>Screenshots</p>
            <AttachmentDropZone uploads={uploads} disabled={saving} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Input label="Product area" list="new-ticket-product-areas" value={productArea} onChange={(event) => setProductArea(event.target.value)} maxLength={120} placeholder="Optional" />
              <datalist id="new-ticket-product-areas">{PRODUCT_AREAS.map((area) => <option key={area} value={area} />)}</datalist>
            </div>
            <label className={labelClass}>
              Priority
              <Select className="mt-1.5" value={priority} onChange={(event) => setPriority(event.target.value)} options={PRIORITY_OPTIONS} />
            </label>
            <label className={labelClass}>
              Owner
              <Select
                className="mt-1.5"
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                options={[
                  ...(myUserId && !staffRoster.some((row) => row.user_id === myUserId) ? [{ value: myUserId, label: "Me" }] : []),
                  ...staffRoster.map((row) => ({ value: row.user_id, label: row.user_id === myUserId ? `Me (${row.display_name || "you"})` : row.display_name || row.user_id.slice(0, 8) })),
                ]}
              />
            </label>
          </div>

          {customerFacing ? (
            <div className="space-y-4 rounded-xl border border-[var(--gray-200)] p-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label={`Next update to ${target} by`} type="datetime-local" min={localInput(new Date(openedAt))} value={nextAt} onChange={(event) => setNextAt(event.target.value)} helper="Needed when a person or brand team can see the ticket" />
                <Input label="What you'll do before then" value={nextNote} onChange={(event) => setNextNote(event.target.value)} maxLength={500} />
              </div>
              <label className={labelClass}>
                First message to {target}
                <textarea className={`${TEXTAREA_CLASS} mt-1.5`} rows={3} value={firstMessage} onChange={(event) => setFirstMessage(event.target.value)} maxLength={8000} placeholder="This reaches them as a push." />
              </label>
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-tertiary)]">Internal ticket: nobody outside Mingla is told.</p>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={!valid || saving} onClick={() => void submit()}>
          {imageCount ? `Create ticket · ${imageCount} image${imageCount === 1 ? "" : "s"}` : "Create ticket"}
        </Button>
      </ModalFooter>
    </>
  );
}

export function NewTicketModal({ open, ...props }) {
  return (
    <Modal open={open} onClose={props.onClose} title="New ticket" size="lg">
      {open && <NewTicketForm {...props} />}
    </Modal>
  );
}
