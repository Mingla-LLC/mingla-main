// Issue #4571 (design v5) — the record panel's section jump links: which
// sections a record has, in body order, and which one is active while the
// panel body scrolls. Pure: no React.

/** The jump links for one record, only for sections it shows. */
export function jumpSections({ isHosts, hasAttention }) {
  return [
    hasAttention && { key: "attention", label: "Needs attention" },
    { key: "followup", label: "Follow-up" },
    !isHosts && { key: "deal", label: "Deal" },
    { key: "contacts", label: isHosts ? "Contacts" : "Handle and reach" },
    { key: "work", label: "Work" },
    isHosts && { key: "demos", label: "Demos" },
    { key: "calls", label: "Calls" },
    isHosts && { key: "plan", label: "Plan" },
    isHosts && { key: "onmingla", label: "On Mingla" },
    isHosts && { key: "team", label: "Team" },
    { key: "details", label: "Details" },
    { key: "activity", label: "Activity" },
  ].filter(Boolean);
}

/**
 * The active section: the last one whose top has reached the top of the
 * scroll box (`offsets` are each section's distance from that top, in body
 * order). At the very bottom the last section is active.
 */
export function activeJump(offsets, { atBottom = false, slack = 24 } = {}) {
  const list = Array.isArray(offsets) ? offsets.filter((o) => o && Number.isFinite(o.top)) : [];
  if (!list.length) return "";
  if (atBottom) return list[list.length - 1].key;
  let active = list[0].key;
  for (const o of list) if (o.top <= slack) active = o.key;
  return active;
}
