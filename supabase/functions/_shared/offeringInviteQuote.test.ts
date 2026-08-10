import {
  buildOfferingExecutionSnapshot,
  frame,
  hashPushVector,
} from "./offeringInviteQuote.ts";

const vector = {
  eventId: "00000000-0000-4000-8000-000000000010",
  brandId: "00000000-0000-4000-8000-000000000011",
  brandPersonId: "00000000-0000-4000-8000-000000000012",
  recipientUserId: "00000000-0000-4000-8000-000000000013",
  selectionHash: "1".repeat(64),
};

Deno.test("issue #1770 stable quote/execution hashes match Amendment 5", async () => {
  const a = await hashPushVector({
    ...vector,
    quotedAt: "2026-08-10T17:00:00.000000Z",
  });
  const b = await hashPushVector({
    ...vector,
    quotedAt: "2026-08-10T17:04:00.000000Z",
  });
  const expected = {
    payloadHash:
      "7f2bac69104ea744d8f3b8eee0aff076a688f7f0da3d6452d52d2d5979e1e190",
    eligibilityHash:
      "6b8b382eacbe4db6c435cb8c8f98b5538eac56eb75c2176a6810c3297ef1f594",
    quoteHash:
      "6e4fc2fb986c18c1408e2eace3490e72ad291efbb3ca9ee5c1130355e351841f",
    executionSnapshotHash:
      "4af027908ace4d56fec849b7736e69ef4c2c351f7d3cdf06c6ab3d07743bab56",
  };
  if (JSON.stringify(a) !== JSON.stringify(expected)) {
    throw new Error(`Amendment 5 vector A drifted: ${JSON.stringify(a)}`);
  }
  if (JSON.stringify(b) !== JSON.stringify(expected)) {
    throw new Error(`Amendment 5 vector B drifted: ${JSON.stringify(b)}`);
  }
  if (
    a.quoteHash !== b.quoteHash ||
    a.executionSnapshotHash !== b.executionSnapshotHash
  ) {
    throw new Error("freshness metadata changed semantic hash identity");
  }
  if (
    Date.parse("2026-08-10T17:00:00.000000Z") ===
      Date.parse("2026-08-10T17:04:00.000000Z")
  ) {
    throw new Error("fixture timestamps must remain independently unequal");
  }
});

Deno.test("issue #1770 F framing distinguishes null, empty, and UTF-8", () => {
  const nullFrame = Array.from(frame(null));
  const emptyFrame = Array.from(frame(""));
  const utf8Frame = Array.from(frame("é\r\n"));
  if (nullFrame.join(",") !== "0") throw new Error("null framing drifted");
  if (emptyFrame.join(",") !== "1,0,0,0,0") {
    throw new Error("empty framing drifted");
  }
  if (utf8Frame.slice(0, 5).join(",") !== "1,0,0,0,4") {
    throw new Error("UTF-8 byte-length framing drifted");
  }
});

Deno.test("issue #1770 snapshot rejects recipient data and unapproved links", async () => {
  for (
    const body of [
      "Contact person@example.test",
      "Visit https://evil.example/path",
    ]
  ) {
    await buildOfferingExecutionSnapshot({
      eventId: vector.eventId,
      brandId: vector.brandId,
      purpose: "invitation",
      channels: ["email"],
      selectionHash: vector.selectionHash,
      candidates: [{
        brandPersonId: vector.brandPersonId,
        inviteId: null,
        predecessorAttemptId: null,
        channel: "email",
        contactMethodId: vector.recipientUserId,
        recipientUserId: null,
        normalizedContact: "person@example.test",
        allowed: true,
        safeReasonCode: null,
        lastContactAt: null,
      }],
      content: { bodyText: body },
    }).then(
      () => {
        throw new Error("unsafe caller-authored content was accepted");
      },
      (error) => {
        if (error.message !== "offering_execution_content_invalid") {
          throw error;
        }
      },
    );
  }
});

Deno.test("issue #1770 push retry seals the immutable predecessor payload", async () => {
  const persisted = {
    payloadVersion: 1 as const,
    payloadHash:
      "7f2bac69104ea744d8f3b8eee0aff076a688f7f0da3d6452d52d2d5979e1e190",
    title: "You are invited",
    body: "Open Mingla for details.",
    eventId: vector.eventId,
  };
  const snapshot = await buildOfferingExecutionSnapshot({
    eventId: vector.eventId,
    brandId: vector.brandId,
    purpose: "retry_delivery",
    channels: ["push"],
    selectionHash: vector.selectionHash,
    candidates: [{
      brandPersonId: vector.brandPersonId,
      inviteId: "00000000-0000-4000-8000-000000000014",
      predecessorAttemptId: "00000000-0000-4000-8000-000000000015",
      channel: "push",
      contactMethodId: null,
      recipientUserId: vector.recipientUserId,
      normalizedContact: null,
      allowed: true,
      safeReasonCode: null,
      lastContactAt: null,
    }],
    content: { pushTitle: "caller text must not win" },
    retryPushPayload: persisted,
  });
  if (JSON.stringify(snapshot.campaigns.push) !== JSON.stringify(persisted)) {
    throw new Error("retry did not preserve predecessor push bytes");
  }
  await buildOfferingExecutionSnapshot({
    eventId: vector.eventId,
    brandId: vector.brandId,
    purpose: "retry_delivery",
    channels: ["push"],
    selectionHash: vector.selectionHash,
    candidates: [],
    content: {},
    allowEmptyPreview: true,
    retryPushPayload: { ...persisted, payloadHash: "0".repeat(64) },
  }).then(
    () => {
      throw new Error("tampered retry payload was accepted");
    },
    (error) => {
      if (error.message !== "retry_payload_mismatch") throw error;
    },
  );
});
