// #4452 §5.6 (RFC 8058): the List-Unsubscribe-Post one-click target for form
// follow-ups. A mail client POSTs `List-Unsubscribe=One-Click` here with the
// signed token in the query; we forward it to self-serve-unsubscribe with
// scope 'marketing' (stop promos, keep transactional). No page, no cookie.
// The token is verified by the edge function; nothing is logged.
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 2048) {
    return Response.json({ ok: false, error: 'invalid_token' }, { status: 400, headers: NO_STORE })
  }
  const functionsUrl = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ?? ''
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!functionsUrl || !anon) return Response.json({ ok: false, error: 'server' }, { status: 500, headers: NO_STORE })
  try {
    const res = await fetch(`${functionsUrl}/self-serve-unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ token, scope: 'marketing' }),
      signal: AbortSignal.timeout(10_000),
    })
    return Response.json({ ok: res.ok }, { status: res.ok ? 200 : res.status === 401 ? 400 : 502, headers: NO_STORE })
  } catch {
    return Response.json({ ok: false, error: 'network' }, { status: 502, headers: NO_STORE })
  }
}
