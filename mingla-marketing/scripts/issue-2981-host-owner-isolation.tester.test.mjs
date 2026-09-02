import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import test, { after, before } from 'node:test'

const APEX = 'https://usemingla.com'
const WWW = 'www.usemingla.com'
let child
let port

function request(pathname, { host = WWW, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: { Host: host, 'Content-Type': 'text/plain;charset=UTF-8' },
      },
      (response) => {
        response.resume()
        response.on('end', () =>
          resolve({ status: response.statusCode, location: response.headers.location ?? null }),
        )
      },
    )
    req.once('error', reject)
    req.end(method === 'POST' ? '{}' : undefined)
  })
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

before(async () => {
  port = await freePort()
  child = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: process.cwd(), env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' },
  )
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited early with ${child.exitCode}`)
    try {
      if ((await request('/robots.txt', { host: 'usemingla.com' })).status === 200) return
    } catch {
      // Server socket is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('next start did not become ready within 20 seconds')
})

after(async () => {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
})

test('exact www normalization preserves path and query meaning without suffix-host capture', async () => {
  const redirect = await request('/tools/events?utm_term=date%20plans&literal=1%2B2')
  assert.equal(redirect.status, 308)
  const target = new URL(redirect.location)
  assert.equal(`${target.origin}${target.pathname}`, `${APEX}/tools/events`)
  assert.equal(target.searchParams.get('utm_term'), 'date plans')
  assert.equal(target.searchParams.get('literal'), '1+2')

  for (const host of ['evilwww.usemingla.com', 'www.usemingla.com.evil.test']) {
    assert.notEqual((await request('/host', { host })).status, 308, `${host} must not be captured`)
  }
})

test('careers, association files, every public-share owner, and share analytics stay isolated', async () => {
  const isolated = [
    ['/.well-known/apple-app-site-association', 'GET'],
    [`/p/${'a'.repeat(36)}`, 'GET'],
    ['/s/Aa0Bb1Cc2Dd3Ee4F', 'GET'],
    ['/api/content-share/Aa0Bb1Cc2Dd3Ee4F', 'GET'],
    ['/api/content-share-readiness/Aa0Bb1Cc2Dd3Ee4F/1', 'GET'],
    ['/api/content-share-analytics', 'POST'],
  ]
  for (const [pathname, method] of isolated) {
    const response = await request(pathname, { method })
    assert.notEqual(response.status, 308, `${method} ${pathname} was captured by www normalization`)
    assert.equal(response.location, null, `${method} ${pathname} emitted a redirect location`)
  }

  const careers = await request('/', { host: 'career.usemingla.com' })
  assert.equal(careers.status, 200)
  assert.equal(careers.location, null)
})
