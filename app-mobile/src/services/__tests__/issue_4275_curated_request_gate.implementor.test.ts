// Issue #4275 T-C8 — at most three curated calls in flight per device.
//
// FAILS-ON-REVERT: run generateCuratedExperiences without the gate and the last
// test fails; drop the `running < maxConcurrent` check and the first test fails;
// drop the `finally` and a rejection never frees its slot.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CURATED_MAX_CONCURRENT, createCuratedRequestGate } from "../curatedRequestGate.ts";

type Deferred = { resolve: (value: string) => void; reject: (error: Error) => void };

function rig() {
  const started: string[] = [];
  const open = new Map<string, Deferred>();
  const gate = createCuratedRequestGate<string>();
  const call = (key: string) =>
    gate.run(key, () =>
      new Promise<string>((resolve, reject) => {
        started.push(key);
        open.set(key, { resolve, reject });
      }));
  return { started, open, call, gate };
}
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

Deno.test("six calls: at most three at once, first in first out", async () => {
  assertEquals(CURATED_MAX_CONCURRENT, 3);
  const { started, open, call } = rig();
  const all = ["a", "b", "c", "d", "e", "f"].map(call);
  await flush();
  assertEquals(started, ["a", "b", "c"]);
  open.get("b")!.resolve("B");
  await flush();
  assertEquals(started, ["a", "b", "c", "d"]);
  open.get("a")!.resolve("A");
  open.get("c")!.resolve("C");
  await flush();
  assertEquals(started, ["a", "b", "c", "d", "e", "f"]);
  for (const key of ["d", "e", "f"]) open.get(key)!.resolve(key.toUpperCase());
  assertEquals(await Promise.all(all), ["A", "B", "C", "D", "E", "F"]);
});

Deno.test("identical requests in flight share one call, and a later one starts fresh", async () => {
  const { started, open, call } = rig();
  const first = call("same");
  const second = call("same");
  await flush();
  assertEquals(started, ["same"]);
  open.get("same")!.resolve("result");
  assertEquals(await first, "result");
  assertEquals(await second, "result");
  const third = call("same");
  await flush();
  assertEquals(started, ["same", "same"]);
  open.get("same")!.resolve("again");
  assertEquals(await third, "again");
});

Deno.test("a queued duplicate also shares", async () => {
  const { started, open, call } = rig();
  const running = ["a", "b", "c"].map(call);
  const queued = [call("d"), call("d")];
  await flush();
  for (const key of ["a", "b", "c"]) open.get(key)!.resolve(key);
  await Promise.all(running);
  await flush();
  assertEquals(started.filter((key) => key === "d").length, 1);
  open.get("d")!.resolve("D");
  assertEquals(await Promise.all(queued), ["D", "D"]);
});

Deno.test("a rejection reaches its caller and releases the slot", async () => {
  const { started, open, call } = rig();
  const a = call("a");
  call("b");
  call("c");
  call("d");
  await flush();
  open.get("a")!.reject(new Error("boom"));
  await assertRejects(() => a, Error, "boom");
  await flush();
  assert(started.includes("d"), "the queue moved on");
});

Deno.test("a task that throws synchronously also releases the slot", async () => {
  const gate = createCuratedRequestGate<string>(1);
  await assertRejects(() => gate.run("a", () => {
    throw new Error("sync");
  }), Error, "sync");
  assertEquals(await gate.run("b", () => Promise.resolve("ok")), "ok");
});

Deno.test("every app call to the function goes through the gate, with a source", () => {
  const service = Deno.readTextFileSync(new URL("../curatedExperiencesService.ts", import.meta.url));
  const generate = service.slice(service.indexOf("async generateCuratedExperiences"), service.indexOf("async warmPool"));
  assert(/curatedGate\.run\(JSON\.stringify\(body\)/.test(generate), "generate runs through the gate");
  const deck = Deno.readTextFileSync(new URL("../deckService.ts", import.meta.url));
  assert(/source: 'deck'/.test(deck), "the deck names itself");
  const map = Deno.readTextFileSync(new URL("../../hooks/useMapCards.ts", import.meta.url));
  assert(/source: 'map'/.test(map), "the map names itself");
});
