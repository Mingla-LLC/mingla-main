import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SLUG = /^[a-z0-9][a-z0-9_-]{5,47}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const VISITOR = /^[0-9a-f]{64}$/
const DEVICE = /^[A-Za-z0-9._~-]{16,256}$/

type Landing = {
  active: boolean
  firstName: string | null
  avatarUrl: string | null
  brandName: string
  listingTitle: string
  buyerDiscount: boolean
  destinationUrl: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character)
}

function functionsBase(): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  const project = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  return project ? `${project.replace(/\/$/, '')}/functions/v1` : null
}

function projectBase(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, '') || null
}

function anonKey(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null
}

async function landingContext(slug: string, kind: string, id: string): Promise<Landing | null> {
  const project = projectBase()
  const anon = anonKey()
  if (!project || !anon) return null
  const response = await fetch(`${project}/rest/v1/rpc/public_referral_landing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anon, authorization: `Bearer ${anon}` },
    body: JSON.stringify({ p_slug: slug, p_listing_kind: kind, p_listing_id: id }),
    cache: 'no-store',
  }).catch(() => null)
  if (!response?.ok) return null
  const value = await response.json().catch(() => null) as Landing | null
  return value && typeof value.destinationUrl === 'string' ? value : null
}

async function recordTouch(
  request: NextRequest,
  input: { slug: string; kind: string; id: string; deviceToken: string },
): Promise<string | null> {
  const base = functionsBase()
  const anon = anonKey()
  if (!base || !anon) return null
  const forwarded = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '127.0.0.1'
  const response = await fetch(`${base}/referral-touch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', apikey: anon, authorization: `Bearer ${anon}`,
      'x-forwarded-for': forwarded, 'user-agent': request.headers.get('user-agent') ?? '',
      referer: `${request.nextUrl.origin}/r/${input.slug}`,
    },
    body: JSON.stringify({
      kind: 'member', slug: input.slug, surface: 'web', deviceToken: input.deviceToken,
      listingKind: input.kind, listingId: input.id,
    }),
    cache: 'no-store',
  }).catch(() => null)
  if (!response?.ok) return null
  const value = await response.json().catch(() => null) as { visitorKey?: unknown } | null
  return typeof value?.visitorKey === 'string' && VISITOR.test(value.visitorKey)
    ? value.visitorKey
    : null
}

function referralLandingHtml(landing: Landing): string {
  const sharer = landing.active && landing.firstName ? escapeHtml(landing.firstName) : 'A friend'
  const title = escapeHtml(landing.listingTitle || landing.brandName || 'A Mingla experience')
  const brand = escapeHtml(landing.brandName || 'Mingla')
  const destination = escapeHtml(landing.destinationUrl)
  const avatar = landing.active && typeof landing.avatarUrl === 'string' && /^https:\/\//.test(landing.avatarUrl)
    ? `<img src="${escapeHtml(landing.avatarUrl)}" alt="" referrerpolicy="no-referrer" />`
    : `<span aria-hidden="true">${escapeHtml(sharer.slice(0, 1).toUpperCase())}</span>`
  const discount = landing.buyerDiscount
    ? '<p class="discount">A friend discount is available and will appear before checkout.</p>'
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" /><title>${title} · Mingla</title>
<style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#fff;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;padding:24px}.card{width:min(100%,520px);background:#18181b;border:1px solid #3f3f46;border-radius:28px;padding:28px;box-shadow:0 24px 80px #0008}.by{display:flex;align-items:center;gap:12px;color:#d4d4d8}.avatar,.avatar img{width:44px;height:44px;border-radius:50%}.avatar{display:grid;place-items:center;background:#f97316;color:#fff;font-weight:900}.avatar img{object-fit:cover}.eyebrow{font-size:12px;font-weight:850;letter-spacing:.12em;color:#fb923c;margin:28px 0 8px}.title{font-size:clamp(30px,8vw,48px);line-height:1.02;margin:0}.brand{color:#a1a1aa;margin:10px 0 0}.discount{background:#2b1b11;border:1px solid #9a4c17;border-radius:16px;padding:14px;color:#fed7aa}.cta{display:block;text-align:center;background:#f97316;color:#fff;text-decoration:none;font-weight:850;border-radius:999px;padding:15px 18px;margin-top:26px}.fine{color:#71717a;font-size:12px;line-height:1.5;margin:18px 4px 0}</style></head>
<body><main class="card"><div class="by"><div class="avatar">${avatar}</div><strong>${sharer} shared this with you</strong></div><p class="eyebrow">DISCOVER ON MINGLA</p><h1 class="title">${title}</h1><p class="brand">Hosted by ${brand}</p>${discount}<a class="cta" href="${destination}">View details</a><p class="fine">Rewards apply only to eligible completed purchases. Opening this link does not charge you.</p></main></body></html>`
}

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await context.params
  const slug = rawSlug.trim().toLowerCase()
  const kind = request.nextUrl.searchParams.get('kind') ?? ''
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!SLUG.test(slug) || !['event', 'venue'].includes(kind) || !UUID.test(id)) {
    return new Response('Not Found', { status: 404, headers: { 'cache-control': 'private, no-store' } })
  }
  const landing = await landingContext(slug, kind, id)
  if (!landing) return NextResponse.redirect(new URL('https://host.usemingla.com'), 302)

  const existingDevice = request.cookies.get('mingla_referral_device')?.value ?? ''
  const deviceToken = DEVICE.test(existingDevice)
    ? existingDevice
    : `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
  const visitorKey = landing.active
    ? await recordTouch(request, { slug, kind, id, deviceToken })
    : null
  const response = new NextResponse(referralLandingHtml(landing), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  })
  const domain = request.nextUrl.hostname === 'usemingla.com' || request.nextUrl.hostname.endsWith('.usemingla.com')
    ? '.usemingla.com'
    : undefined
  response.cookies.set('mingla_referral_device', deviceToken, {
    httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, path: '/', domain,
  })
  if (visitorKey) {
    response.cookies.set('mingla_referral_visitor', visitorKey, {
      httpOnly: false, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, path: '/', domain,
    })
  }
  return response
}
