// Issue #4389 — brand delete closes payment accounts first, in order, with
// compensation, and is idempotent.
// MINGLA-INVARIANT: I-4389-DELETE-CLOSES-PROVIDERS | issue #4389 | runBrandDelete runs blockers -> balance -> Paystack off -> Stripe delete -> finish; a Stripe refusal switches Paystack back on and deletes nothing.
// FAILS-ON-REVERT: removing the Paystack re-activate in runBrandDelete fails
// test 3; treating an unknown balance as zero fails test 5.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { type BrandDeleteDeps, runBrandDelete } from "../../_shared/brandDelete.ts";

const BRAND = "43890000-0000-4000-b000-0000000000d1";
const OWNER = "43890000-0000-4000-a000-0000000000d1";

function deps(over: Partial<BrandDeleteDeps> & { log?: string[]; draft?: boolean; held?: unknown[]; stripe?: string | null; paystack?: string | null } = {}) {
  const log = over.log ?? [];
  const d: BrandDeleteDeps = {
    readBrand: () => Promise.resolve({ name: "Night Owl", account_id: OWNER, deleted_at: null }),
    blockers: () => {
      log.push("blockers");
      return Promise.resolve({
        blockers: over.held ?? [],
        is_draft: over.draft ?? false,
        stripe_account_id: over.stripe === undefined ? "acct_1" : over.stripe,
        paystack_subaccount_code: over.paystack === undefined ? "ACCT_P" : over.paystack,
      });
    },
    stripeBalance: () => { log.push("balance"); return Promise.resolve([{ currency: "USD", amount_minor: 0 }]); },
    paystackSetActive: (_c, active) => { log.push(active ? "paystack_on" : "paystack_off"); return Promise.resolve(); },
    stripeDeleteAccount: () => { log.push("stripe_del"); return Promise.resolve(); },
    finish: (_b, _u, mode) => { log.push(`finish:${mode}`); return Promise.resolve({ ok: true }); },
    audit: () => Promise.resolve(),
  };
  const { log: _l, draft: _d, held: _h, stripe: _s, paystack: _p, ...fns } = over;
  Object.assign(d, fns);
  return { d, log };
}

Deno.test("#4389 1 — happy path order", async () => {
  const { d, log } = deps();
  const r = await runBrandDelete(d, { brandId: BRAND, userId: OWNER, mode: "delete", confirmName: " night owl " });
  assertEquals(r.status, 200);
  assertEquals(r.body.stripe, "closed");
  assertEquals(r.body.paystack, "switched_off");
  assertEquals(log, ["blockers", "balance", "paystack_off", "stripe_del", "finish:delete"]);
});

Deno.test("#4389 2 — blocked: money owed or a balance on the account; nothing is touched", async () => {
  const a = deps({ held: [{ code: "tickets_sold", count: 2 }] });
  const r1 = await runBrandDelete(a.d, { brandId: BRAND, userId: OWNER, mode: "delete", confirmName: "Night Owl" });
  assertEquals(r1.status, 409);
  assertEquals(a.log, ["blockers"]);
  const b = deps({ stripeBalance: () => Promise.resolve([{ currency: "USD", amount_minor: 1250 }]) });
  const r2 = await runBrandDelete(b.d, { brandId: BRAND, userId: OWNER, mode: "delete", confirmName: "Night Owl" });
  assertEquals(r2.status, 409);
  assertEquals((r2.body.blockers as Array<{ code: string }>)[0].code, "payment_account_balance");
  assert(!b.log.includes("paystack_off") && !b.log.some((l) => l.startsWith("finish")));
});

Deno.test("#4389 3 — Stripe refuses: Paystack is switched back on, nothing deleted, classified reason only", async () => {
  const { d, log } = deps({
    stripeDeleteAccount: () => Promise.reject({ code: "account_invalid", message: "acct_1 has a negative balance" }),
  });
  const r = await runBrandDelete(d, { brandId: BRAND, userId: OWNER, mode: "delete", confirmName: "Night Owl" });
  assertEquals(r.status, 409);
  assertEquals(r.body, { error: "payment_account_close_refused", reason_code: "account_invalid" });
  assertEquals(log, ["blockers", "balance", "paystack_off", "paystack_on"]);
});

Deno.test("#4389 4 — resource_missing is success; already deleted is success (R-11)", async () => {
  const { d, log } = deps({ stripeDeleteAccount: () => Promise.reject({ code: "resource_missing" }) });
  const r = await runBrandDelete(d, { brandId: BRAND, userId: OWNER, mode: "delete", confirmName: "Night Owl" });
  assertEquals(r.status, 200);
  assert(log.includes("finish:delete"));
  const gone = deps({ readBrand: () => Promise.resolve({ name: "Night Owl", account_id: OWNER, deleted_at: "2026-11-11T00:00:00Z" }) });
  const r2 = await runBrandDelete(gone.d, { brandId: BRAND, userId: OWNER, mode: "delete", confirmName: "x" });
  assertEquals(r2.status, 200);
  assertEquals(r2.body.already_deleted, true);
});

Deno.test("#4389 5 — an unknown balance is never zero", async () => {
  const { d, log } = deps({ stripeBalance: () => Promise.reject(new Error("timeout")) });
  const r = await runBrandDelete(d, { brandId: BRAND, userId: OWNER, mode: "delete", confirmName: "Night Owl" });
  assertEquals(r.status, 409);
  assertEquals(r.body.reason_code, "balance_unavailable");
  assert(!log.includes("stripe_del"));
});

Deno.test("#4389 6 — discard_draft: owner only, no name, refuses a non-draft", async () => {
  const notDraft = deps({ draft: false });
  assertEquals((await runBrandDelete(notDraft.d, { brandId: BRAND, userId: OWNER, mode: "discard_draft" })).body.error, "not_a_draft");
  const draft = deps({ draft: true, stripe: null, paystack: null });
  const r = await runBrandDelete(draft.d, { brandId: BRAND, userId: OWNER, mode: "discard_draft" });
  assertEquals(r.status, 200);
  assertEquals(draft.log, ["blockers", "finish:discard_draft"]);
  const other = deps();
  assertEquals((await runBrandDelete(other.d, { brandId: BRAND, userId: "someone-else", mode: "discard_draft" })).status, 403);
});

Deno.test("#4389 7 — the typed name must match", async () => {
  const { d, log } = deps();
  const r = await runBrandDelete(d, { brandId: BRAND, userId: OWNER, mode: "delete", confirmName: "Night" });
  assertEquals(r.status, 400);
  assertEquals(log, []);
});
