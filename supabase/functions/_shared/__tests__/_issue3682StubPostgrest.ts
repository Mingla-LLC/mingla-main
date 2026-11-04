/**
 * #3682 — a local stub PostgREST server for driving a REAL supabase-js client
 * in Deno tests (the auto-follow crash only reproduced with the real
 * thenable-only builder, never with a mocked Promise).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Seen = { method: string; path: string; body: unknown };

export async function withStubPostgrest(
  status: number,
  responseBody: unknown,
  run: (url: string, seen: Seen[]) => Promise<void>,
): Promise<void> {
  const seen: Seen[] = [];
  const ac = new AbortController();
  let resolveListen: (port: number) => void = () => {};
  const listening = new Promise<number>((r) => (resolveListen = r));
  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      signal: ac.signal,
      onListen: ({ port }) => resolveListen(port),
    },
    async (req) => {
      const text = await req.text();
      seen.push({
        method: req.method,
        path: new URL(req.url).pathname,
        body: text.length > 0 ? JSON.parse(text) : null,
      });
      return new Response(JSON.stringify(responseBody), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const port = await listening;
  try {
    await run(`http://127.0.0.1:${port}`, seen);
  } finally {
    ac.abort();
    await server.finished;
  }
}

export function realClient(url: string) {
  return createClient(url, "service-role-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

