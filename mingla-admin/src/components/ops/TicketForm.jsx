// Issue #4420 (step 4) — make a ticket from the Work board ("+ New", then
// Ticket). A ticket is a Work card labelled Ticket: Type, Title, What is wrong,
// Product area, the Owner (chosen by the person making it, like any card) and a
// due date filled in at 7 days. As the title is typed, similar open tickets are
// offered first, each with "Link here" (when a source conversation is attached)
// or "Open". The server checks everything; a refused ticket keeps the form
// filled and says what to fix next to each field.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import { dayLabel, opsErrorWords, requestKey, todayIso } from "../../lib/opsModel";
import {
  SIMILAR_DEBOUNCE_MS,
  TICKET_TYPES,
  TITLE_MAX,
  WRONG_MAX,
  buildTicketPayload,
  defaultTicketDue,
  fixesByField,
  shouldSearchSimilar,
  similarWords,
  ticketFormProblems,
  ticketNumber,
} from "../../lib/ticketModel";
import { PRODUCT_AREAS } from "../support/supportOptions";
import { PeopleField } from "../people/PeopleField";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import { AUTO_GROW_CLASS, useAutoGrow } from "./useAutoGrow";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const INPUT = `min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] ${FOCUS}`;
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";

function FieldError({ id, words }) {
  return words ? <span id={id} role="alert" className="text-[12px] text-[var(--color-error-700)]">{words}</span> : null;
}

/**
 * Props: config (ops config: me, team), online, headingRef, onCreated(card),
 * onCancel, onOpenCard(id), and optionally the conversation the ticket comes
 * from: conversation { id, label }, createdFrom ("board" | "conversation" |
 * "brand_group"), brandId, initialTitle, initialWhatIsWrong, initialType, initialProductArea.
 */
export function TicketForm({ config, online, headingRef, onCreated, onCancel, onOpenCard, conversation = null, createdFrom = "board", brandId = null, initialTitle = "", initialWhatIsWrong = "", initialType = "bug", initialProductArea = "" }) {
  const { addToast } = useToast();
  const directory = usePeopleDirectory();
  const team = directory.people.length ? directory.people : (config?.team || []);
  const me = config?.me?.email;
  const today = todayIso();
  const [type, setType] = useState(initialType);
  const [title, setTitle] = useState(initialTitle);
  const titleGrow = useAutoGrow(title);
  const [whatIsWrong, setWhatIsWrong] = useState(initialWhatIsWrong);
  const [productArea, setProductArea] = useState(initialProductArea);
  // The person making the ticket picks its owner, like any card; they usually suggest themselves.
  const [owners, setOwners] = useState(me ? [me] : []);
  // Due is filled in at 7 days and editable; clearing it leaves the server's 7-day default.
  const [due, setDue] = useState(() => defaultTicketDue(today));
  const [source, setSource] = useState(conversation);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [touched, setTouched] = useState(false);
  const keyRef = useRef({ key: null, value: null });

  const form = { type, title, whatIsWrong, productArea, owners, due, conversationIds: source ? [source.id] : [], brandId };
  const payload = useMemo(() => buildTicketPayload(form, { createdFrom: source && createdFrom === "board" ? "conversation" : createdFrom }), [type, title, whatIsWrong, productArea, owners, due, source, brandId, createdFrom]); // eslint-disable-line react-hooks/exhaustive-deps
  const problems = touched ? ticketFormProblems(form) : {};
  const serverWords = refused?.status === "refused" ? fixesByField(refused.fixes) : {};
  const wordsFor = (field) => serverWords[field] || problems[field] || "";

  // Similar open tickets, offered first (debounced, 3+ characters).
  const [similar, setSimilar] = useState({ text: "", rows: [], error: null });
  const seq = useRef(0);
  const searched = title.trim();
  useEffect(() => {
    if (!shouldSearchSimilar(searched)) return undefined;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const rows = await ops.similarTickets(searched, 5);
        if (mine === seq.current) setSimilar({ text: searched, rows: Array.isArray(rows) ? rows : [], error: null });
      } catch (error) {
        if (mine === seq.current) setSimilar({ text: searched, rows: [], error });
      }
    }, SIMILAR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searched]);
  const similarShown = shouldSearchSimilar(searched) && similar.text === searched;

  const [linkingId, setLinkingId] = useState(null);
  const linkHere = async (row) => {
    if (!source) return;
    setLinkingId(row.id);
    try {
      const read = await ops.getWork(row.id);
      const answer = await ops.linkTicketConversation(row.id, source.id, read?.card?.revision);
      addToast({ variant: "success", title: answer?.changed === false ? `Already a reporter on ${ticketNumber(row.number)}` : `Added as a reporter on ${ticketNumber(row.number)}` });
      onOpenCard?.(row.id);
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t link here", description: opsErrorWords(error) });
    } finally {
      setLinkingId(null);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(ticketFormProblems(form)).length > 0) return;
    const value = JSON.stringify(payload);
    if (keyRef.current.value !== value) keyRef.current = { key: requestKey("web_ticket"), value };
    setBusy(true);
    setDuplicate(null);
    try {
      const answer = await ops.createTicket(payload, keyRef.current.key);
      if (answer?.status === "added") {
        setRefused(null);
        keyRef.current = { key: null, value: null };
        addToast({ variant: "success", title: `Ticket ${ticketNumber(answer.card?.number)} made`, description: owners.some((o) => o !== me) ? "The owner was told." : undefined });
        onCreated?.(answer.card);
      } else if (answer?.status === "duplicate") {
        setRefused(null);
        setDuplicate(answer);
      } else {
        setRefused(answer || { status: "refused", fixes: [] });
      }
    } catch (error) {
      // The request key is kept, so Try again is safe (the same request never makes two tickets).
      addToast({ variant: "error", title: "Ticket not made", description: opsErrorWords(error) });
    } finally {
      setBusy(false);
    }
  };

  const unplaced = refused?.status === "refused" ? (refused.fixes || []).filter((f) => !["type", "title", "what_is_wrong", "product_area", "due_on", "owners"].includes(f.field)) : [];

  return (
    <form onSubmit={submit} noValidate data-ticket-form="" className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]">
      <h2 ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-[var(--color-text-primary)]">New ticket</h2>
      {unplaced.length > 0 && (
        <div role="alert" className="rounded-xl bg-[var(--color-error-50)] p-3 text-[13px] text-[var(--color-error-700)]">
          {unplaced.map((f, i) => <p key={`${f.field}-${i}`} className="break-words">{f.message}</p>)}
        </div>
      )}
      {duplicate && (
        <div role="alert" className="flex min-w-0 flex-col gap-2 rounded-xl bg-[var(--color-warning-50)] p-3 text-[13px] text-[var(--color-warning-700)]">
          <p className="break-words">{duplicate.message}</p>
          <Button variant="secondary" className="min-h-11 self-start" onClick={() => onOpenCard?.(duplicate.existing?.id)}>Open existing card</Button>
        </div>
      )}

      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className={LABEL}>Type</legend>
        <div role="radiogroup" aria-label="Type" className="flex min-w-0 flex-wrap gap-1.5">
          {TICKET_TYPES.map((t) => (
            <button key={t.value} type="button" role="radio" aria-checked={type === t.value} onClick={() => setType(t.value)}
              className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold ${type === t.value ? "bg-[var(--color-brand-800)] text-white" : "bg-[var(--gray-100)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-200)]"} ${FOCUS}`}>
              {t.label}
            </button>
          ))}
        </div>
        <FieldError id="ticket-type-error" words={wordsFor("type")} />
      </fieldset>

      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>Title</span>
        <textarea
          value={title}
          ref={titleGrow}
          rows={1}
          maxLength={TITLE_MAX}
          aria-invalid={wordsFor("title") ? "true" : undefined}
          onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
          className={`min-h-11 w-full whitespace-pre-wrap break-words rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-text-primary)] ${AUTO_GROW_CLASS} ${FOCUS}`}
        />
        <FieldError id="ticket-title-error" words={wordsFor("title")} />
      </label>

      {shouldSearchSimilar(searched) && (
        <div data-similar-tickets="" aria-live="polite" className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-2">
          <p className={LABEL}>Similar open tickets</p>
          {!similarShown ? (
            <p className="px-1 text-[13px] text-[var(--color-text-tertiary)]">Looking…</p>
          ) : similar.error ? (
            <p role="alert" className="px-1 text-[13px] text-[var(--color-error-700)]">{opsErrorWords(similar.error)}</p>
          ) : similar.rows.length === 0 ? (
            <p className="px-1 text-[13px] text-[var(--color-text-tertiary)]">No similar open ticket.</p>
          ) : (
            <ul className="flex min-w-0 flex-col">
              {similar.rows.map((row) => (
                <li key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1 py-1">
                  <span className="min-w-0"><span className="block break-words text-[13px] font-medium text-[var(--color-text-primary)]">{row.title}</span><span className="text-[12px] text-[var(--color-text-tertiary)]">{similarWords(row)}</span></span>
                  {source ? (
                    <Button type="button" variant="secondary" className="min-h-11" loading={linkingId === row.id} disabled={!online || !!linkingId} onClick={() => linkHere(row)}>Link here</Button>
                  ) : (
                    <Button type="button" variant="ghost" className="min-h-11" onClick={() => onOpenCard?.(row.id)}>Open</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>What is wrong</span>
        <textarea value={whatIsWrong} maxLength={WRONG_MAX} aria-invalid={wordsFor("what_is_wrong") ? "true" : undefined}
          onChange={(e) => setWhatIsWrong(e.target.value)} placeholder="What happened, and what should have happened?"
          className={`min-h-[88px] w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] ${FOCUS}`} />
        <FieldError id="ticket-wrong-error" words={wordsFor("what_is_wrong")} />
      </label>

      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>Product area</span>
        <input value={productArea} maxLength={120} list="ticket-product-areas" placeholder="Pick one or type your own"
          aria-invalid={wordsFor("product_area") ? "true" : undefined}
          onChange={(e) => setProductArea(e.target.value)} className={INPUT} />
        <datalist id="ticket-product-areas">{PRODUCT_AREAS.map((area) => <option key={area} value={area} />)}</datalist>
        <FieldError id="ticket-area-error" words={wordsFor("product_area")} />
      </label>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <PeopleField id="new-ticket-owner" label="Owner" single value={owners} team={team} me={directory.me || me}
            suggested={[directory.me || me].filter(Boolean)} min={1} onChange={(next) => setOwners(next)} />
          <FieldError id="ticket-owner-error" words={wordsFor("owner") || wordsFor("owners")} />
          <span className="text-[12px] text-[var(--color-text-tertiary)]">You watch it unless you own it.</span>
        </div>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Due</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={INPUT} aria-describedby="ticket-due-note" />
          <span id="ticket-due-note" className="text-[12px] text-[var(--color-text-tertiary)]">{due ? `Due ${dayLabel(due)}` : "No date picked: it will be due in 7 days."}</span>
          <FieldError id="ticket-due-error" words={wordsFor("due_on")} />
        </label>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={LABEL}>Source conversation (optional)</span>
        {source ? (
          <span className="inline-flex max-w-full items-center gap-1 self-start rounded-full bg-[var(--gray-100)] py-0.5 pl-2.5 pr-0.5 text-[13px]">
            <span className="min-w-0 break-words">{source.label}</span>
            <button type="button" aria-label={`Remove ${source.label}`} onClick={() => setSource(null)} className={`inline-grid min-h-8 min-w-8 place-items-center rounded-full hover:bg-[var(--gray-200)] ${FOCUS}`}>×</button>
          </span>
        ) : picking ? (
          <ConversationPicker onPick={(pick) => { setSource(pick); setPicking(false); }} onClose={() => setPicking(false)} />
        ) : (
          <button type="button" onClick={() => setPicking(true)} className={`min-h-11 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>+ Link a conversation</button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" loading={busy} disabled={!online || busy}>Make ticket</Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/** Search a support conversation by customer name or conversation number. */
function ConversationPicker({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState({ query: null, rows: [], error: null });
  const seq = useRef(0);
  const query = q.trim();
  useEffect(() => {
    if (query.length < 2) return undefined;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const rows = await ops.searchConversations(query);
        if (mine === seq.current) setFound({ query, rows: Array.isArray(rows) ? rows : [], error: null });
      } catch (error) {
        if (mine === seq.current) setFound({ query, rows: [], error });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const current = found.query === query;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-2">
      <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer name or conversation number" aria-label="Search conversations" className={INPUT} />
      <div aria-live="polite" className="min-w-0">
        {query.length < 2 ? <p className="px-1 text-[13px] text-[var(--color-text-tertiary)]">Type at least 2 letters or a number.</p>
          : !current ? <p className="px-1 text-[13px] text-[var(--color-text-tertiary)]">Searching…</p>
          : found.error ? <p role="alert" className="px-1 text-[13px] text-[var(--color-error-700)]">{opsErrorWords(found.error)}</p>
          : found.rows.length === 0 ? <p className="px-1 text-[13px] text-[var(--color-text-tertiary)]">Nothing found.</p>
          : (
            <ul className="flex min-w-0 flex-col">
              {found.rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => onPick({ id: r.id, label: r.label })} className={`flex min-h-11 w-full min-w-0 flex-col justify-center rounded-lg px-2 py-1 text-left hover:bg-[var(--gray-100)] ${FOCUS}`}>
                    <span className="break-words text-[13px] font-medium text-[var(--color-text-primary)]">{r.label}</span>
                    {r.customer_name && <span className="break-words text-[12px] text-[var(--color-text-tertiary)]">{r.customer_name}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
      <button type="button" onClick={onClose} className={`min-h-11 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Cancel</button>
    </div>
  );
}
