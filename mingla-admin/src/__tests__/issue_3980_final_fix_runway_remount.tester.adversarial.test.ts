// Issue #3980 final fix — tester adversarial suite for "Back to runway returns
// focus to the runway row".
//
// The implementor's suite pins the source text. This one RUNS the real
// useOpsRunway and useOpsPoll code (cut from the shipped files) on a tiny
// stand-in for React's hooks, and attacks the remount itself:
//   TA-1  a remount whose new answer is slow (never arrives) still shows the
//         last rows on its FIRST render, not a loading state, so the page can
//         focus the row that opened the panel
//   TA-2  the kept rows belong to one signed-in person: a different person
//         remounting sees nothing of them
//   TA-3  a remount whose refresh fails keeps the rows (the list shows them,
//         not "Couldn't load the runway list")
//   TA-4  a newer answer replaces the kept rows; a remount shows the newer one
//
// FAILS ON REVERT: drop `cache: RUNWAY_CACHE` from useOpsRunway, or drop the
// cache seeding / cache write in useOpsPoll — TA-1, TA-3 and TA-4 fail.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, SRC));

function cut(text: string, start: string): string {
  const at = text.indexOf(start);
  if (at < 0) throw new Error(`missing: ${start}`);
  const end = text.indexOf("\n}\n", at);
  return text.slice(at, end + 2).replace(/^export /, "");
}

const pollSource = cut(read("hooks/useOpsWork.js"), "export function useOpsPoll(");
const calendar = read("hooks/useOpsCalendar.js");
const cacheLine = calendar.match(/^const RUNWAY_CACHE = .*$/m)?.[0] ?? "";
const runwaySource = cut(calendar, "export function useOpsRunway(");

// A tiny hook runtime: one component instance, effects after each render,
// state changes re-render on a microtask.
type Slot = { v?: unknown; current?: unknown; deps?: unknown[]; fn?: unknown; cleanup?: (() => void) | void };
function makeRuntime() {
  let current: { slots: Slot[]; i: number; effects: Array<() => void>; rerender: () => void; alive: boolean } | null = null;
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const slot = () => { const c = current!; const k = c.i++; return (c.slots[k] ??= {}); };
  const hooks = {
    useState(init: unknown) {
      const s = slot(); const inst = current!;
      if (!("v" in s)) s.v = typeof init === "function" ? (init as () => unknown)() : init;
      const set = (u: unknown) => { s.v = typeof u === "function" ? (u as (p: unknown) => unknown)(s.v) : u; if (inst.alive) queueMicrotask(inst.rerender); };
      return [s.v, set];
    },
    useRef(v: unknown) { const s = slot(); if (!("current" in s)) s.current = v; return s; },
    useCallback(fn: unknown, deps: unknown[]) { const s = slot(); if (!same(s.deps, deps)) { s.fn = fn; s.deps = deps; } return s.fn; },
    useEffect(fn: () => (() => void) | void, deps?: unknown[]) {
      const s = slot(); const inst = current!;
      if (!deps || !same(s.deps, deps)) {
        s.deps = deps;
        inst.effects.push(() => { if (typeof s.cleanup === "function") s.cleanup(); s.cleanup = fn(); });
      }
    },
  };
  function mount<T>(hook: () => T) {
    const inst = { slots: [] as Slot[], i: 0, effects: [] as Array<() => void>, alive: true, rerender: () => {}, renders: [] as T[] };
    inst.rerender = () => {
      if (!inst.alive) return;
      current = inst; inst.i = 0; inst.effects = [];
      const out = hook();
      current = null;
      inst.renders.push(out);
      for (const run of inst.effects) run();
    };
    inst.rerender();
    return {
      first: () => inst.renders[0],
      last: () => inst.renders[inst.renders.length - 1],
      unmount: () => { inst.alive = false; for (const s of inst.slots) if (typeof s.cleanup === "function") s.cleanup(); },
    };
  }
  return { hooks, mount };
}

const fakeWindow = { addEventListener() {}, removeEventListener() {} };
const fakeDocument = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };

// Builds useOpsRunway from the shipped source, with its imports stood in.
function buildRunway(runtime: ReturnType<typeof makeRuntime>, auth: { email: string }, ops: { fetchRunwayReport: () => Promise<unknown> }) {
  const factory = new Function(
    "useState", "useRef", "useCallback", "useEffect", "useAuth", "ops", "todayIso", "window", "document", "navigator", "setInterval", "clearInterval",
    `${pollSource}\n${cacheLine}\n${runwaySource}\nreturn useOpsRunway;`,
  );
  return factory(
    runtime.hooks.useState, runtime.hooks.useRef, runtime.hooks.useCallback, runtime.hooks.useEffect,
    () => ({ access: { email: auth.email } }), ops, () => "2026-10-19",
    fakeWindow, fakeDocument, { onLine: true }, () => 0, () => {},
  ) as () => { data: { rows: Array<{ title: string }> } | null; loading: boolean; error: unknown };
}

const settle = async () => { for (let k = 0; k < 10; k += 1) await new Promise((r) => setTimeout(r, 0)); };
const never = () => new Promise<never>(() => {});
const rowsOf = (titles: string[]) => ({ rows: titles.map((title) => ({ title })), counts: {} });

Deno.test("TA-1 a remount whose answer is slow shows the last rows on its first render", async () => {
  const rt = makeRuntime();
  const auth = { email: "ana@test.local" };
  const ops = { fetchRunwayReport: () => Promise.resolve(rowsOf(["Supper Club", "Jazz Night"])) };
  const useOpsRunway = buildRunway(rt, auth, ops);
  const a = rt.mount(useOpsRunway);
  assertEquals(a.first().loading, true, "the very first visit has nothing yet");
  await settle();
  assertEquals(a.last().data?.rows.map((r) => r.title), ["Supper Club", "Jazz Night"]);
  a.unmount(); // the event panel opens; the runway list goes away

  ops.fetchRunwayReport = never; // Back to runway: the server is slow now
  const b = rt.mount(useOpsRunway);
  assertEquals(b.first().loading, false, "Back to runway must not start from a loading state");
  assertEquals(b.first().data?.rows.map((r) => r.title), ["Supper Club", "Jazz Night"]);
  b.unmount();
});

Deno.test("TA-2 the kept rows are one person's: another person remounting sees none of them", async () => {
  const rt = makeRuntime();
  const auth = { email: "ana@test.local" };
  const ops = { fetchRunwayReport: () => Promise.resolve(rowsOf(["Ana's private row"])) };
  const useOpsRunway = buildRunway(rt, auth, ops);
  const a = rt.mount(useOpsRunway);
  await settle();
  a.unmount();
  auth.email = "ben@test.local";
  ops.fetchRunwayReport = never;
  const b = rt.mount(useOpsRunway);
  assertEquals(b.first().data, null);
  assertEquals(b.first().loading, true);
  b.unmount();
});

Deno.test("TA-3 a remount whose refresh fails keeps the rows on screen", async () => {
  const rt = makeRuntime();
  const auth = { email: "cy@test.local" };
  const ops = { fetchRunwayReport: () => Promise.resolve(rowsOf(["Art Walk"])) };
  const useOpsRunway = buildRunway(rt, auth, ops);
  const a = rt.mount(useOpsRunway);
  await settle();
  a.unmount();
  ops.fetchRunwayReport = () => Promise.reject(new Error("network down"));
  const b = rt.mount(useOpsRunway);
  await settle();
  const after = b.last();
  // RunwayList shows the error card only when there is an error AND no data.
  assert(after.data && after.data.rows.length === 1, "the rows must survive a failed refresh");
  assertEquals(after.loading, false);
  b.unmount();
});

Deno.test("TA-4 a newer answer replaces the kept rows", async () => {
  const rt = makeRuntime();
  const auth = { email: "dee@test.local" };
  let answer = rowsOf(["Old row"]);
  const ops = { fetchRunwayReport: () => Promise.resolve(answer) };
  const useOpsRunway = buildRunway(rt, auth, ops);
  const a = rt.mount(useOpsRunway);
  await settle();
  a.unmount();
  answer = rowsOf(["New row"]);
  const b = rt.mount(useOpsRunway);
  await settle();
  assertEquals(b.last().data?.rows.map((r) => r.title), ["New row"]);
  b.unmount();
  ops.fetchRunwayReport = never;
  const c = rt.mount(useOpsRunway);
  assertEquals(c.first().data?.rows.map((r) => r.title), ["New row"], "a remount shows the newest answer, not the first");
  c.unmount();
});
