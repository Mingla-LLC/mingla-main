// Issue #3980 synced program, Wave 3 — tester adversarial checks of the one
// people field's rules (lib/peopleField.js), from angles the implementor's
// suite does not take: an empty team, a team of one, forty teammates, names
// before addresses (an address matches only from three letters), the start
// of a later word, letter case and spaces, invited teammates on every path
// (click, Enter, @), the last owner on every path (×, Enter on a picked row,
// Backspace), a field that takes one person, the keyboard at both ends of
// the list, and two teammates who share a name.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LAST_OWNER_WORDS,
  addPerson,
  avatarTone,
  canPick,
  fieldKey,
  invitedWords,
  mentionOptions,
  normalizeTeam,
  peopleOptions,
  personMatches,
  removePerson,
  shownName,
  toldWords,
} from "../lib/peopleField.js";

const TEAM = normalizeTeam([
  { email: "Seth@UseMingla.com", name: "Seth", role_label: "Owner", status: "active", open_cards: 3, me: true },
  { email: "debrahknyakundi@usemingla.com", name: "Debrah", role_label: "Sales and marketing", status: "active", open_cards: 2 },
  { email: "kunleakinwumi@usemingla.com", name: "Kunle Akin", role_label: "Sales and marketing", status: "active", open_cards: 4 },
  { email: "debrah.o@partner.test", name: "Debrah", role_label: "Founding partner", status: "active", open_cards: 0 },
  { email: "suvwe@usemingla.com", name: "Suvwe", role_label: "Founding partner", status: "invited", open_cards: 0 },
  { email: "", name: "No address" },
  { name: "Missing address" },
]);
const emails = (list: Array<{ email: string }>) => list.map((p) => p.email);

Deno.test("#3980 W3 tester R9: the team is cleaned — addresses lowercased, nobody without an address, invited marked", () => {
  assertEquals(TEAM.length, 5);
  assertEquals(TEAM[0].email, "seth@usemingla.com");
  assertEquals(TEAM.find((p) => p.email === "suvwe@usemingla.com")?.invited, true);
  assertEquals(TEAM.filter((p) => p.invited).length, 1);
  assertEquals(normalizeTeam(null as unknown as []), []);
});

Deno.test("#3980 W3 tester R9: an empty team, a team of one and forty teammates", () => {
  const none = peopleOptions([], "a", ["seth@usemingla.com"]);
  assertEquals(none.flat.length, 0);
  assertEquals(none.suggested.length, 0);
  const one = normalizeTeam([{ email: "solo@usemingla.com", name: "Solo", status: "active", me: true }]);
  assertEquals(emails(peopleOptions(one, "", ["solo@usemingla.com"]).suggested), ["solo@usemingla.com"]);
  assertEquals(peopleOptions(one, "", ["solo@usemingla.com"]).everyone.length, 0);
  const forty = normalizeTeam(Array.from({ length: 40 }, (_, i) => ({ email: `p${i}@usemingla.com`, name: `Person ${i}`, status: "active" })));
  const all = peopleOptions(forty, "", ["p39@usemingla.com", "p3@usemingla.com", "nobody@else.test"]);
  assertEquals(all.flat.length, 40, "every teammate is reachable, none twice");
  assertEquals(emails(all.suggested), ["p39@usemingla.com", "p3@usemingla.com"], "suggested keep their order; an unknown address is dropped");
  assertEquals(new Set(emails(all.flat)).size, 40);
  // The keyboard reaches the last of forty and stops there.
  let state = { open: false, hi: 0 };
  for (let i = 0; i < 60; i += 1) state = fieldKey(state, "ArrowDown", { options: all.flat, value: [] }).state;
  assertEquals(state.hi, 39);
  for (let i = 0; i < 60; i += 1) state = fieldKey(state, "ArrowUp", { options: all.flat, value: [] }).state;
  assertEquals(state.hi, 0);
});

Deno.test("#3980 W3 tester R9: names match from the start of any word; an address only from three letters", () => {
  const kunle = TEAM.find((p) => p.name === "Kunle Akin")!;
  const debrah = TEAM.find((p) => p.email === "debrahknyakundi@usemingla.com")!;
  assert(personMatches(kunle, "akin"), "the start of a later word matches");
  assert(personMatches(kunle, "  KUN "), "letter case and spaces do not matter");
  assert(!personMatches(kunle, "un"), "the middle of a word does not match");
  assert(!personMatches(debrah, "kn"), "two letters never match an address");
  assert(personMatches(debrah, "kny"), "three letters match inside the address");
  assertEquals(emails(peopleOptions(TEAM, "kn").flat), [], "two letters that only appear in addresses find nobody");
  assertEquals(emails(peopleOptions(TEAM, "deb").flat).sort(), ["debrah.o@partner.test", "debrahknyakundi@usemingla.com"]);
});

Deno.test("#3980 W3 tester R9: an invited teammate is greyed on every path — click, Enter and @", () => {
  const suvwe = TEAM.find((p) => p.invited)!;
  assertEquals(canPick(suvwe), false);
  assertEquals(invitedWords(suvwe), "Suvwe hasn’t accepted the invite yet. Resend it from Team and roles.");
  const options = peopleOptions(TEAM, "suv").flat;
  const enter = fieldKey({ open: true, hi: 0 }, "Enter", { options, value: [] });
  assertEquals(enter.pick, undefined, "Enter never picks an invited teammate");
  assertEquals(enter.refused, invitedWords(suvwe));
  assertEquals(emails(mentionOptions(TEAM, "suv")), [], "@ never offers an invited teammate");
  assertEquals(emails(mentionOptions(TEAM, "")).includes("suvwe@usemingla.com"), false);
});

Deno.test("#3980 W3 tester R9: a card keeps its last owner on every path — ×, Enter on the picked row, Backspace", () => {
  const value = ["kunleakinwumi@usemingla.com"];
  assertEquals(removePerson(value, "KunleAkinwumi@usemingla.com", 1), { value, refused: LAST_OWNER_WORDS });
  const options = peopleOptions(TEAM, "kunle").flat;
  const enter = fieldKey({ open: true, hi: 0 }, "Enter", { options, value, min: 1 });
  assertEquals(enter.remove, undefined);
  assertEquals(enter.refused, LAST_OWNER_WORDS);
  const back = fieldKey({ open: true, hi: 0 }, "Backspace", { options, value, min: 1, query: "" });
  assertEquals(back.remove, undefined);
  assertEquals(back.refused, LAST_OWNER_WORDS);
  // With two owners, each path removes exactly one.
  const two = ["kunleakinwumi@usemingla.com", "seth@usemingla.com"];
  assertEquals(removePerson(two, "seth@usemingla.com", 1).value, ["kunleakinwumi@usemingla.com"]);
  assertEquals(fieldKey({ open: true, hi: 0 }, "Enter", { options, value: two, min: 1 }).remove, "kunleakinwumi@usemingla.com");
  assertEquals(fieldKey({ open: true, hi: 0 }, "Backspace", { options, value: two, min: 1, query: "" }).remove, "seth@usemingla.com");
  // Backspace while a name is being typed edits the text, never a chip.
  assertEquals(fieldKey({ open: true, hi: 0 }, "Backspace", { options, value: two, min: 0, query: "ku" }).remove, undefined);
  // A field without a minimum can be emptied.
  assertEquals(removePerson(["seth@usemingla.com"], "seth@usemingla.com", 0).value, []);
});

Deno.test("#3980 W3 tester R9: adding is by address, never twice, never past the limit", () => {
  assertEquals(addPerson(["seth@usemingla.com"], " SETH@usemingla.com ").value, ["seth@usemingla.com"]);
  const one = addPerson(["seth@usemingla.com"], "kunleakinwumi@usemingla.com", 1);
  assertEquals(one.value, ["seth@usemingla.com"]);
  assertEquals(one.refused, "Only one person can be picked here. Remove them first.");
  assertEquals(addPerson(Array.from({ length: 10 }, (_, i) => `p${i}@x.test`), "p10@x.test").refused, "At most 10 people.");
  assertEquals(addPerson([], "").value, []);
});

Deno.test("#3980 W3 tester R9: the keyboard does nothing surprising when the list is closed or empty", () => {
  assertEquals(fieldKey({ open: false, hi: 0 }, "Enter", { options: TEAM, value: [] }).pick, undefined, "Enter on a closed list picks nobody");
  assertEquals(fieldKey({ open: true, hi: 0 }, "Enter", { options: [], value: [] }).pick, undefined, "Enter with no match picks nobody");
  assertEquals(fieldKey({ open: true, hi: 3 }, "Escape", { options: TEAM, value: [] }).state, { open: false, hi: 0 });
  assertEquals(fieldKey({ open: false, hi: 5 }, "ArrowDown", { options: TEAM, value: [] }).state, { open: true, hi: 0 }, "opening starts at the top");
  assertEquals(fieldKey({ open: true, hi: 0 }, "Backspace", { options: TEAM, value: [], min: 1 }).refused, undefined, "an empty field has nothing to remove");
});

Deno.test("#3980 W3 tester R9: two teammates who share a name are never mistaken for each other", () => {
  const a = TEAM.find((p) => p.email === "debrahknyakundi@usemingla.com")!;
  const b = TEAM.find((p) => p.email === "debrah.o@partner.test")!;
  assert(shownName(a, TEAM) !== shownName(b, TEAM));
  assertEquals(shownName(a, TEAM), "Debrah <debrahknyakundi@usemingla.com>");
  assertEquals(shownName(TEAM[0], TEAM), "Seth", "a unique name shows alone");
  assertEquals(toldWords(["debrah.o@partner.test", "seth@usemingla.com"], TEAM), "Will tell: Debrah <debrah.o@partner.test>, Seth");
  assertEquals(toldWords([], TEAM), "Nobody will be told. Type @ and a name.");
  assertEquals(avatarTone("Seth@UseMingla.com"), avatarTone("seth@usemingla.com"), "the same person always gets the same colour");
});
