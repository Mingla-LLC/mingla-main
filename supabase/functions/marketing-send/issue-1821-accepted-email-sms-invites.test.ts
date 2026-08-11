import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isResendOk, persistEmailSentTerminal, postToResend } from "./index.ts";

const test = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });

const messageId = "18210000-0000-4000-8000-000000000001";
const providerId = "resend-provider-1821";

test("#1821 Resend success requires a nonblank canonical id", () => {
  assertEquals(isResendOk({ id: providerId }), true);
  for (
    const value of [
      {},
      { id: null },
      { id: "" },
      { id: "   " },
      { id: 1821 },
      null,
      "malformed",
    ]
  ) {
    assertEquals(isResendOk(value), false);
  }
});

test("#1821 Resend 2xx without canonical id is ambiguous, never accepted", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const body of [{}, { id: null }, { id: "" }, { id: "   " }]) {
      let claims = 0;
      globalThis.fetch = () =>
        Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      const result = await postToResend({
        apiKey: "test-key",
        from: "Mingla <team@example.test>",
        to: "controlled@example.test",
        subject: "Invitation",
        html: "<p>Invitation</p>",
        text: "Invitation",
        idempotencyKey: "offering:test:email:v1",
        beforeProviderIo: () => {
          claims += 1;
          return Promise.resolve();
        },
      });
      assertEquals(result, {
        ok: false,
        error: "resend_success_response_invalid",
      });
      assertEquals(claims, 1);
    }

    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ id: providerId }), { status: 200 }),
      );
    assertEquals(
      await postToResend({
        apiKey: "test-key",
        from: "Mingla <team@example.test>",
        to: "controlled@example.test",
        subject: "Invitation",
        html: "<p>Invitation</p>",
        text: "Invitation",
      }),
      { ok: true, providerId },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

type TerminalOutcome = {
  data: {
    id: string;
    status: string;
    provider_message_id: string | null;
  } | null;
  error: { code?: string } | null;
};

function terminalClient(outcomes: TerminalOutcome[]) {
  let writes = 0;
  return {
    get writes(): number {
      return writes;
    },
    from(table: string) {
      assertEquals(table, "marketing_messages");
      return {
        update(patch: Record<string, unknown>) {
          assertEquals(patch.status, "sent");
          assertEquals(patch.provider_message_id, providerId);
          return {
            eq(column: string, value: string) {
              assertEquals(column, "id");
              assertEquals(value, messageId);
              return {
                select(columns: string) {
                  assertEquals(columns, "id,status,provider_message_id");
                  return {
                    maybeSingle(): Promise<TerminalOutcome> {
                      const outcome = outcomes[writes];
                      writes += 1;
                      if (outcome === undefined) {
                        throw new Error("unexpected terminal write");
                      }
                      return Promise.resolve(outcome);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

const persisted: TerminalOutcome = {
  data: { id: messageId, status: "sent", provider_message_id: providerId },
  error: null,
};

test("#1821 email terminal write retries once and accepts only exact readback", async () => {
  const client = terminalClient([
    { data: null, error: { code: "40001" } },
    persisted,
  ]);
  await persistEmailSentTerminal(client, messageId, providerId);
  assertEquals(client.writes, 2);
});

test("#1821 zero-row or mismatched readback retries then fails loud", async () => {
  for (
    const first of [
      { data: null, error: null },
      {
        data: { id: messageId, status: "queued", provider_message_id: null },
        error: null,
      },
    ] satisfies TerminalOutcome[]
  ) {
    const client = terminalClient([first, first]);
    await assertRejects(
      () => persistEmailSentTerminal(client, messageId, providerId),
      Error,
      `email_sent_terminal_update_lost:${messageId}:write_not_persisted`,
    );
    assertEquals(client.writes, 2);
  }
});

test("#1821 two database failures expose only the safe error code", async () => {
  const client = terminalClient([
    { data: null, error: { code: "57014" } },
    { data: null, error: { code: "40001" } },
  ]);
  await assertRejects(
    () => persistEmailSentTerminal(client, messageId, providerId),
    Error,
    `email_sent_terminal_update_lost:${messageId}:40001`,
  );
  assertEquals(client.writes, 2);
});

test("#1821 caller counts sent only after verified persistence", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const accepted = source.slice(
    source.indexOf("if (sendOutcome.ok)"),
    source.indexOf(
      "} else if (providerClaimed",
      source.indexOf("if (sendOutcome.ok)"),
    ),
  );
  assertEquals(
    /await persistEmailSentTerminal\([\s\S]*?\);[\s\S]*?sent \+= 1;/.test(
      accepted,
    ),
    true,
  );
  assertEquals(
    source.includes('safe_reason_code: "provider_outcome_unknown"'),
    true,
  );
});
