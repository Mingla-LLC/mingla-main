// #4238 — a small fake browser for the usemingla.com ad-tracking tests (not a
// test itself). Enough of window / document / storage / cookies / fetch for
// lib/marketing-pixels.ts, lib/landing-campaign.ts, lib/ad-click-capture.ts and
// lib/marketing-ad-context.ts to run their real code in node: script elements
// land in a recorded <head>, cookie writes are recorded, sessionStorage and
// localStorage are maps, fetch is a stub that records every request.

class FakeStorage {
  constructor() {
    this.map = new Map()
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null
  }
  setItem(k, v) {
    this.map.set(k, String(v))
  }
  removeItem(k) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.attributes = new Map()
    this.parent = null
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v))
  }
  getAttribute(k) {
    return this.attributes.has(k) ? this.attributes.get(k) : null
  }
  remove() {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((c) => c !== this)
    this.parent = null
  }
}

const MARKER = /^script\[data-mingla-pixel(?:="([^"]+)")?\]$/

/**
 * Installs the fake on globalThis and returns its handles. `url` is the page
 * URL; `gpc` turns Global Privacy Control on.
 */
export function installFakeBrowser({ url = 'https://usemingla.com/', gpc = false, cookie = '' } = {}) {
  const head = { children: [] }
  head.appendChild = (el) => {
    el.parent = head
    head.children.push(el)
    return el
  }
  const cookieWrites = []
  let cookieJar = cookie
  const document = {
    head,
    referrer: '',
    createElement: (tag) => new FakeElement(tag),
    querySelector(selector) {
      const m = MARKER.exec(selector)
      if (!m) return null
      return head.children.find((el) => el.tagName === 'SCRIPT' && el.getAttribute('data-mingla-pixel') !== null && (!m[1] || el.getAttribute('data-mingla-pixel') === m[1])) ?? null
    },
    querySelectorAll(selector) {
      const m = MARKER.exec(selector)
      if (!m) return []
      return head.children.filter((el) => el.tagName === 'SCRIPT' && el.getAttribute('data-mingla-pixel') !== null && (!m[1] || el.getAttribute('data-mingla-pixel') === m[1]))
    },
    get cookie() {
      return cookieJar
    },
    set cookie(value) {
      cookieWrites.push(value)
    },
  }
  const location = new URL(url)
  const requests = []
  let fetchAnswer = () => ({ status: 200, body: {} })
  const win = {
    document,
    location,
    sessionStorage: new FakeStorage(),
    localStorage: new FakeStorage(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true
    },
  }
  globalThis.window = win
  globalThis.document = document
  Object.defineProperty(globalThis, 'navigator', { value: { globalPrivacyControl: gpc, userAgent: 'node' }, configurable: true, writable: true })
  globalThis.fetch = async (input, init = {}) => {
    const request = { url: String(input), body: init.body ? JSON.parse(init.body) : null }
    requests.push(request)
    const { status, body } = fetchAnswer(request)
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  return {
    window: win,
    document,
    head,
    cookieWrites,
    requests,
    /** respond(request) => { status, body } for every later fetch. */
    answer(fn) {
      fetchAnswer = fn
    },
    setCookie(value) {
      cookieJar = value
    },
    markers: () => head.children.filter((el) => el.getAttribute('data-mingla-pixel') !== null).map((el) => el.getAttribute('data-mingla-pixel')),
    scripts: () => head.children.map((el) => el.src),
  }
}

export function uninstallFakeBrowser() {
  delete globalThis.window
  delete globalThis.document
}

/** Saves the visitor's privacy choice the way the site does (mingla_privacy_v2). */
export function savePrivacy(win, { analytics = true, ads }) {
  win.localStorage.setItem('mingla_privacy_v2', JSON.stringify({ analytics, ads, ts: 1 }))
}

/** Every call made to a queued vendor global (fbq, snaptr, rdt) and to ttq. */
export function vendorCalls(win) {
  return {
    fbq: [...(win.fbq?.queue ?? [])],
    snaptr: [...(win.snaptr?.queue ?? [])],
    rdt: [...(win.rdt?.callQueue ?? [])],
    ttq: [...(win.ttq?._q ?? [])],
  }
}
