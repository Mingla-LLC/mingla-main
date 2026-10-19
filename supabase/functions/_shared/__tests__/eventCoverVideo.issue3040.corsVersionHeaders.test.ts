// Issue #3040 (B-C1, integration) — the Host client sends x-mingla-app-version
// and x-mingla-platform on every lane call. A browser preflight-rejects any
// request header the lane's CORS allow-list does not name, which would break
// every web upload, so the allow-list and the client's header names are pinned
// together here.
// Invariant I-VIDEO-OLD-CLIENT-TOLD (declared in supabase/functions/event-cover-video-upload-intent/__tests__/issue_3040_old_client_426.test.ts): the lane CORS allow-list names every header the Host client sends
// FAILS ON REVERT: drop either name from corsHeaders, or rename a client header.
import { corsHeaders } from "../eventCoverVideo.ts";
import { assert } from "./issue3040_fakeSupabase.ts";

const CLIENT_CONTRACT = new URL(
  "../../../../mingla-business/src/services/eventCoverVideoEdgeContract.ts",
  import.meta.url,
);

const allowed = (): string[] =>
  corsHeaders["Access-Control-Allow-Headers"].split(",").map((name) =>
    name.trim().toLowerCase()
  );

Deno.test("#3040 lane CORS allows the version headers and keeps the old ones", () => {
  const names = allowed();
  for (
    const name of [
      "authorization",
      "x-client-info",
      "apikey",
      "content-type",
      "x-mingla-app-version",
      "x-mingla-platform",
    ]
  ) {
    assert(names.includes(name), `CORS allow-list is missing ${name}`);
  }
});

Deno.test("#3040 every header the Host client sends is allowed by the lane CORS", async () => {
  const source = await Deno.readTextFile(CLIENT_CONTRACT);
  const sent = [...source.matchAll(/LANE_[A-Z_]+_HEADER\s*=\s*"([^"]+)"/g)].map(
    (match) => match[1].toLowerCase(),
  );
  assert(sent.length === 2, `expected 2 client header constants, saw ${sent.length}`);
  const names = allowed();
  for (const name of sent) {
    assert(names.includes(name), `client sends ${name} but CORS does not allow it`);
  }
});
