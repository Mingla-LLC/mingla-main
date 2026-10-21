// Issue #3980 (R9) — the one people field, as pure rules: who matches what
// was typed, the order the list shows, who can be picked, adding and
// removing by email (a card keeps its last owner), the keyboard, and the
// words a note's mentions tell. Screens render; this file decides.

const lower = (value) => String(value || "").trim().toLowerCase();

// Six token colours for the initial on a chip; the same person always gets
// the same one.
export const AVATAR_TONES = [
  "bg-[var(--color-brand-600)]",
  "bg-[var(--color-info-600)]",
  "bg-[var(--color-success-600)]",
  "bg-[var(--color-warning-600)]",
  "bg-[var(--color-error-600)]",
  "bg-[var(--gray-600)]",
];

export function avatarTone(email) {
  const text = lower(email);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function initialOf(name) {
  const letter = String(name || "").trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

/**
 * The people the server sent, cleaned: email, name, role words, invited,
 * workload, me. One row per address: a person listed twice (say as owner and
 * as teammate) is shown once, so "you" never appears twice.
 */
export function normalizeTeam(people) {
  const seen = new Map();
  for (const p of Array.isArray(people) ? people : []) {
    if (!p || typeof p.email !== "string" || !p.email.trim()) continue;
    const row = {
      email: lower(p.email),
      name: String(p.name || p.display_name || p.email).trim(),
      role: String(p.role_label || p.role || "").trim(),
      invited: p.status === "invited",
      open: Number.isFinite(Number(p.open_cards)) ? Number(p.open_cards) : 0,
      me: !!p.me,
    };
    const had = seen.get(row.email);
    if (!had) seen.set(row.email, row);
    else seen.set(row.email, { ...had, me: had.me || row.me, invited: had.invited && row.invited });
  }
  return [...seen.values()];
}

/** One list of addresses, in order, each once (me first when given). */
export function suggestedPeople(...lists) {
  const out = [];
  for (const list of lists) {
    for (const email of Array.isArray(list) ? list : [list]) {
      const e = lower(email);
      if (e && !out.includes(e)) out.push(e);
    }
  }
  return out;
}

/** Does a person's name (not the address) match what was typed? */
export function nameMatches(person, query) {
  const q = lower(query);
  if (!q) return true;
  const words = lower(person?.name).split(/[\s.\-_]+/).filter(Boolean);
  return words.some((w) => w.startsWith(q)) || lower(person?.name).startsWith(q);
}

/**
 * The name a person is shown by. When another teammate has the same name,
 * the address is added so the two are never mistaken for each other.
 */
export function shownName(person, team) {
  const name = String(person?.name || person?.email || "").trim();
  const email = lower(person?.email);
  const clash = (Array.isArray(team) ? team : []).some((p) => lower(p.email) !== email && lower(p.name) === lower(name));
  return clash && email ? `${name} <${email}>` : name;
}

/**
 * Does a person match what was typed? The start of any word of the name;
 * the address only once three or more characters are typed.
 */
export function personMatches(person, query) {
  const q = lower(query);
  if (!q) return true;
  if (nameMatches(person, q)) return true;
  return q.length >= 3 && lower(person?.email).includes(q);
}

/**
 * The list under the field: Suggested first (in their order), then Everyone,
 * each person once. While typing, people whose name matches come before
 * people who match only by address, so "kun" then Enter picks Kunle even
 * when someone else's address has "kun" in it.
 */
export function peopleOptions(team, query, suggested = []) {
  const people = normalizeOnce(team);
  const matched = people.filter((p) => personMatches(p, query));
  const byName = matched.filter((p) => nameMatches(p, query));
  const byAddress = matched.filter((p) => !nameMatches(p, query));
  const order = suggestedPeople(suggested);
  const sug = order.map((email) => byName.find((p) => lower(p.email) === email)).filter(Boolean);
  const rest = [...byName.filter((p) => !order.includes(lower(p.email))), ...byAddress];
  return { suggested: sug, everyone: rest, flat: [...sug, ...rest] };
}

function normalizeOnce(team) {
  const seen = new Set();
  return (Array.isArray(team) ? team : []).filter((p) => {
    const e = lower(p?.email);
    if (!e || seen.has(e)) return false;
    seen.add(e);
    return true;
  });
}

export function canPick(person) {
  return !!person && !person.invited;
}

export function invitedWords(person) {
  return `${person?.name || "This person"} hasn’t accepted the invite yet. Resend it from Team and roles.`;
}

export const LAST_OWNER_WORDS = "A card always keeps one owner. Add someone else first, then remove this one.";

/** Add one person by email: never twice, never past max. */
export function addPerson(value, email, max = 10) {
  const list = (Array.isArray(value) ? value : []).map(lower);
  const e = lower(email);
  if (!e || list.includes(e)) return { value: list, refused: null };
  if (list.length >= max) return { value: list, refused: max === 1 ? "Only one person can be picked here. Remove them first." : `At most ${max} people.` };
  return { value: [...list, e], refused: null };
}

/** Remove one person by email: a field with a minimum keeps its last ones. */
export function removePerson(value, email, min = 0, minWords = LAST_OWNER_WORDS) {
  const list = (Array.isArray(value) ? value : []).map(lower);
  const e = lower(email);
  if (!list.includes(e)) return { value: list, refused: null };
  if (list.length <= min) return { value: list, refused: minWords };
  return { value: list.filter((x) => x !== e), refused: null };
}

/**
 * The keyboard on the field's input. Returns the next state and what to do:
 * { state, pick?: email, remove?: email, refused?: words }.
 */
export function fieldKey(state, key, { options = [], value = [], query = "", min = 0, minWords = LAST_OWNER_WORDS } = {}) {
  const s = { open: !!state?.open, hi: Number.isInteger(state?.hi) ? state.hi : 0 };
  const last = Math.max(0, options.length - 1);
  switch (key) {
    case "ArrowDown":
      return { state: { open: true, hi: s.open ? Math.min(last, s.hi + 1) : 0 } };
    case "ArrowUp":
      return { state: { open: true, hi: Math.max(0, s.hi - 1) } };
    case "Enter": {
      if (!s.open || !options[s.hi]) return { state: s };
      const p = options[s.hi];
      if (!canPick(p)) return { state: s, refused: invitedWords(p) };
      if (value.map(lower).includes(lower(p.email))) {
        const r = removePerson(value, p.email, min, minWords);
        return r.refused ? { state: s, refused: r.refused } : { state: { open: true, hi: s.hi }, remove: lower(p.email) };
      }
      return { state: { open: true, hi: 0 }, pick: lower(p.email) };
    }
    case "Escape":
      return { state: { open: false, hi: 0 } };
    case "Backspace": {
      if (query || value.length === 0) return { state: s };
      const lastEmail = value[value.length - 1];
      const r = removePerson(value, lastEmail, min, minWords);
      return r.refused ? { state: s, refused: r.refused } : { state: s, remove: lower(lastEmail) };
    }
    default:
      return { state: s };
  }
}

/** Mentions: who can be named with @ (never someone who has not accepted). */
export function mentionOptions(team, typed) {
  return (Array.isArray(team) ? team : []).filter((p) => canPick(p) && personMatches(p, typed));
}

/**
 * The line under a note: "Will tell: Debrah <debrah@a>, Kunle" from the
 * emails the note will tell (picked from the list, still in the text).
 * Nobody → "Nobody will be told. Type @ and a name."
 */
export function toldWords(emails, team) {
  const people = Array.isArray(team) ? team : [];
  const names = (Array.isArray(emails) ? emails : []).map((email) => {
    const p = people.find((x) => lower(x.email) === lower(email));
    return p ? shownName(p, people) : lower(email);
  });
  return names.length ? `Will tell: ${names.join(", ")}` : "Nobody will be told. Type @ and a name.";
}
