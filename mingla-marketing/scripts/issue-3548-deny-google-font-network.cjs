'use strict'

const http = require('node:http')
const https = require('node:https')

const DENIED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])
const ERROR_MESSAGE =
  '#3548 marketing builds must use pinned local fonts; build-time requests to Google Fonts are forbidden'

const normalizeHostname = (value) => {
  if (typeof value !== 'string') return undefined
  return value.toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '')
}

const hostnameFromUrlLike = (value) => {
  if (value instanceof URL) return normalizeHostname(value.hostname)
  if (typeof value === 'string') {
    try {
      return normalizeHostname(new URL(value).hostname)
    } catch {
      return undefined
    }
  }
  if (value && typeof value === 'object' && typeof value.url === 'string') {
    return hostnameFromUrlLike(value.url)
  }
  return undefined
}

const hostnameFromRequestOptions = (options) => {
  if (!options || typeof options !== 'object' || options instanceof URL) return undefined
  return normalizeHostname(options.hostname ?? options.host)
}

const requestHostname = (input, options) =>
  hostnameFromRequestOptions(options) ??
  hostnameFromRequestOptions(input) ??
  hostnameFromUrlLike(input)

const assertAllowed = (input, options) => {
  const hostname = requestHostname(input, options)
  if (hostname && DENIED_HOSTS.has(hostname)) {
    throw new Error(`${ERROR_MESSAGE}: ${hostname}`)
  }
}

const patchTransport = (transport) => {
  const originalRequest = transport.request
  transport.request = function issue3548DeniedRequest(input, options, callback) {
    assertAllowed(input, options)
    return originalRequest.call(this, input, options, callback)
  }

  transport.get = function issue3548DeniedGet(input, options, callback) {
    const request = transport.request(input, options, callback)
    request.end()
    return request
  }
}

patchTransport(http)
patchTransport(https)

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch
  globalThis.fetch = function issue3548DeniedFetch(input, init) {
    assertAllowed(input, init)
    return originalFetch.call(this, input, init)
  }
}

module.exports = {
  DENIED_HOSTS,
  ERROR_MESSAGE,
  assertAllowed,
  requestHostname,
}

if (require.main === module) {
  const preloadOption = `--require=${__filename}`
  const inheritedNodeOptions = process.env.NODE_OPTIONS?.trim()
  if (!inheritedNodeOptions?.split(/\s+/).includes(preloadOption)) {
    process.env.NODE_OPTIONS = [inheritedNodeOptions, preloadOption].filter(Boolean).join(' ')
  }
  const nextCli = require.resolve('next/dist/bin/next')
  process.argv = [process.execPath, nextCli, ...process.argv.slice(2)]
  require(nextCli)
}
