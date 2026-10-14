import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const invoke = jest.fn<
  (...args: unknown[]) => Promise<{ data: Record<string, unknown>; error: unknown }>
>();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

// Keep the mock initialized before this module import; the service reads it at load.
// eslint-disable-next-line import/first
import {
  revokeIntakeFileClaim,
  uploadIntakeFile,
} from "../intakeSchemaService";

const EVENT = "11111111-1111-4111-8111-111111111111";
const TIER = "22222222-2222-4222-8222-222222222222";
const SCHEMA = "33333333-3333-4333-8333-333333333333";
const QUESTION = "44444444-4444-4444-8444-444444444444";
const DRAFT = "55555555-5555-4555-8555-555555555555";
const CLAIM = "66666666-6666-4666-8666-666666666666";

beforeEach(() => {
  invoke.mockReset();
  invoke
    .mockResolvedValueOnce({
      data: {
        claim_id: CLAIM,
        signed_url: "https://storage.example.test/signed-upload",
        mime_type: "application/pdf",
        size_bytes: 8,
        expires_at: "2030-01-01T00:00:00.000Z",
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        claim_id: CLAIM,
        mime_type: "application/pdf",
        size_bytes: 8,
        expires_at: "2030-01-01T00:00:00.000Z",
      },
      error: null,
    });
  global.fetch = jest.fn<() => Promise<Response>>()
    .mockResolvedValue({ ok: true } as Response) as typeof fetch;
});

test("#3859 buyer web mints the exact scope and stores only accepted claim metadata", async () => {
  const answer = await uploadIntakeFile({
    eventId: EVENT,
    ticketTypeId: TIER,
    schemaVersionId: SCHEMA,
    questionId: QUESTION,
    uploadSessionId: DRAFT,
    filename: "passport.pdf",
    mime_type: "application/pdf",
    size_bytes: 8,
    body: new Blob(["%PDF-1.7"], { type: "application/pdf" }),
  });

  expect(invoke.mock.calls[0]).toEqual([
    "trip-intake-upload-signed-url",
    { body: expect.objectContaining({
      action: "mint",
      event_id: EVENT,
      ticket_type_id: TIER,
      schema_version_id: SCHEMA,
      question_id: QUESTION,
      upload_session_id: DRAFT,
    }) },
  ]);
  expect(answer).toEqual({
    claim_id: CLAIM,
    mime_type: "application/pdf",
    size_bytes: 8,
    expires_at: "2030-01-01T00:00:00.000Z",
  });
  expect(answer).not.toHaveProperty("path");
  expect(answer).not.toHaveProperty("filename");
  expect(JSON.stringify(answer)).not.toContain("signed-upload");
});

test("#3859 remove revokes the exact claim within its upload draft", async () => {
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { revoked: true }, error: null });
  await revokeIntakeFileClaim({ claimId: CLAIM, uploadSessionId: DRAFT });
  expect(invoke).toHaveBeenCalledWith("trip-intake-upload-signed-url", {
    body: {
      action: "revoke",
      claim_id: CLAIM,
      upload_session_id: DRAFT,
    },
  });
});

test("#3859 Host viewer uses the verified private path with a neutral label", () => {
  const source = readFileSync(
    join(__dirname, "../../components/trip/TravelerIntakeAnswerCard.tsx"),
    "utf8",
  );
  expect(source).toContain('const PRIVATE_FILE_LABEL = "Uploaded file"');
  expect(source).toContain('typeof (v as IntakeFileAnswer).path === "string"');
  expect(source).toContain("filename={f.filename ?? PRIVATE_FILE_LABEL}");
});
