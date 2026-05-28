import { recoverJobIdFromPayload } from "../index.ts";

const assertEquals = <T>(actual: T, expected: T, message: string): void => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
};

Deno.test("ORCH-0978 adversarial public_id fallback ignores missing context and extra folder prefixes", () => {
  const jobId = "dde19eac-9810-4e0d-b8f6-63fe235fc5af";
  const recovered = recoverJobIdFromPayload({
    notification_type: "eager",
    public_id: `cloudinary-callbacks/event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/09b4ece6-eabc-4734-8ce3-3a25d90417e4/${jobId}`,
  });

  assertEquals(recovered, jobId, "expected fallback to recover the UUID last segment");
});
