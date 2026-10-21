// Issue #3980 synced program, Wave 3 rework 3 — the Admin fixes after the
// third Wave 3 test:
//   STEPS3  after a person finished or declined a promised date's steps, the
//           save never says Mingla adds them "nearer the date"
//   DEAD3   the unused WorkList.jsx is gone and nothing imports it
//           (RunwayBar.jsx, LaunchPlanner.jsx and PeoplePicker.jsx stay:
//           earlier tests still read them)
import {
  assertEquals,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { expectedSavedWords } from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);

Deno.test("#3980 W3 rework 3 STEPS3: steps a person already closed are never promised again", () => {
  const closed = expectedSavedWords({ auto_steps: true, steps: { added: 0, closed: 0, redated: 0, open: 0, settled: 1 } });
  assertEquals(closed, "Saved. It’s on the Calendar. Its steps were already finished or declined in Work, so none were added.");
  assertNotMatch(closed, /nearer the date/);
  // Nothing made and nothing closed yet: the far-off words stay.
  assertEquals(expectedSavedWords({ auto_steps: true, steps: { added: 0, closed: 0, redated: 0, open: 0, settled: 0 } }),
    "Saved. It’s on the Calendar. No steps are needed yet; Mingla adds them nearer the date.");
  // An open step still wins over a closed one.
  assertEquals(expectedSavedWords({ auto_steps: true, steps: { added: 0, closed: 0, redated: 0, open: 1, settled: 1 } }),
    "Saved. It’s on the Calendar; its steps were already in Work.");
});

Deno.test("#3980 W3 rework 3 DEAD3: WorkList.jsx is gone and nothing imports it", () => {
  let exists = true;
  try { Deno.statSync(new URL("components/ops/WorkList.jsx", SRC)); } catch { exists = false; }
  assertEquals(exists, false);
  const stack = [new URL("./", SRC)];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of Deno.readDirSync(dir)) {
      if (e.isDirectory) { if (e.name !== "__tests__") stack.push(new URL(e.name + "/", dir)); continue; }
      if (!/\.(jsx?|tsx?)$/.test(e.name)) continue;
      assertNotMatch(Deno.readTextFileSync(new URL(e.name, dir)), /\bWorkList\b/, e.name);
    }
  }
});
