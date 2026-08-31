// issue #2879 — the anonymous Supabase RPC caller, owned in ONE place.
//
// Extracted verbatim from server/socialPreview.js so that
// api/event-checkout-bundle.js does not have to require that module. This is
// not tidiness: socialPreview pulls in React and the whole OG-card rendering
// stack, and the cached endpoint is the single thing a crowd hits hardest. Its
// cold start must not carry a renderer it never calls.
//
// socialPreview.js now imports these rather than holding its own copies, so
// there is still exactly ONE definition of which project and which key the
// anonymous server-side reads use.

const DEFAULT_SUPABASE_URL = "https://gqnoajqerqhnvulmnyvv.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJn" +
  "cW5vYWpxZXJxaG52dWxtbnl2diIsInJvbGUiOiJhbm9uIiwiaWF0" +
  "IjoxNzU3NTA1MjcyLCJleHAiOjIwNzMwODEyNzJ9.p4yi9yD2RWf" +
  "J2HN4DD-dgrvXnyzhJi3g2YCouSK-hbo";

const SUPABASE_URL = (
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  DEFAULT_SUPABASE_URL
).replace(/\/+$/, "");

const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_ANON_KEY;

const requestRpcJson = async (functionName, body) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Supabase public preview RPC failed: ${response.status}`);
  }

  return response.json();
};

module.exports = { SUPABASE_URL, SUPABASE_ANON_KEY, requestRpcJson };
