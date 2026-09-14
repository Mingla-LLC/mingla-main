function configuredKey(): string | null {
  const value = process.env.INDEXNOW_KEY?.trim() ?? ''
  return /^[A-Za-z0-9-]{8,128}$/.test(value) ? value : null
}

export function GET(): Response {
  const key = configuredKey()
  if (key === null) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'cache-control': 'private, no-store' },
    })
  }
  return new Response(key, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
    },
  })
}

export function HEAD(): Response {
  const response = GET()
  return new Response(null, { status: response.status, headers: response.headers })
}
