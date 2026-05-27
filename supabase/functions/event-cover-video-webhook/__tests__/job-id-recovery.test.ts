import { handleEventCoverVideoWebhook } from "../index.ts";
import { sha1Hex } from "../../_shared/eventCoverVideo.ts";

const JOB_ID = "dde19eac-9810-4e0d-b8f6-63fe235fc5af";
const OTHER_JOB_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";
const API_SECRET = "cloudinary-test-secret";
const TIMESTAMP = "1778346000";

type UpdateCall = {
  table: string;
  payload: Record<string, unknown>;
  eq?: { column: string; value: unknown };
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const processedEager = () => [{
  secure_url: "https://res.cloudinary.com/mingla/video/upload/v1/processed.mp4",
  bytes: 1_234_567,
  duration: 12,
  format: "mp4",
  video: { codec: "h264" },
  audio: { codec: "aac" },
}];

const signBody = async (rawBody: string): Promise<string> =>
  sha1Hex(`${rawBody}${TIMESTAMP}${API_SECRET}`);

const makeRequest = async (payload: Record<string, unknown>): Promise<Request> => {
  const rawBody = JSON.stringify(payload);
  return new Request("https://example.test/functions/v1/event-cover-video-webhook", {
    body: rawBody,
    headers: {
      "Content-Type": "application/json",
      "x-cld-signature": await signBody(rawBody),
      "x-cld-timestamp": TIMESTAMP,
    },
    method: "POST",
  });
};

const createSupabaseStub = (options: {
  expectedLookupId?: string;
  existingJob?: Record<string, unknown> | null;
} = {}) => {
  const lookups: Array<{ table: string; column: string; value: unknown }> = [];
  const updates: UpdateCall[] = [];
  const existingJob = options.existingJob ?? {
    id: options.expectedLookupId ?? JOB_ID,
    status: "source_uploaded",
    event_id: EVENT_ID,
    apply_mode: "published_manual",
  };

  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          lookups.push({ table, column, value });
          return {
            maybeSingle: () => Promise.resolve({ data: existingJob, error: null }),
          };
        },
      }),
      update: (payload: Record<string, unknown>) => {
        const call: UpdateCall = { table, payload };
        updates.push(call);
        return {
          eq: (column: string, value: unknown) => {
            call.eq = { column, value };
            const result = { data: null, error: null };
            return {
              then: (resolve: (value: typeof result) => unknown) =>
                Promise.resolve(result).then(resolve),
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: value,
                      event_id: EVENT_ID,
                      apply_mode: existingJob?.apply_mode ?? "published_manual",
                    },
                    error: null,
                  }),
              }),
            };
          },
        };
      },
    }),
  };

  return { client, lookups, updates };
};

const createDeps = (stub = createSupabaseStub()) => ({
  serviceRoleClient: () => stub.client,
  verifyWebhook: async (req: Request, rawBody: string) => {
    const expected = await signBody(rawBody);
    return req.headers.get("x-cld-signature") === expected &&
        req.headers.get("x-cld-timestamp") === TIMESTAMP
      ? { ok: true as const }
      : {
        ok: false as const,
        code: "invalid_signature",
        status: 403,
        message: "Cloudinary signature is invalid.",
      };
  },
}) as never;

const readJson = async (response: Response): Promise<Record<string, unknown>> =>
  await response.json() as Record<string, unknown>;

Deno.test("ORCH-0978 webhook recovers job_id from eager public_id when context is absent", async () => {
  const stub = createSupabaseStub({ expectedLookupId: JOB_ID });
  const response = await handleEventCoverVideoWebhook(
    await makeRequest({
      notification_type: "eager",
      public_id: `event-covers/raw/${BRAND_ID}/${EVENT_ID}/${JOB_ID}`,
      eager: processedEager(),
    }),
    createDeps(stub),
  );
  const body = await readJson(response);

  assert(response.status === 200, `expected 200, received ${response.status}`);
  assert(body.ok === true, "expected ok response");
  assert(stub.lookups[0]?.value === JOB_ID, "expected job lookup to use public_id last segment");
  assert(stub.updates.some((call) => call.payload.status === "ready"), "expected ready update path");
});

Deno.test("ORCH-0978 webhook keeps context job_id precedence over public_id fallback", async () => {
  const stub = createSupabaseStub({ expectedLookupId: JOB_ID });
  const response = await handleEventCoverVideoWebhook(
    await makeRequest({
      notification_type: "eager",
      context: { custom: { job_id: JOB_ID } },
      public_id: `event-covers/raw/${BRAND_ID}/${EVENT_ID}/${OTHER_JOB_ID}`,
      eager: [],
    }),
    createDeps(stub),
  );

  assert(response.status === 200, `expected 200, received ${response.status}`);
  assert(stub.lookups[0]?.value === JOB_ID, "expected context job_id to win");
  assert(stub.updates.some((call) => call.payload.status === "failed"), "expected failed derivative path");
  assert(
    stub.updates.some((call) => call.payload.failure_code === "processed_url_invalid"),
    "expected existing failed-derivative status write to stay intact",
  );
});

Deno.test("ORCH-0978 webhook rejects malformed public_id without a UUID last segment", async () => {
  let warned = false;
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warned = args.some((arg) => String(arg).includes("job_id_extraction_failed"));
  };
  try {
    const response = await handleEventCoverVideoWebhook(
      await makeRequest({
        notification_type: "eager",
        public_id: "event-covers/raw/foo/bar/not-a-uuid",
        eager: processedEager(),
      }),
      createDeps(),
    );
    const body = await readJson(response);

    assert(response.status === 400, `expected 400, received ${response.status}`);
    assert(body.error === "validation_error", "expected validation_error");
    assert(body.detail === "job_id_missing", "expected job_id_missing detail");
    assert(warned, "expected job_id_extraction_failed console.warn");
  } finally {
    console.warn = originalWarn;
  }
});

Deno.test("ORCH-0978 webhook rejects missing context and missing public_id", async () => {
  const response = await handleEventCoverVideoWebhook(
    await makeRequest({
      notification_type: "eager",
      eager: processedEager(),
    }),
    createDeps(),
  );
  const body = await readJson(response);

  assert(response.status === 400, `expected 400, received ${response.status}`);
  assert(body.error === "validation_error", "expected validation_error");
  assert(body.detail === "job_id_missing", "expected job_id_missing detail");
});

Deno.test("ORCH-0978 webhook preserves legacy pipe-delimited context job_id", async () => {
  const stub = createSupabaseStub({ expectedLookupId: JOB_ID });
  const response = await handleEventCoverVideoWebhook(
    await makeRequest({
      notification_type: "eager",
      context: `job_id=${JOB_ID}|event_id=${EVENT_ID}|brand_id=${BRAND_ID}`,
      eager: processedEager(),
    }),
    createDeps(stub),
  );

  assert(response.status === 200, `expected 200, received ${response.status}`);
  assert(stub.lookups[0]?.value === JOB_ID, "expected legacy context job_id to drive lookup");
  assert(stub.updates.some((call) => call.payload.status === "ready"), "expected ready update path");
});
