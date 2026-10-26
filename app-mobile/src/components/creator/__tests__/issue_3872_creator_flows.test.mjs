import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// #3872 walkthrough build — source contracts for the creator flows Seth
// approved. Fail before the build: the offer said "Decline and refund Host"
// with no Counter, Send interest alerted success after any resolved call, the
// agreement named an internal person and had no 18+ date of birth.
const root = path.resolve(import.meta.dirname, "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("#3872 the offer has Decline / Counter / Accept and counters through gig_counter_send", () => {
  const contract = read("app/creator/contract/[contractId].tsx");
  assert.match(contract, /label="Decline"/);
  assert.match(contract, /label="Accept offer"/);
  assert.match(contract, /Counter with a different price/);
  assert.match(contract, /creatorGigsService\.counter\(contractId, minor, counterNote\)/);
  assert.match(contract, /formatTimeLeft\(w\.contract\.state_deadline_at\)/);
  assert.doesNotMatch(contract, /Decline and refund Host|Version \$\{|replaceAll/);
});

test("#3872 Send interest shows refusals next to the field, success only after the write resolves", () => {
  const gig = read("app/creator/gig/[gigId].tsx");
  const send = gig.slice(gig.indexOf("const send = async"), gig.indexOf("if (gig.isLoading)"));
  assert.match(send, /await creatorGigsService\.sendInterest[\s\S]*Alert\.alert\('Interest sent'/);
  assert.match(send, /catch \(e\)[\s\S]*setError\(/);
  assert.doesNotMatch(send.slice(send.indexOf("catch")), /Interest sent/);
  assert.match(gig, /note_not_anonymous/);
  assert.match(gig, /parseMoneyInput\(price, pkg\.currency\)/);
  assert.match(gig, /Hidden until you’re hired/);
});

test("#3872 the agreement step collects an 18+ date of birth, the tax line, and no tax details", () => {
  const agreement = read("app/creator/setup/agreement.tsx");
  assert.match(agreement, /maximumDate=\{maxDate\}/);
  assert.match(agreement, /latestAdultBirthDate\(\)/);
  assert.match(agreement, /if \(!isAdult\(birthDate\)\)/);
  assert.match(agreement, /signAgreement\(version, birthDate\)/);
  assert.match(agreement, /You’re responsible for reporting and paying tax on what you earn\./);
  assert.doesNotMatch(agreement, /Seth|\bTIN\b|W-9/);
  assert.doesNotMatch(agreement, /tax ID|tax details|tax number/i);
  const profile = read("app/creator/setup/profile.tsx");
  assert.doesNotMatch(profile, /Date of birth · YYYY|<DateField/);
});

test("#3872 the shoot is picked inside the window and posts use a URL keyboard", () => {
  const parts = read("src/components/creator/contract/ContractSections.tsx");
  assert.match(parts, /<CalendarGrid start=\{day\} onPick=\{setDay\} minDate=\{window\?\.start/);
  assert.match(parts, /maxDate=\{window\?\.end/);
  assert.match(parts, /keyboardType="url"/);
  assert.match(parts, /autoCapitalize="none"/);
});
