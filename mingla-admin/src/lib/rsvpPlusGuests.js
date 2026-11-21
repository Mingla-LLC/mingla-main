// #4508 1.26: admin attendee view helpers for plus-one guests. A guest can have
// no name and no email (the invite goes to a phone number), so every field is
// null-safe and the row always has something to show.

function clean(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  const l = t.toLowerCase();
  return l === "null" || l === "undefined" ? null : t;
}

// The last four digits of a number, or null.
function lastFour(phone) {
  const digits = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
  return digits.length >= 4 ? digits.slice(-4) : null;
}

// One readable line per guest: "Name - Invited by Ada O. - Claimed - phone".
// #4508 N-5: until a guest claims the pass the server sends a neutral name
// (what the inviter typed, else "{Inviter first name}'s guest"), never the
// account a number matched, and the row reads "Ada's guest · 0199".
export function describePlusGuest(pg) {
  const g = pg && typeof pg === "object" ? pg : {};
  const invitedByName = clean(g.invitedByName);
  const email = clean(g.email);
  const phone = clean(g.phone);
  const base =
    clean(g.name) ||
    (invitedByName ? `${invitedByName.split(/\s+/)[0]}'s guest` : null) ||
    "Guest";
  const digits = g.claimed === true ? null : lastFour(phone);
  const name = digits ? `${base} · ${digits}` : base;
  return {
    name,
    invitedBy: invitedByName ? `Invited by ${invitedByName}` : null,
    claimed: g.claimed === true,
    claimLabel: g.claimed === true ? "Claimed" : "Not claimed",
    contact: email || phone || null,
  };
}

export function plusGuestSummary(plusGuests) {
  if (!Array.isArray(plusGuests)) return [];
  return plusGuests.map((pg) => {
    const d = describePlusGuest(pg);
    return [d.name, d.invitedBy, d.claimLabel, d.contact].filter(Boolean).join(" - ");
  });
}
