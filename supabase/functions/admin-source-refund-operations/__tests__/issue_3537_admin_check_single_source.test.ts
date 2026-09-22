// Issue #3537 — both admin refund functions authorised through their own query
// against `admin_users`, and BOTH were permanently closed to every caller:
//
//   * operations matched `.eq("user_id", …)`. `admin_users` has no `user_id`
//     column (id, email, role, status, invited_by, created_at, accepted_at), so
//     PostgREST errored and the gate read false for everyone, always.
//   * action matched `.eq("id", authUser.id)`. All five `admin_users` rows are
//     orphaned — there is no FK to `auth.users` — so that never matched either.
//
// Every other admin surface authorises through `is_admin_user()`, which matches
// on EMAIL via `auth.uid()`. Three mechanisms; two unsatisfiable.
//
// These tests drive the REAL resolvers against a fake client. A source grep for
// "is_admin_user" would pass while the call was unreachable, or while its result
// was ignored — only running it proves the gate both opens and closes.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { resolveAdminRequestContext } from "../index.ts";
import { resolveAdminActionContext } from "../../admin-source-refund-action/index.ts";

const AUTH = "Bearer test-token";
const USER = { id: "63835860-0000-4000-8000-000000000000", email: "seth@usemingla.com" };

// A fake matching only the surface the resolvers touch. `rpcCalls` records what
// the gate actually asked the database, so a resolver that stops calling
// is_admin_user fails even if it still returns the right boolean by accident.
function fakeClient(opts: { user: unknown; isAdmin: unknown }) {
  const rpcCalls: string[] = [];
  const tableQueries: string[] = [];
  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user } }) },
    rpc: (name: string) => {
      rpcCalls.push(name);
      return Promise.resolve({ data: opts.isAdmin });
    },
    from: (table: string) => {
      tableQueries.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: null }),
      };
      return chain;
    },
  };
  return { client, rpcCalls, tableQueries };
}

Deno.test("#3537 operations: an active admin is authorised via is_admin_user", async () => {
  const f = fakeClient({ user: USER, isAdmin: true });
  const ctx = await resolveAdminRequestContext(
    AUTH,
    (() => f.client) as never,
  );
  assertEquals(ctx.isActiveAdmin, true, "an active admin must be authorised");
  assert(
    f.rpcCalls.includes("is_admin_user"),
    "the gate must ask the database's own admin check, not roll its own",
  );
});

Deno.test("#3537 operations: a non-admin is refused", async () => {
  const f = fakeClient({ user: USER, isAdmin: false });
  const ctx = await resolveAdminRequestContext(AUTH, (() => f.client) as never);
  assertEquals(ctx.isActiveAdmin, false, "a non-admin must be refused");
});

Deno.test("#3537 operations: a null answer is refused, not treated as truthy", async () => {
  const f = fakeClient({ user: USER, isAdmin: null });
  const ctx = await resolveAdminRequestContext(AUTH, (() => f.client) as never);
  assertEquals(ctx.isActiveAdmin, false, "a null rpc result must NOT open the gate");
});

Deno.test("#3537 operations: an unauthenticated caller is refused", async () => {
  const f = fakeClient({ user: null, isAdmin: true });
  const ctx = await resolveAdminRequestContext(AUTH, (() => f.client) as never);
  assertEquals(ctx.isActiveAdmin, false, "no auth user must be refused");
});

Deno.test("#3537 action: an active admin is authorised and audited by real identity", async () => {
  const f = fakeClient({ user: USER, isAdmin: true });
  const ctx = await resolveAdminActionContext(AUTH, (() => f.client) as never);
  assertEquals(ctx.isActiveAdmin, true);
  assertEquals(
    ctx.userEmail,
    USER.email,
    "p_actor_email must be the authenticated identity, not an admin_users row",
  );
  assert(f.rpcCalls.includes("is_admin_user"));
});

Deno.test("#3537 action: a non-admin is refused", async () => {
  const f = fakeClient({ user: USER, isAdmin: false });
  const ctx = await resolveAdminActionContext(AUTH, (() => f.client) as never);
  assertEquals(ctx.isActiveAdmin, false);
});

Deno.test("#3537 neither resolver queries admin_users directly any more", async () => {
  const a = fakeClient({ user: USER, isAdmin: true });
  await resolveAdminRequestContext(AUTH, (() => a.client) as never);
  const b = fakeClient({ user: USER, isAdmin: true });
  await resolveAdminActionContext(AUTH, (() => b.client) as never);
  assertEquals(
    [...a.tableQueries, ...b.tableQueries].filter((t) => t === "admin_users"),
    [],
    "a direct admin_users query is the bug this issue exists to end",
  );
});
