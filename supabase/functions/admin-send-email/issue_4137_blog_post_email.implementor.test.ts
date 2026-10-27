// MINGLA-INVARIANT: I-4137-EMAIL-BLOG-RESOLVED-SERVER-SIDE | issue #4137 | campaign creation and each send batch resolve current public post data before any provider request.
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { validateDocument } from "./model.ts";
import {
  BlogPostBlockError,
  resolveBlogPostBlocks,
} from "../_shared/email/blogPostBlock.ts";

Deno.env.set("SUPABASE_URL", "https://project.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
Deno.env.set("RESEND_API_KEY", "re_test_issue_4137");
Deno.env.set(
  "UNSUBSCRIBE_TOKEN_SECRET",
  "issue-4137-unsubscribe-secret-long-enough-for-tests",
);
Deno.env.set("MINGLA_LOGO_URL", "https://usemingla.com/email-logo.png");
Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");
const { createCampaign, processClaimedCampaign } = await import("./index.ts");

const POST_ID = "41370000-0000-4000-a000-000000000001";
const reference = {
  id: "blog-block",
  type: "blog_post" as const,
  postId: POST_ID,
  style: "card" as const,
  buttonText: "Read on the blog",
  snapshot: {
    slug: "stale",
    title: "FAKE CLIENT TITLE",
    summary: "Fake",
    categoryLabel: "Fake",
    readMinutes: 99,
    coverUrl: null,
    coverAlt: "",
    versionId: "fake",
  },
};

function blogRow(title = "Latest published title") {
  return {
    id: POST_ID,
    slug: "real-story",
    status: "published",
    category: { label: "Going out" },
    version: {
      id: "version-current",
      title,
      summary: "The current server summary",
      read_minutes: 4,
      cover_alt: "Friends at dinner",
      cover: { storage_path: "staff/cover.jpg", alt: "" },
    },
  };
}

function thenable(result: () => Record<string, unknown>) {
  const chain: any = {};
  for (
    const method of [
      "select",
      "in",
      "eq",
      "is",
      "not",
      "lte",
      "or",
      "order",
      "range",
      "gte",
      "ilike",
      "limit",
    ]
  ) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve(result());
  return chain;
}

function missingClient(error: null | { code: string; message: string } = null) {
  return {
    from: () => thenable(() => ({ data: [], error })),
  };
}

function sendingClient(rows: unknown[]) {
  const adminUpdates: Record<string, unknown>[] = [];
  const deliveryUpdates: Record<string, unknown>[] = [];
  return {
    adminUpdates,
    deliveryUpdates,
    from(table: string) {
      let update: Record<string, unknown> | null = null;
      let statuses: string[] = [];
      const chain = thenable(() => {
        if (table === "blog_posts") return { data: rows, error: null };
        if (
          table === "channel_suppressions" || table === "marketing_unsubscribes"
        ) return { data: [], error: null };
        if (table === "admin_email_recipient_deliveries" && statuses.length) {
          const accepted = statuses.includes("accepted") ? 1 : 0;
          return { data: null, error: null, count: accepted };
        }
        if (table === "admin_email_log" && update) adminUpdates.push(update);
        if (table === "admin_email_recipient_deliveries" && update) {
          deliveryUpdates.push(update);
        }
        return { data: null, error: null };
      });
      chain.update = (value: Record<string, unknown>) => {
        update = value;
        return chain;
      };
      chain.in = (_column: string, value: string[]) => {
        statuses = value;
        return chain;
      };
      return chain;
    },
    rpc(name: string) {
      if (name !== "claim_admin_email_delivery_batch") {
        throw new Error(`unexpected_rpc:${name}`);
      }
      return Promise.resolve({
        data: [{
          id: "delivery-1",
          recipient_email: "reader@example.com",
          attempts: 1,
          personalization: { email: "reader@example.com", first_name: "Maya" },
        }],
        error: null,
      });
    },
  };
}

Deno.test("#4137 validateDocument accepts the block and enforces shape plus the three-post limit", () => {
  assertEquals(validateDocument([reference])[0].type, "blog_post");
  for (
    const patch of [
      { postId: "nope" },
      { style: "hero" },
      { buttonText: "" },
      { buttonText: "Hello {first_name}" },
    ]
  ) {
    let failed = false;
    try {
      validateDocument([{ ...reference, ...patch }]);
    } catch {
      failed = true;
    }
    assertEquals(failed, true);
  }
  assertRejects(
    async () =>
      validateDocument(
        Array.from(
          { length: 4 },
          (_, index) => ({ ...reference, id: `b${index}` }),
        ),
      ),
    Error,
    "email_block_blog_post_limit",
  );
});

Deno.test("#4137 resolver reports missing and maps schema absence to blog_not_ready", async () => {
  const missing = await resolveBlogPostBlocks(missingClient() as any, [
    reference,
  ]);
  assertEquals(missing.missing, [POST_ID]);
  await assertRejects(
    () =>
      resolveBlogPostBlocks(
        missingClient({
          code: "42P01",
          message: "relation blog_posts does not exist",
        }) as any,
        [reference],
      ),
    BlogPostBlockError,
    "relation blog_posts does not exist",
  );
});

Deno.test("#4137 create_campaign rejects an unpublished post and ignores its fake snapshot", async () => {
  await assertRejects(
    () =>
      createCampaign(missingClient() as any, "admin-1", {
        subject: "Tonight",
        audience: { mode: "everyone", filters: {} },
        document: [reference],
      }),
    Error,
    `email_block_blog_post_not_published:${POST_ID}`,
  );
});

Deno.test("#4137 processing resolves the newest title before delivery and unpublish fails before fetch", async () => {
  const originalFetch = globalThis.fetch;
  const providerBodies: string[] = [];
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    providerBodies.push(String(init?.body || ""));
    return Promise.resolve(
      new Response(JSON.stringify({ id: "resend-1" }), { status: 200 }),
    );
  }) as typeof fetch;
  try {
    const sending = sendingClient([blogRow()]);
    const result = await processClaimedCampaign(sending as any, {
      id: "campaign-1",
      subject: "Tonight",
      body: "old",
      body_document: { version: 1, blocks: [reference] },
    });
    assertEquals((result as any).status, "completed");
    assertEquals(
      providerBodies.length,
      1,
      JSON.stringify({ result, deliveryUpdates: sending.deliveryUpdates }),
    );
    assertStringIncludes(providerBodies[0], "Latest published title");
    assertEquals(providerBodies[0].includes("FAKE CLIENT TITLE"), false);

    providerBodies.length = 0;
    const unpublished = sendingClient([]);
    const failed = await processClaimedCampaign(unpublished as any, {
      id: "campaign-2",
      subject: "Tonight",
      body: "old",
      body_document: { version: 1, blocks: [reference] },
    });
    assertEquals((failed as any).error, `blog_post_not_published:${POST_ID}`);
    assertEquals(providerBodies.length, 0);
    assertEquals(unpublished.adminUpdates[0].status, "failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
