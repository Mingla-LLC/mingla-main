// #4640 — the operator chooses the post-send journey from the form builder,
// and the resulting confirmation tasks stay ordinary Work cards.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { WORK_SHOW, workFilter } from "../lib/workViews.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("#4640 the form builder offers the three plain-language next steps", () => {
  const tab = read("src/components/forms/AfterSendTab.jsx");
  const builder = read("src/components/forms/FormBuilder.jsx");
  const service = read("src/services/formsService.js");
  for (const label of ["Show a thank-you", "Let them book a call", "Send them to a link"]) {
    assert.match(tab, new RegExp(label));
  }
  assert.match(tab, /schedulers\.filter\(\(x\) => x\.audience === def\.audience\)/);
  assert.match(tab, /Their name, email, phone and answers are carried securely/);
  assert.match(builder, /const common = \{[^\n]*schedulers,/);
  assert.match(builder, /getSchedulerProfiles\(\)\.catch\(\(\) => \[\]\)/);
  assert.match(builder, /<AfterSendTab \{\.\.\.common\} \/>/);
  assert.match(service, /rpc\("admin_scheduler_profiles"\)/);
});

test("#4640 form emails also choose calendars from the scheduler registry", () => {
  const automation = read("src/components/forms/AutomationsTab.jsx");
  assert.match(automation, /schedulers \|\| \[\]/);
  assert.match(automation, /profile\.audience === audience/);
  assert.match(automation, /value: `scheduler:\$\{profile\.key\}`/);
  assert.doesNotMatch(automation, /const DESTS =/);
});

test("#4640 Demo calls is a view of existing Work cards, not another card model", () => {
  assert.deepEqual(WORK_SHOW.find((option) => option.value === "demo_calls"), {
    value: "demo_calls",
    label: "Demo calls",
  });
  const ordinary = [
    { id: "booked", title: "Confirm Ada's demo", auto_kind: "demo_booked", status: "doing" },
    { id: "hour", title: "Call Ada before the demo", auto_kind: "demo_hour", status: "todo" },
    { id: "other", title: "Prepare report", auto_kind: null, status: "todo" },
  ];
  assert.deepEqual(workFilter(ordinary, { show: "demo_calls" }).map((card) => card.id), ["booked", "hour"]);
});
