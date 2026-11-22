// #4541 R1.6 (SC-8, edge order): account deletion erases the person's brand
// form answers BEFORE anything else in the Explorer purge, while the login (and
// with it orders.buyer_user_id and event_rsvps.user_id) still exists, and an
// erase error fails the deletion closed. The SQL erase itself is proved by the
// M-A pg17 suite (T-4).
// MINGLA-INVARIANT: I-4541-ERASE-BEFORE-LOGIN-REMOVAL | issue #4541 | delete-user calls brand_form_erase_person first in purgeExplorerSideData, which runs before the auth user is deleted, and any erase error throws so the deletion fails closed (this suite).
//
// FAILS-ON-REVERT: deleting the eraseBrandFormAnswers call fails T-ORDER; swallowing the
// erase error fails T-CLOSED.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { purgeExplorerSideData } from "../accountDeletionSides.ts";

const UID = "45410000-0000-4000-8000-0000000004a1";

function client(erase: { data: unknown; error: { message: string } | null }) {
  const ops: string[] = [];
  const from = (table: string) => {
    let op = "select";
    const b = {
      select: () => b,
      delete: () => {
        op = "delete";
        return b;
      },
      update: () => {
        op = "update";
        return b;
      },
      eq: () => b,
      in: () => b,
      // deno-lint-ignore no-explicit-any
      then: (resolve: (v: any) => unknown) => {
        ops.push(`${op}:${table}`);
        return Promise.resolve({ data: op === "select" ? [] : null, error: null }).then(resolve);
      },
    };
    return b;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    ops.push(`rpc:${fn}:${String(args.p_user_id)}`);
    return Promise.resolve(erase);
  };
  // deno-lint-ignore no-explicit-any
  return { c: { from, rpc } as any, ops };
}

Deno.test("T-ORDER the brand form erase runs first, for this user, before every other purge write", async () => {
  const { c, ops } = client({ data: { responses: 2, links: 1, requestSends: 0, checkoutStash: 0 }, error: null });
  await purgeExplorerSideData(c, UID);
  assertEquals(ops[0], `rpc:brand_form_erase_person:${UID}`);
  assert(ops.some((o) => o === "update:profiles"), "the identity scrub still runs");
});

Deno.test("T-CLOSED SC-8 an erase error throws and nothing else is purged", async () => {
  const { c, ops } = client({ data: null, error: { message: "boom" } });
  await assertRejects(() => purgeExplorerSideData(c, UID), Error, "Account deletion could not be completed");
  assertEquals(ops, [`rpc:brand_form_erase_person:${UID}`]);
});

Deno.test("T-WIRING delete-user purges the Explorer side before it removes the login", async () => {
  const src = await Deno.readTextFile(new URL("../../delete-user/index.ts", import.meta.url));
  const purge = src.indexOf("await purgeExplorerSideData(adminClient, userId);");
  const removal = src.indexOf("await deleteAuthUserIfReady(", purge);
  assert(purge > 0 && removal > purge, "purge (and with it the erase) precedes the login removal");
});
