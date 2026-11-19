// MINGLA-INVARIANT: I-4238-CAPABILITY-SAME-AUTHORITY | issue #4238 | plan/launch/pause/end call ad_can_host_action with that action, change_live calls it with 'fund' (as host-ad-campaign does), top_up calls biz_can_manage_payments_for_brand and withdraw calls ad_can_withdraw_credit (as ad-credit does). The UI never gets a restated rule.
// Issue #4238 W4b §2 — capabilities: each answer comes from the same
// authority the action uses, and says who to ask.
//
// @invariant I-4238-CAPABILITY-SAME-AUTHORITY
//   owner: supabase/functions/_shared/hostAdCapabilities.ts
//   rule: plan/launch/pause/end call ad_can_host_action with that action,
//         change_live calls it with 'fund' (as host-ad-campaign does),
//         top_up calls biz_can_manage_payments_for_brand and withdraw calls
//         ad_can_withdraw_credit (as ad-credit does). The UI never gets a
//         restated rule.
//
// #4238 ads roles (20281118014238), updated on purpose: a brand admin now
// funds (so change_live is true) and withdraw is owner and Finance only.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  adCreditWithdrawAuthority,
  HOST_AD_CAPABILITY_AUTHORITY,
  hostAdCapabilities,
} from "../hostAdCapabilities.ts";

const BRAND = "brand-1";
// The migrations' matrix (20280803004238 + 20281118014238): what the RPCs
// would answer. pay = biz_can_manage_payments_for_brand, withdraw =
// ad_can_withdraw_credit.
const MATRIX: Record<string, Record<string, boolean>> = {
  owner: {
    plan: true,
    launch: true,
    pause: true,
    fund: true,
    end: true,
    pay: true,
    withdraw: true,
  },
  brand_admin: {
    plan: true,
    launch: true,
    pause: true,
    fund: true,
    end: false,
    pay: true,
    withdraw: false,
  },
  marketing_manager: {
    plan: true,
    launch: false,
    pause: false,
    fund: false,
    end: false,
    pay: false,
    withdraw: false,
  },
  finance_manager: {
    plan: false,
    launch: false,
    pause: false,
    fund: true,
    end: false,
    pay: true,
    withdraw: true,
  },
  removed: {
    plan: false,
    launch: false,
    pause: false,
    fund: false,
    end: false,
    pay: false,
    withdraw: false,
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
        : name === "ad_can_withdraw_credit"
        ? row.withdraw
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
    assertEquals(caps.withdraw.allowed, row.withdraw, `${role} withdraw`);
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
      "ad_can_withdraw_credit",
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
  assert(credit.includes("adCreditWithdrawAuthority(supabase, brandId, userId)"));
  assert(hac.includes("capabilities,"));
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assert(plan.includes("await hostAdCapabilities(db, brandId, actor.id)"));
});

Deno.test("ads roles: an admin tops up, launches and changes a live budget but cannot withdraw", async () => {
  const caps = await hostAdCapabilities(db("brand_admin"), BRAND, "user");
  assertEquals(caps.top_up, { allowed: true });
  assertEquals(caps.launch, { allowed: true });
  assertEquals(caps.change_live, { allowed: true });
  assertEquals(caps.withdraw, {
    allowed: false,
    ask_role: "brand_owner",
    ask_name: "Tolu",
  });
});

Deno.test("ads roles: Finance tops up and withdraws but cannot launch", async () => {
  const caps = await hostAdCapabilities(db("finance_manager"), BRAND, "user");
  assertEquals(caps.top_up.allowed, true);
  assertEquals(caps.withdraw.allowed, true);
  assertEquals(caps.launch.allowed, false);
});

Deno.test("ad-credit withdraw authority: refused for an admin, allowed for the owner and Finance", async () => {
  assertEquals(
    await adCreditWithdrawAuthority(db("brand_admin"), BRAND, "user"),
    "denied",
  );
  assertEquals(
    await adCreditWithdrawAuthority(db("owner"), BRAND, "user"),
    "allowed",
  );
  assertEquals(
    await adCreditWithdrawAuthority(db("finance_manager"), BRAND, "user"),
    "allowed",
  );
  assertEquals(
    await adCreditWithdrawAuthority(db("owner"), "brand-2", "user"),
    "denied",
  );
  const broken = {
    rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
  };
  assertEquals(await adCreditWithdrawAuthority(broken, BRAND, "user"), "error");
  const throws = { rpc: () => Promise.reject(new Error("down")) };
  assertEquals(await adCreditWithdrawAuthority(throws, BRAND, "user"), "error");
});

Deno.test("ad-credit: quote_withdraw and apply_withdraw run the withdraw authority; top-up does not", async () => {
  const credit = await Deno.readTextFile(
    new URL("../../ad-credit/index.ts", import.meta.url),
  );
  const section = (start: string, end: string): string => {
    const from = credit.indexOf(start);
    assert(from >= 0, `missing ${start}`);
    const to = credit.indexOf(end, from + start.length);
    return credit.slice(from, to >= 0 ? to : undefined);
  };
  const quote = section('if (action === "quote_withdraw")', "const creditCents");
  assert(quote.includes("withdrawAuthorityDenied("));
  const apply = section('if (action === "apply_withdraw")', "const creditCents");
  assert(apply.includes("withdrawAuthorityDenied(supabase, brandId, user.id)"));
  const helper = section("async function withdrawAuthorityDenied(", "\n}\n");
  assert(helper.includes("adCreditWithdrawAuthority(supabase, brandId, userId)"));
  assert(helper.includes('"forbidden"') && helper.includes("403"));
  const topUp = section('if (action === "start_top_up")', 'if (action === "apply_withdraw")');
  assert(!topUp.includes("withdrawAuthorityDenied"));
  // get_wallet returns the capabilities the Ads credit card reads.
  const wallet = section('if (action === "get_wallet")', 'action === "get_receipt"');
  assert(wallet.includes("hostAdCapabilities(supabase, brandId, user.id)"));
  assert(wallet.includes("capabilities,"));
});
