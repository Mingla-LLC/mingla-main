// Issue #3980 — a note on a card or a post. Type @ and a name to tell a
// teammate; the list opens above the box (MentionBox, the same list as the
// people field). Each pick carries the teammate's email and its mention
// text, unique across the team, so two people with one name are never mixed
// up; the line under the box says who will be told.
import { useState } from "react";
import { keepPicksInText, mentionTokenFor, mentionedEmails } from "../../lib/opsModel";
import { mentionOptions, toldWords } from "../../lib/peopleField";
import { MentionBox } from "../people/MentionBox";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function NoteBox({ team = [], disabled, busy, onPost, label = "Note", postLabel = "Post note" }) {
  const [body, setBody] = useState("");
  // Each pick carries the teammate's email and its mention text, unique across
  // the team. Every edit drops picks whose mention text left the note, so a
  // name typed back by hand never tells anyone.
  const [picks, setPicks] = useState([]);
  const typed = body.match(/(?:^|\s)@([\w.-]*)$/);
  const options = typed ? mentionOptions(team, typed[1]) : [];
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
      <MentionBox
        value={body}
        label={label}
        disabled={disabled || busy}
        onChange={(e) => edit(e.target.value)}
        options={options}
        team={team}
        tokenFor={(p) => mentionTokenFor(p, team)}
        onPick={pick}
        told={toldWords(mentionedEmails(picks, body.trim()), team)}
      />
      <button type="button" disabled={disabled || busy || !body.trim()} onClick={submit} className={`min-h-11 self-end rounded-full bg-[var(--color-brand-700)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--color-brand-600)] disabled:opacity-50 ${FOCUS}`}>{busy ? "Posting…" : postLabel}</button>
    </div>
  );
}
