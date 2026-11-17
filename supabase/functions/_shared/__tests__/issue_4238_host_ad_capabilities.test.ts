// Issue #4238 W4b §2 — capabilities: each answer comes from the same
// authority the action uses, and says who to ask.
//
// @invariant I-4238-CAPABILITY-SAME-AUTHORITY
//   owner: supabase/functions/_shared/hostAdCapabilities.ts
//   rule: plan/launch/pause/end call ad_can_host_action with that action,
//         change_live calls it with 'fund' (as host-ad-campaign does), and
//         top_up/withdraw call biz_can_manage_payments_for_brand (as
//         ad-credit does). The UI never gets a restated rule.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HOST_AD_CAPABILITY_AUTHORITY,
  hostAdCapabilities,
} from "../hostAdCapabilities.ts";

const BRAND = "brand-1";
// The migration's matrix (20280803004238): what the RPCs would answer.
const MATRIX: Record<string, Record<string, boolean>> = {
  owner: {
    plan: true,
    launch: true,
    pause: true,
    fund: true,
    end: true,
    pay: true,
  },
  brand_admin: {
    plan: true,
    launch: true,
    pause: true,
    fund: false,
    end: false,
    pay: true,
  },
  marketing_manager: {
    plan: true,
    launch: false,
    pause: false,
    fund: false,
    end: false,
    pay: false,
  },
  finance_manager: {
    plan: false,
    launch: false,
    pause: false,
    fund: true,
    end: false,
    pay: true,
  },
  removed: {
    plan: false,
    launch: false,
    pause: false,
    fund: false,
    end: false,
    pay: false,
  },
};

function db(role: string, calls: string[] = []) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push(name === "ad_can_host_action" ? `ad:${args.p_action}` : name);
      if (args.p_brand_id !== BRAND) {
        return Promise.resolve({ data: false, error: null });
      }
      const row = MATRIX[role];
      const data = name === "ad_can_host_action"
        ? row[String(args.p_action)] === true
        : name === "biz_can_manage_payments_for_brand"
        ? row.pay
        : false;
      return Promise.resolve({ data, error: null });
    },
    from(table: string) {
      const rows: Record<string, Record<string, unknown>> = {
        brands: {
          "brand-1": { account_id: "owner-1" },
          "brand-2": { account_id: "owner-2" },
        },
        creator_accounts: {
          "owner-1": { display_name: "Tolu" },
          "owner-2": { display_name: "Other Owner" },
        },
      };
      let id = "";
      const builder = {
        select: () => builder,
        eq: (_c: string, value: string) => {
          id = value;
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({ data: rows[table]?.[id] ?? null, error: null }),
      };
      return builder;
    },
  };
}

Deno.test("SC-B2: for every role, capabilities match what the endpoints allow", async () => {
  for (const role of Object.keys(MATRIX)) {
    const caps = await hostAdCapabilities(db(role), BRAND, "user");
    const row = MATRIX[role];
    assertEquals(caps.plan.allowed, row.plan, `${role} plan`);
    assertEquals(caps.launch.allowed, row.launch, `${role} launch`);
    assertEquals(caps.pause.allowed, row.pause, `${role} pause`);
    assertEquals(caps.change_live.allowed, row.fund, `${role} change_live`);
    assertEquals(caps.end.allowed, row.end, `${role} end`);
    assertEquals(caps.top_up.allowed, row.pay, `${role} top_up`);
    assertEquals(caps.withdraw.allowed, row.pay, `${role} withdraw`);
  }
});

Deno.test("brand admin: launch and pause yes, end no with who to ask", async () => {
  const caps = await hostAdCapabilities(db("brand_admin"), BRAND, "user");
  assertEquals(caps.launch, { allowed: true });
  assertEquals(caps.pause, { allowed: true });
  assertEquals(caps.end, {
    allowed: false,
    ask_role: "brand_owner",
    ask_name: "Tolu",
  });
});

Deno.test("adversarial: a removed member gets all false; ask_name never comes from another brand", async () => {
  const caps = await hostAdCapabilities(db("removed"), BRAND, "user");
  assert(Object.values(caps).every((answer) => answer.allowed === false));
  assert(Object.values(caps).every((answer) => answer.ask_name === "Tolu"));
  const other = await hostAdCapabilities(db("owner"), "brand-2", "user");
  assert(Object.values(other).every((answer) => answer.ask_name !== "Tolu"));
});

Deno.test("an RPC error fails closed", async () => {
  const broken = {
    ...db("owner"),
    rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
  };
  const caps = await hostAdCapabilities(broken, BRAND, "user");
  assert(Object.values(caps).every((answer) => answer.allowed === false));
});

Deno.test("same authority as the actions: host-ad-campaign and ad-credit", async () => {
  const calls: string[] = [];
  await hostAdCapabilities(db("owner", calls), BRAND, "user");
  assertEquals(
    calls.sort(),
    [
      "ad:end",
      "ad:fund",
      "ad:launch",
      "ad:pause",
      "ad:plan",
      "biz_can_manage_payments_for_brand",
    ].sort(),
  );
  const hac = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  // The endpoint's own mapping: change_live needs 'fund', pause 'pause', end 'end', launch 'launch'.
  assert(/action === "change_live"\s*\?\s*"fund"/.test(hac));
  assert(/action === "pause"\s*\?\s*"pause"/.test(hac));
  assert(/action === "end" \|\| action === "cancel"\s*\?\s*"end"/.test(hac));
  assert(/action === "launch"\s*\?\s*"launch"/.test(hac));
  assertEquals(HOST_AD_CAPABILITY_AUTHORITY.change_live, "fund");
  const credit = await Deno.readTextFile(
    new URL("../../ad-credit/index.ts", import.meta.url),
  );
  assert(credit.includes('"biz_can_manage_payments_for_brand"'));
  assert(hac.includes("capabilities,"));
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assert(plan.includes("await hostAdCapabilities(db, brandId, actor.id)"));
});
