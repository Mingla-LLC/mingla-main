// #3988 — support and product alerts reach teammates through the existing
// outbox pipeline. Drives the REAL drain (processGeneric) and the REAL v2
// dispatcher (dispatchV2) with recording fakes, plus the pure allowlists.
//
// FAILS-ON-REVERT: removing the #3988 entries from notifyV2.ts (deep link,
// push gate, email button) or from notify-outbox-drain (address resolution)
// turns these red.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { processGeneric, resolveIssue3720Contact } from "../../notify-outbox-drain/index.ts";
import { dispatchV2, type MinimalClient, providerSafePayload } from "../notifyV2.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import { resolveOneSignalApp } from "../push-utils.ts";
import {
  ISSUE_3988_ALERT_CATEGORIES,
  issue3988DeepLinkValid,
  issue3988EmailCta,
  issue3988PushAllowed,
} from "../issue3988SupportAlerts.ts";

const SERVICE_KEY = "issue-3988-service-role";
const SUPABASE_URL = "http://127.0.0.1:54321";
const USER_ID = "39880000-0000-4000-8000-000000000001";
const TICKET = "39880000-0000-4000-8000-0000000000a1";
const MESSAGE = "39880000-0000-4000-8000-0000000000b1";
const THREAD = "39880000-0000-4000-8000-0000000000c1";
const SIGNAL = "39880000-0000-4000-8000-0000000000d1";
const ADMIN = "https://admin.usemingla.com/#/community-support";
const TEAM_EMAIL = "teammate.3988@example.test";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

const CATEGORIES: Record<string, AnyRecord> = {
  "business.support_ticket_reply": { default_channels: ["inapp", "push", "email"] },
  "admin.support_staff_ticket": { default_channels: ["inapp", "email"] },
  "admin.support_assigned": { default_channels: ["inapp", "email"] },
  "admin.support_overdue": { default_channels: ["inapp", "email"] },
  "admin.product_signal_new": { default_channels: ["inapp", "push", "email"] },
  "admin.product_signal_assigned": { default_channels: ["inapp", "email"] },
  "admin.product_signal_progress": { default_channels: ["inapp"] },
};

interface World {
  outboxUpdates: AnyRecord[];
  dispatchBodies: AnyRecord[];
  dispatchResults: AnyRecord[];
  resend: AnyRecord[];
  onesignal: AnyRecord[];
  inbox: AnyRecord[];
  rpcs: string[];
}

const newWorld = (): World => ({
  outboxUpdates: [],
  dispatchBodies: [],
  dispatchResults: [],
  resend: [],
  onesignal: [],
  inbox: [],
  rpcs: [],
});

function drainAdmin(world: World) {
  return {
    from(table: string) {
      const builder: AnyRecord = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        update(values: AnyRecord) {
          if (table === "notification_outbox") world.outboxUpdates.push(values);
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
      return builder;
    },
    rpc(fn: string) {
      world.rpcs.push(fn);
      if (fn === "issue_3720_notification_email") {
        return Promise.resolve({ data: TEAM_EMAIL.toUpperCase(), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function dispatchClient(world: World): MinimalClient {
  return {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: (_col: string, key: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: CATEGORIES[key]
                    ? { key, is_transactional: true, urgency: "high", active: true, ...CATEGORIES[key] }
                    : null,
                  error: null,
                }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
        insert(row: AnyRecord) {
          if (table === "notifications") world.inbox.push(row);
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            select: () => ({
              single: () => Promise.resolve({ data: { id: `39880000-0000-4000-8000-${String(world.inbox.length).padStart(12, "0")}` }, error: null }),
            }),
          });
        },
        update: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    },
    rpc(fn: string) {
      return Promise.resolve({ data: fn === "can_send" ? true : null, error: null });
    },
  } as unknown as MinimalClient;
}

async function withEnv(fn: () => Promise<void>) {
  const values: Record<string, string> = {
    RESEND_API_KEY: "re_test_3988",
    DENO_TESTING: "1",
    ONESIGNAL_BUSINESS_APP_ID: "business-app-3988",
    ONESIGNAL_BUSINESS_REST_API_KEY: "business-key-3988",
    ONESIGNAL_APP_ID: "consumer-app-3988",
    ONESIGNAL_REST_API_KEY: "consumer-key-3988",
  };
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(values)) Deno.env.set(k, v);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

async function send(world: World, row: AnyRecord): Promise<boolean> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/functions/v1/notify-dispatch")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      world.dispatchBodies.push(body);
      const result = await dispatchV2(dispatchClient(world), {
        user_id: body.user_id ?? null,
        contact: body.contact ?? null,
        category_key: body.category_key,
        payload: body.payload ?? {},
        idempotency_key: body.idempotency_key,
        deep_link: body.deep_link ?? null,
      });
      world.dispatchResults.push(result);
      return new Response(JSON.stringify(result), { status: result.success ? 200 : 400 });
    }
    if (url.includes("api.resend.com/emails")) {
      world.resend.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ id: `resend-${world.resend.length}` }), { status: 200 });
    }
    if (url.includes("onesignal.com")) {
      world.onesignal.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ id: "os-3988", recipients: 1 }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    return await processGeneric(drainAdmin(world), row, SUPABASE_URL, SERVICE_KEY);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const replyRow = (push: boolean): AnyRecord => ({
  id: `outbox-reply-${push}`,
  category_key: "business.support_ticket_reply",
  user_id: USER_ID,
  contact: null,
  brand_id: null,
  attempts: 0,
  idempotency_key: `business.support_ticket_reply:${MESSAGE}:${USER_ID}`,
  payload: {
    ticket_id: TICKET,
    message_id: MESSAGE,
    subject: "Payout question",
    priority: "high",
    push,
    deep_link: `mingla-business://support/${TICKET}`,
    admin_link: `${ADMIN}?tab=support&ticket=${TICKET}`,
  },
});

Deno.test("#3988 a Host reply emails a teammate who is away, with an Admin button and no push", async () => {
  await withEnv(async () => {
    const world = newWorld();
    assertEquals(await send(world, replyRow(false)), true);
    assertEquals(world.rpcs, ["issue_3720_notification_email"]);
    assertEquals(world.dispatchBodies[0].contact, TEAM_EMAIL);
    assertEquals(world.resend.length, 1);
    assertEquals(world.onesignal.length, 0, "away teammates get no push");
    const email = world.resend[0];
    assertEquals(email.to, [TEAM_EMAIL]);
    assertEquals(email.subject, "A Host replied on a Mingla support ticket");
    assertStringIncludes(email.text, "Subject: Payout question");
    assertStringIncludes(email.text, "Priority: High");
    assertStringIncludes(email.text, `Ticket: ${TICKET}`);
    assertStringIncludes(email.html, ">Open in Mingla Admin</a>");
    assertStringIncludes(email.html.replaceAll("&amp;", "&"), `${ADMIN}?tab=support&ticket=${TICKET}`);
    assertEquals(world.inbox[0].type, "business.support_ticket_reply");
    assertEquals(world.inbox[0].deep_link, `mingla-business://support/${TICKET}`);
    assertEquals(world.outboxUpdates.at(-1)?.status, "done");
  });
});

Deno.test("#3988 an available teammate also gets a Host-app push carrying IDs only", async () => {
  await withEnv(async () => {
    const world = newWorld();
    assertEquals(await send(world, replyRow(true)), true);
    assertEquals(world.resend.length, 1);
    assertEquals(world.onesignal.length, 1);
    const push = world.onesignal[0];
    assertEquals(push.app_id, "business-app-3988");
    assertEquals(push.data.ticket_id, TICKET);
    assertEquals(push.data.message_id, MESSAGE);
    assertEquals("subject" in push.data, false);
    assertEquals("admin_link" in push.data, false);
  });
});

Deno.test("#3988 a new product signal pushes only when high or urgent, through the Host app", async () => {
  await withEnv(async () => {
    for (const push of [true, false]) {
      const world = newWorld();
      const ok = await send(world, {
        id: `outbox-signal-${push}`,
        category_key: "admin.product_signal_new",
        user_id: USER_ID,
        contact: null,
        attempts: 0,
        idempotency_key: `admin.product_signal_new:${SIGNAL}:${USER_ID}:${push}`,
        payload: {
          signal_id: SIGNAL,
          title: "Brand page shows blank",
          signal_kind: "bug",
          priority: push ? "urgent" : "normal",
          push,
          deep_link: `${ADMIN}?tab=product&signal=${SIGNAL}`,
        },
      });
      assertEquals(ok, true);
      assertEquals(world.resend.length, 1);
      assertEquals(world.onesignal.length, push ? 1 : 0);
      if (push) assertEquals(world.onesignal[0].app_id, "business-app-3988");
      assertStringIncludes(world.resend[0].text, "Type: Bug");
    }
  });
});

Deno.test("#3988 a forged link is refused before anything is sent", async () => {
  await withEnv(async () => {
    const world = newWorld();
    const ok = await send(world, {
      id: "outbox-forged",
      category_key: "admin.support_staff_ticket",
      user_id: USER_ID,
      contact: null,
      attempts: 0,
      idempotency_key: `admin.support_staff_ticket:${THREAD}:${USER_ID}`,
      payload: { thread_id: THREAD, subject: "x", priority: "normal", deep_link: "https://evil.example/#/x" },
    });
    assertEquals(ok, false);
    assertEquals(world.dispatchResults[0].reason, "deep_link_invalid");
    assertEquals(world.resend.length + world.onesignal.length + world.inbox.length, 0);
  });
});

Deno.test("#3988 every alert category resolves its email at send time (except in-app only)", async () => {
  for (const category of ISSUE_3988_ALERT_CATEGORIES) {
    const calls: string[] = [];
    const contact = await resolveIssue3720Contact({
      rpc: (name: string) => {
        calls.push(name);
        return Promise.resolve({ data: TEAM_EMAIL, error: null });
      },
    }, { category_key: category, user_id: USER_ID, contact: null });
    if (category === "admin.product_signal_progress") {
      assertEquals(contact, null, category);
      assertEquals(calls.length, 0, category);
    } else {
      assertEquals(contact, TEAM_EMAIL, category);
    }
  }
});

Deno.test("#3988 deep links, push gate and email button follow the allowlist", () => {
  assert(issue3988DeepLinkValid("business.support_ticket_reply", `mingla-business://support/${TICKET}`, { ticket_id: TICKET }));
  assertEquals(issue3988DeepLinkValid("business.support_ticket_reply", `mingla-business://support/${THREAD}`, { ticket_id: TICKET }), false);
  assert(issue3988DeepLinkValid("admin.support_overdue", `${ADMIN}?tab=support&thread=${THREAD}`));
  assert(issue3988DeepLinkValid("admin.support_overdue", `${ADMIN}?tab=product&signal=${SIGNAL}`));
  assertEquals(issue3988DeepLinkValid("admin.product_signal_new", `${ADMIN}?tab=support&thread=${THREAD}`), false);
  assertEquals(issue3988DeepLinkValid("admin.support_assigned", `${ADMIN}?tab=support&thread=${THREAD}&x=1`), false);

  assertEquals(issue3988PushAllowed("business.support_ticket_reply", {}), false);
  assertEquals(issue3988PushAllowed("business.support_ticket_reply", { push: "true" }), false);
  assertEquals(issue3988PushAllowed("admin.product_signal_new", { push: true }), true);
  assertEquals(issue3988PushAllowed("business.support_new_ticket", {}), true, "other categories unchanged");

  assertEquals(issue3988EmailCta("business.support_ticket_reply", null, { admin_link: "https://evil.example/#/x" }), undefined);
  assertEquals(issue3988EmailCta("admin.team_mention", `${ADMIN}?tab=support&thread=${THREAD}`, {}), undefined);
  assertEquals(issue3988EmailCta("admin.support_assigned", `${ADMIN}?tab=support&thread=${THREAD}`, {})?.url, `${ADMIN}?tab=support&thread=${THREAD}`);

  assertEquals(resolveOneSignalApp("admin.product_signal_new"), "business");
  assertEquals(resolveOneSignalApp("business.support_ticket_reply"), "business");
  assertEquals(resolveOneSignalApp("friend_request_received"), "consumer");
});

Deno.test("#3988 provider payloads and copy never carry a body or problem statement", () => {
  const leaky = {
    ticket_id: TICKET, message_id: MESSAGE, thread_id: THREAD, signal_id: SIGNAL,
    item_id: THREAD, kind: "internal_thread", event: "linked",
    subject: "Payout question", title: "Brand page shows blank", priority: "urgent",
    body: "PRIVATE HOST MESSAGE BODY", details: "PRIVATE STAFF DETAILS",
    problem_statement: "PRIVATE PROBLEM STATEMENT", admin_link: `${ADMIN}?tab=support&ticket=${TICKET}`,
  };
  for (const category of ISSUE_3988_ALERT_CATEGORIES) {
    const safe = JSON.stringify(providerSafePayload(category, leaky));
    for (const forbidden of ["PRIVATE", "Payout question", "Brand page", "admin.usemingla"]) {
      assertEquals(safe.includes(forbidden), false, `${category} leaked ${forbidden}`);
    }
    const rendered = JSON.stringify(renderCategoryMessage(category, leaky));
    assertEquals(rendered.includes("PRIVATE"), false, `${category} copy leaked a body`);
    assert(renderCategoryMessage(category, leaky).email.subject.length > 0, category);
  }
  assertEquals(
    renderCategoryMessage("admin.product_signal_progress", { ...leaky, issue_number: 4012 }).push.body,
    "The product signal you raised is linked to GitHub issue #4012.",
  );
  const lead = renderCategoryMessage("admin.support_overdue", {
    kind: "product_signal", audience: "lead", title: "Blank page", priority: "high",
    due_at: "2027-11-23T10:00:00Z", item_id: SIGNAL,
  });
  assertEquals(lead.email.subject, "Mingla product signal update overdue for 24 hours");
  assertStringIncludes(lead.email.body, "Update was due: Tue, 23 Nov 2027 10:00:00 GMT");
});
