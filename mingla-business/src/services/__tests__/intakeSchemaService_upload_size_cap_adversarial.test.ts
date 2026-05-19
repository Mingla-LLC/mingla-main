/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — TESTER-AUTHORED ADVERSARIAL
 * regression test (1 of 2) per ORCH-0840 [Regression-test enforcement +
 * append-only CI] Step 0.5 (b) gate.
 *
 * ANGLE: file upload 10MB size cap is enforced BEFORE the edge function is
 * invoked. Attacks a DIFFERENT angle than the implementor's happy-path:
 *
 *   - Implementor `intakeSchemaService_happy_path.test.ts` covers
 *     `validateIntakeSchemaClient` (schema-shape validation only — never
 *     touches the upload code path).
 *   - Implementor `intakeSchemaService_answer_validation.test.ts` covers
 *     `validateAnswerAgainstSchema` (answer-shape validation — also never
 *     touches the upload code path).
 *   - This adversarial test covers `uploadIntakeFile` itself (different
 *     function, different code path) and proves the 10MB pre-check fires
 *     BEFORE the edge function is invoked. If the pre-check is reverted,
 *     this test FAILS because the mocked edge-fn invoke spy fires.
 *
 * fails-on-revert proof anchor: the `args.size_bytes > 10 * 1024 * 1024`
 * pre-check in `uploadIntakeFile`. Comment it out and re-run → 1 test
 * fails because the upload proceeds to the edge fn instead of throwing
 * `schema_invalid` early. Captured at HEAD
 * `fcd97a66f662028e81b26867ab8203bd3420fa5c` (Phase 4 implementor return).
 *
 * Adversarial angle classification:
 *   - DIFFERENT FUNCTION than implementor tests (uploadIntakeFile vs validators)
 *   - BOUNDARY CONDITION (exactly 10MB + 1 byte = 10485761)
 *   - CONTRACT VIOLATION (edge fn must not see oversized files)
 *   - RACE PROTECTION (size check before network round-trip)
 *
 * This is genuinely adversarial — a copy of the implementor's test with a
 * renamed it() block would NOT exercise this code path at all.
 */

/* eslint-disable import/first */
import { describe, expect, jest, test, beforeEach } from "@jest/globals";

const mockInvoke = jest.fn();
const mockFunctionsFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    functions: {
      invoke: (name: string, options: unknown) => {
        mockInvoke(name, options);
        return Promise.resolve({
          data: { signed_url: "https://fake/url", file_path: "fake/path" },
          error: null,
        });
      },
    },
    storage: {
      from: (...args: unknown[]) => {
        mockFunctionsFrom(...args);
        return {
          createSignedUrl: () =>
            Promise.resolve({ data: null, error: null }),
        };
      },
    },
  },
}));

// Stub global fetch so we can detect if the upload actually reached the PUT
// step (which it MUST NOT when the size cap rejects the file).
const mockFetch = jest.fn(() =>
  Promise.resolve({ ok: true, status: 200, statusText: "OK" } as Response),
);
(globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

import { uploadIntakeFile } from "../intakeSchemaService";

beforeEach(() => {
  mockInvoke.mockClear();
  mockFetch.mockClear();
});

describe("ORCH-0880 ADVERSARIAL — file upload 10MB size cap pre-check", () => {
  test("file exactly 10MB (10485760 bytes) — accepted; pre-check passes", async () => {
    // Exactly 10MB is on the boundary — should pass the gate.
    // 10 * 1024 * 1024 = 10485760
    await uploadIntakeFile({
      eventId: "event-1",
      orderId: "order-1",
      questionId: "q-1",
      filename: "exactly-10mb.jpg",
      mime_type: "image/jpeg",
      size_bytes: 10 * 1024 * 1024,
      body: new Blob([new Uint8Array(8)], { type: "image/jpeg" }),
    });
    // Edge fn invoke SHOULD have been called (boundary passes).
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(
      "trip-intake-upload-signed-url",
      expect.objectContaining({
        body: expect.objectContaining({
          event_id: "event-1",
          size_bytes: 10 * 1024 * 1024,
        }),
      }),
    );
  });

  test("file 10MB + 1 byte (10485761) — REJECTED with schema_invalid BEFORE edge fn invoke", async () => {
    // Boundary + 1 — should FAIL the pre-check.
    let caught: unknown;
    try {
      await uploadIntakeFile({
        eventId: "event-1",
        orderId: "order-1",
        questionId: "q-1",
        filename: "too-big.jpg",
        mime_type: "image/jpeg",
        size_bytes: 10 * 1024 * 1024 + 1,
        body: new Blob([new Uint8Array(8)], { type: "image/jpeg" }),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("schema_invalid");
    // Critical: edge fn MUST NOT have been invoked. This is the adversarial anchor.
    expect(mockInvoke).not.toHaveBeenCalled();
    // Critical: PUT to signed URL MUST NOT have happened either.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("file way too big (100MB) — REJECTED with schema_invalid; no network calls", async () => {
    let caught: unknown;
    try {
      await uploadIntakeFile({
        eventId: "event-1",
        orderId: "order-1",
        questionId: "q-1",
        filename: "huge.pdf",
        mime_type: "application/pdf",
        size_bytes: 100 * 1024 * 1024,
        body: new Blob([new Uint8Array(8)], { type: "application/pdf" }),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("schema_invalid");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("ORCH-0880 ADVERSARIAL — uploadIntakeFile required-arg validation", () => {
  test("empty eventId → throws not_found; no edge fn invoke", async () => {
    let caught: unknown;
    try {
      await uploadIntakeFile({
        eventId: "",
        orderId: "order-1",
        questionId: "q-1",
        filename: "f.jpg",
        mime_type: "image/jpeg",
        size_bytes: 1024,
        body: new Blob([new Uint8Array(8)]),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("not_found");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("empty orderId → throws not_found; no edge fn invoke", async () => {
    let caught: unknown;
    try {
      await uploadIntakeFile({
        eventId: "event-1",
        orderId: "",
        questionId: "q-1",
        filename: "f.jpg",
        mime_type: "image/jpeg",
        size_bytes: 1024,
        body: new Blob([new Uint8Array(8)]),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("not_found");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("empty filename → throws schema_invalid; no edge fn invoke", async () => {
    let caught: unknown;
    try {
      await uploadIntakeFile({
        eventId: "event-1",
        orderId: "order-1",
        questionId: "q-1",
        filename: "",
        mime_type: "image/jpeg",
        size_bytes: 1024,
        body: new Blob([new Uint8Array(8)]),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("schema_invalid");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
