// Issue #3980 — a note on a card. Type @ and a name to tell a teammate.
import { useState } from "react";
import { keepPicksInText, mentionMatches, mentionTokenFor, mentionedEmails } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function NoteBox({ team = [], disabled, busy, onPost }) {
  const [body, setBody] = useState("");
  // Each pick carries the teammate's email and its mention text, unique across
  // the team. Every edit drops picks whose mention text left the note, so a
  // name typed back by hand never tells anyone.
  const [picks, setPicks] = useState([]);
  const typed = body.match(/(?:^|\s)@([\w.-]*)$/);
  const options = typed ? mentionMatches(team, typed[1]) : [];
  const pick = (p) => {
    const token = mentionTokenFor(p, team);
    setBody(body.replace(/@([\w.-]*)$/, `${token} `));
    setPicks((list) => [...list, { email: p.email, name: p.name, token }]);
  };
  const edit = (next) => {
    setBody(next);
    setPicks((list) => keepPicksInText(list, next));
  };
  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    const ok = await onPost(text, mentionedEmails(picks, text));
    if (ok) { setBody(""); setPicks([]); }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <textarea
        value={body}
        maxLength={2000}
        disabled={disabled || busy}
        onChange={(e) => edit(e.target.value)}
        aria-label="Note"
        placeholder="Write a note. Type @ to tell a teammate."
        className={`min-h-[72px] w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] ${FOCUS}`}
      />
      {options.length > 0 && (
        <ul aria-label="Teammates to mention" className="flex min-w-0 flex-wrap gap-1">
          {options.map((p) => (
            <li key={p.email}>
              <button type="button" onClick={() => pick(p)} aria-label={`Mention ${p.name}, ${p.email}`} className={`min-h-11 max-w-full rounded-lg bg-[var(--gray-100)] px-3 text-left text-[13px] [overflow-wrap:anywhere] hover:bg-[var(--gray-200)] ${FOCUS}`}>{mentionTokenFor(p, team)} <span className="text-[var(--color-text-tertiary)]">{p.email}</span></button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" disabled={disabled || busy || !body.trim()} onClick={submit} className={`min-h-11 self-start rounded-lg border border-[var(--gray-300)] px-4 text-[13px] font-semibold hover:bg-[var(--gray-50)] disabled:opacity-50 ${FOCUS}`}>{busy ? "Posting…" : "Post"}</button>
    </div>
  );
}
