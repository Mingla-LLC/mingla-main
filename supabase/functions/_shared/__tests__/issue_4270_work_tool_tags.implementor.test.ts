// Issue #4270 Wave 1 — the work tools speak of a Send, Spend or Publish tag on
// a To do card, not a "Needs a person" column, and still let an older agent
// send status person (the server reads it as To do with the tag).
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkArguments } from "../teamAgentTools.ts";
import { findWorkTool } from "../teamAgentWorkTools.ts";

Deno.test("#4270 update_work: status person still accepted, described as a tag that stays in To do", () => {
  const tool = findWorkTool("update_work")!;
  assertMatch(
    tool.description,
    /set status person with the reason send, spend, publish or other, and stop: the card stays in To do with that Send, Spend or Publish tag, and only your person does that step and closes it\./,
  );
  assertMatch(tool.description, /A status change keeps the tag\./);
  assertMatch(tool.description, /To take the tag off \(person_reason null\), say why in reason/);
  assert(!/move a card that needs a person back/.test(tool.description));
  const ok = checkArguments(tool, {
    id: "00000000-0000-4000-8000-000000000001",
    expected_revision: 3,
    changes: { status: "person", person_reason: "send" },
  });
  assertEquals(ok.ok, true);
  // Taking the tag off is person_reason null with a reason; null reaches the server.
  const off = checkArguments(tool, {
    id: "00000000-0000-4000-8000-000000000001",
    expected_revision: 4,
    changes: { person_reason: null, reason: "The host sent it herself." },
  });
  assertEquals(off.ok, true);
});

Deno.test("#4270 close_work and push_back: never on a tagged card", () => {
  assertMatch(
    findWorkTool("close_work")!.description,
    /You never close a card with a Send, Spend or Publish tag \(a person does that step and closes it\)/,
  );
  assertMatch(
    findWorkTool("push_back")!.description,
    /A card with a Send, Spend or Publish tag is never yours to push back\./,
  );
});

Deno.test("#4270 list_work: due-date order and person as the tagged filter", () => {
  const tool = findWorkTool("list_work")!;
  assertMatch(
    tool.description,
    /To do and In progress earliest due first, then Done latest due first/,
  );
  const ok = checkArguments(tool, { status: ["person"] });
  assertEquals(ok.ok, true);
});
