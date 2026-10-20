// Issue #3980 (R9) — the one people field, used for host, creator, content
// and work owners and watchers. Picked people are chips with a coloured
// initial; click the box or type to open an anchored list (Suggested first,
// then Everyone) with each person's role and open cards; invited people are
// greyed and cannot be picked; a field with a minimum keeps its last person
// and says why. Names wrap by whole words; a name two teammates share shows
// the address so the two are never mistaken.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import {
  LAST_OWNER_WORDS,
  addPerson,
  avatarTone,
  canPick,
  fieldKey,
  initialOf,
  invitedWords,
  peopleOptions,
  removePerson,
  shownName,
} from "../../lib/peopleField";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";

export function PersonAvatar({ person, size = "md" }) {
  const box = size === "sm" ? "h-5 w-5 text-[9.5px]" : "h-6 w-6 text-[10px]";
  return (
    <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center rounded-full font-bold text-white ${box} ${avatarTone(person?.email)}`}>
      {initialOf(person?.name || person?.email)}
    </span>
  );
}

/** A picked person as a chip: initial, name (and the address when names clash), remove. */
function Chip({ person, team, onRemove, disabled }) {
  const name = String(person.name || person.email);
  const clash = shownName(person, team) !== name;
  return (
    <span className="inline-flex min-h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-[var(--gray-100)] py-0.5 pl-0.5 pr-0.5 text-[13px] font-semibold text-[var(--color-text-primary)]">
      <PersonAvatar person={person} />
      <span className={`min-w-0 ${WORDS}`}>
        {name}
        {clash && <span title={person.email} className="ml-1 inline-block max-w-[18ch] truncate align-bottom text-[11.5px] font-normal text-[var(--color-text-tertiary)]">{person.email}</span>}
      </span>
      <button
        type="button"
        aria-label={`Remove ${shownName(person, team)}`}
        disabled={disabled}
        onClick={onRemove}
        className={`inline-grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--color-text-tertiary)] hover:bg-[var(--gray-200)] hover:text-[var(--color-text-primary)] disabled:opacity-50 ${FOCUS}`}
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

export function PeopleField({
  id: givenId,
  label,
  value = [],
  onChange,
  team = [],
  suggested = [],
  min = 0,
  max = 10,
  me = "",
  disabled = false,
  busy = false,
  minWords = LAST_OWNER_WORDS,
  onResend,
  placeholder,
  hint,
  exclude = [],
}) {
  const autoId = useId();
  const id = givenId || `people-${autoId.replace(/:/g, "")}`;
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [message, setMessage] = useState("");
  const [resendFor, setResendFor] = useState(null);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const emails = useMemo(() => (Array.isArray(value) ? value.map((e) => String(e).toLowerCase()) : []), [value]);
  const known = (email) => team.find((p) => p.email === email) || { email, name: email, role: "No longer on the team", invited: false, open: 0 };
  const picked = emails.map(known);
  const skip = new Set((Array.isArray(exclude) ? exclude : []).map((e) => String(e).toLowerCase()));
  const pool = skip.size ? team.filter((p) => !skip.has(p.email)) : team;
  const groups = peopleOptions(pool, query, suggested);
  const options = groups.flat;
  const locked = disabled || busy;
  const meOnTeam = team.find((p) => p.email === String(me || "").toLowerCase());

  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("touchstart", away); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-opt-${hi}`)?.scrollIntoView?.({ block: "nearest" });
  }, [hi, open, id]);

  const tell = (words, person = null) => { setMessage(words || ""); setResendFor(person); };
  const add = (email) => {
    const r = addPerson(emails, email, max);
    if (r.refused) { tell(r.refused); return; }
    if (r.value.length !== emails.length) { tell(""); onChange?.(r.value, { added: email }); }
  };
  const remove = (email) => {
    const r = removePerson(emails, email, min, minWords);
    if (r.refused) { tell(r.refused); return; }
    tell("");
    onChange?.(r.value, { removed: email });
  };
  const choose = (person) => {
    if (locked) return;
    if (!canPick(person)) { tell(invitedWords(person), person); return; }
    if (emails.includes(person.email)) remove(person.email); else add(person.email);
    setQuery("");
    setHi(0);
    inputRef.current?.focus();
  };
  const onKeyDown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Enter", "Escape", "Backspace"].includes(event.key)) return;
    if (event.key === "Backspace" && query) return;
    if (event.key !== "Backspace" || emails.length) event.preventDefault();
    if (event.key === "Escape" && !open) return;
    const next = fieldKey({ open, hi }, event.key, { options, value: emails, query, min, minWords });
    setOpen(next.state.open);
    setHi(next.state.hi);
    if (next.refused) tell(next.refused, next.refused === invitedWords(options[hi]) ? options[hi] : null);
    if (next.pick) { add(next.pick); setQuery(""); }
    if (next.remove) remove(next.remove);
  };

  const row = (person, i) => {
    const isPicked = emails.includes(person.email);
    const isMe = person.email === String(me || "").toLowerCase();
    return (
      <div
        key={person.email}
        id={`${id}-opt-${i}`}
        role="option"
        aria-selected={i === hi}
        aria-disabled={!canPick(person) || undefined}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setHi(i)}
        onClick={() => choose(person)}
        className={`grid min-h-11 w-full cursor-pointer grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] ${i === hi ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"} ${canPick(person) ? "" : "cursor-default opacity-55"}`}
      >
        <PersonAvatar person={person} />
        <span className="min-w-0">
          <span className={`block font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{shownName(person, team)}{isMe ? " (you)" : ""}</span>
          <span className={`block text-[12px] text-[var(--color-text-tertiary)] ${WORDS}`}>{person.invited ? "Invite pending · Resend" : person.role}</span>
        </span>
        <span className="whitespace-nowrap text-[11.5px] text-[var(--color-text-tertiary)]">
          {isPicked ? <Check aria-label="Picked" className="h-4 w-4 text-[var(--color-success-600)]" /> : person.invited ? "" : `${person.open} open`}
        </span>
      </div>
    );
  };

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{label}</label>
      <div
        onMouseDown={(event) => { if (event.target === event.currentTarget && !locked) { event.preventDefault(); inputRef.current?.focus(); setOpen(true); } }}
        className={`flex min-h-11 min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-1.5 focus-within:border-[var(--color-brand-500)] focus-within:ring-2 focus-within:ring-[var(--color-brand-100)] ${locked ? "opacity-70" : ""}`}
      >
        {picked.map((p) => <Chip key={p.email} person={p} team={team} disabled={locked} onRemove={() => remove(p.email)} />)}
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[hi] ? `${id}-opt-${hi}` : undefined}
          aria-label={`Add a person to ${label}`}
          disabled={locked}
          value={query}
          placeholder={placeholder || (picked.length ? "Add someone" : "Type a name")}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setHi(0); }}
          onKeyDown={onKeyDown}
          className="min-h-8 min-w-[8rem] flex-1 border-0 bg-transparent px-1.5 text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        />
      </div>
      {open && !locked && (
        <div id={listId} role="listbox" aria-label={`${label}: pick from the team`} className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[300px] overflow-auto rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1.5 shadow-[var(--shadow-lg)]">
          {groups.suggested.length > 0 && <div role="presentation" className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Suggested</div>}
          {groups.suggested.map((p, i) => row(p, i))}
          {groups.everyone.length > 0 && <div role="presentation" className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Everyone</div>}
          {groups.everyone.map((p, i) => row(p, groups.suggested.length + i))}
          {options.length === 0 && <p className={`px-2 py-2 text-[13px] text-[var(--color-text-tertiary)] ${WORDS}`}>{team.length === 0 ? "Nobody on the team yet." : `Nobody on the team matches "${query}".`}</p>}
        </div>
      )}
      {meOnTeam && canPick(meOnTeam) && !emails.includes(meOnTeam.email) && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={locked} onClick={() => add(meOnTeam.email)} className={`min-h-11 rounded-full border border-[var(--gray-300)] px-3 text-[12.5px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] disabled:opacity-50 ${FOCUS}`}>Assign to me</button>
        </div>
      )}
      {hint && !message && <p className={`text-[12px] text-[var(--color-text-tertiary)] ${WORDS}`}>{hint}</p>}
      <p role="status" aria-live="polite" className={`min-h-[1rem] text-[12px] text-[var(--color-error-700)] ${WORDS}`}>
        {message}
        {message && resendFor && onResend && (
          <button type="button" onClick={() => onResend(resendFor.email)} className={`ml-2 rounded font-semibold text-[var(--color-brand-700)] underline ${FOCUS}`}>Resend</button>
        )}
      </p>
    </div>
  );
}
