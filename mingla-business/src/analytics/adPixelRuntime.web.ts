/**
 * Lazy browser-pixel bootstrap for buyer web.
 *
 * `webAnalytics.web.ts` imports this module as soon as arrival tracking is
 * allowed. Keeping the vendor queue shims out of the eager application chunk
 * preserves the arrival-time contract without charging every first render for
 * four provider loaders.
 */

export interface AdPixelIds {
  meta: string | null;
  tiktok: string | null;
  snap: string | null;
  reddit: string | null;
}

type QueuedPixel = ((...args: unknown[]) => void) & Record<string, unknown>;

type PixelWindow = Window & {
  fbq?: ((...args: unknown[]) => void) & {
    callMethod?: (...args: unknown[]) => void;
    queue?: unknown[];
  };
  _fbq?: unknown;
  ttq?: {
    page?: (...args: unknown[]) => void;
    track?: (...args: unknown[]) => void;
    load?: (...args: unknown[]) => void;
    [key: string]: unknown;
  };
  TiktokAnalyticsObject?: string;
  snaptr?: ((...args: unknown[]) => void) & { queue?: unknown[] };
  rdt?: ((...args: unknown[]) => void) & { callQueue?: unknown[] };
  __minglaAdPixelsBootstrapped?: boolean;
  __minglaAdPageViewKeys?: Record<string, true>;
  __minglaAdViewContentKeys?: Record<string, true>;
};

interface AdCommerceEventProps {
  value?: number;
  currency?: string;
  contentId?: string;
  brandId?: string;
}

interface CompleteAdCommerceEventProps {
  value: number;
  currency: string;
  contentId: string;
  brandId: string;
}

const firedViewContentKeys = new Set<string>();

function pixelWindow(): PixelWindow {
  return window as PixelWindow;
}

function injectPixelScriptOnce(src: string, marker: string): void {
  if (window.document.querySelector(`script[data-mingla-pixel="${marker}"]`))
    return;
  const script = window.document.createElement("script");
  script.async = true;
  script.src = src;
  script.setAttribute("data-mingla-pixel", marker);
  window.document.head.appendChild(script);
}

function safePixel(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn("[webAnalytics] pixel call failed (non-fatal):", err);
  }
}

function currentAdPageViewKey(): string | null {
  const href = (window as unknown as { location?: { href?: unknown } }).location
    ?.href;
  return typeof href === "string" && href.length > 0
    ? href.split("#", 1)[0]
    : null;
}

function markAdPageViewFired(): void {
  const key = currentAdPageViewKey();
  if (key === null) return;
  const runtime = pixelWindow();
  const keys = (runtime.__minglaAdPageViewKeys ??= {});
  keys[key] = true;
}

function createQueuedPixel(handlerKey: string, queueKey: string): QueuedPixel {
  const pixel = function queuedPixel(...args: unknown[]): void {
    const handler = pixel[handlerKey];
    if (typeof handler === "function") handler(...args);
    else (pixel[queueKey] as unknown[][]).push(args);
  } as QueuedPixel;
  pixel[queueKey] = [];
  return pixel;
}

function bootstrapMetaPixel(pixelId: string): void {
  const runtime = pixelWindow();
  if (runtime.fbq === undefined) {
    const queued = createQueuedPixel("callMethod", "queue");
    const stub = queued as unknown as {
      push: unknown;
      loaded: boolean;
      version: string;
      queue: unknown[];
    };
    stub.push = queued;
    stub.loaded = true;
    stub.version = "2.0";
    stub.queue = [];
    runtime.fbq = queued as PixelWindow["fbq"];
    runtime._fbq = runtime.fbq;
  }
  injectPixelScriptOnce(
    "https://connect.facebook.net/en_US/fbevents.js",
    "meta",
  );
  runtime.fbq?.("init", pixelId);
  runtime.fbq?.("track", "PageView");
}

function bootstrapTikTokPixel(pixelCode: string): void {
  const runtime = pixelWindow();
  runtime.TiktokAnalyticsObject = "ttq";
  const ttq = (runtime.ttq = runtime.ttq ?? {}) as unknown as {
    methods: string[];
    setAndDefer: (obj: Record<string, unknown>, method: string) => void;
    load: (id: string) => void;
    page: () => void;
    push: (args: unknown) => void;
    _i?: Record<string, unknown[]>;
    _t?: Record<string, number>;
    _o?: Record<string, unknown>;
    [key: string]: unknown;
  };
  ttq.push =
    ttq.push ??
    ((args: unknown): void => {
      ((ttq as unknown as { _q?: unknown[] })._q =
        (ttq as unknown as { _q?: unknown[] })._q ?? []).push(args);
    });
  ttq.methods = [
    "page",
    "track",
    "identify",
    "instances",
    "debug",
    "on",
    "off",
    "once",
    "ready",
    "alias",
    "group",
    "enableCookie",
    "disableCookie",
    "holdConsent",
    "revokeConsent",
    "grantConsent",
  ];
  ttq.setAndDefer = function (
    obj: Record<string, unknown>,
    method: string,
  ): void {
    obj[method] = function (): void {
      // eslint-disable-next-line prefer-rest-params
      const args = Array.prototype.slice.call(arguments) as unknown[];
      (obj as unknown as { push: (entry: unknown) => void }).push([
        method,
        ...args,
      ]);
    };
  };
  for (const method of ttq.methods)
    ttq.setAndDefer(ttq as unknown as Record<string, unknown>, method);
  ttq.load = function (id: string): void {
    ttq._i = ttq._i ?? {};
    ttq._i[id] = [];
    ttq._t = ttq._t ?? {};
    ttq._t[id] = Number(new Date());
    ttq._o = ttq._o ?? {};
    ttq._o[id] = {};
    injectPixelScriptOnce(
      `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${id}&lib=ttq`,
      "tiktok",
    );
  };
  ttq.load(pixelCode);
  ttq.page();
}

function bootstrapSnapPixel(pixelId: string): void {
  const runtime = pixelWindow();
  if (runtime.snaptr === undefined) {
    runtime.snaptr = createQueuedPixel(
      "handleRequest",
      "queue",
    ) as PixelWindow["snaptr"];
  }
  injectPixelScriptOnce("https://sc-static.net/scevent.min.js", "snap");
  runtime.snaptr?.("init", pixelId);
  runtime.snaptr?.("track", "PAGE_VIEW");
}

function bootstrapRedditPixel(pixelId: string): void {
  const runtime = pixelWindow();
  if (runtime.rdt === undefined) {
    runtime.rdt = createQueuedPixel(
      "sendEvent",
      "callQueue",
    ) as PixelWindow["rdt"];
  }
  injectPixelScriptOnce("https://www.redditstatic.com/ads/pixel.js", "reddit");
  runtime.rdt?.("init", pixelId);
  runtime.rdt?.("track", "PageVisit");
}

/** Bootstrap every configured provider once; one failure cannot block another. */
export function bootstrapAdPixels(pixelIds: AdPixelIds): void {
  const runtime = pixelWindow();
  if (runtime.__minglaAdPixelsBootstrapped === true) return;
  runtime.__minglaAdPixelsBootstrapped = true;
  if (pixelIds.meta)
    safePixel(() => bootstrapMetaPixel(pixelIds.meta as string));
  if (pixelIds.tiktok)
    safePixel(() => bootstrapTikTokPixel(pixelIds.tiktok as string));
  if (pixelIds.snap)
    safePixel(() => bootstrapSnapPixel(pixelIds.snap as string));
  if (pixelIds.reddit)
    safePixel(() => bootstrapRedditPixel(pixelIds.reddit as string));
  markAdPageViewFired();
}

function definedProps(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined && obj[key] !== null) out[key] = obj[key];
  }
  return out;
}

function completeAdCommerceEventProps(
  props: AdCommerceEventProps | null | undefined,
): CompleteAdCommerceEventProps | null {
  const value = props?.value;
  const currency = props?.currency?.trim().toUpperCase() ?? "";
  const contentId = props?.contentId?.trim() ?? "";
  const brandId = props?.brandId?.trim() ?? "";
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !/^[A-Z]{3}$/.test(currency) ||
    !contentId ||
    !brandId
  ) {
    return null;
  }
  return { value, currency, contentId, brandId };
}

export function fireAdPageView(): void {
  const runtime = pixelWindow();
  if (runtime.__minglaAdPixelsBootstrapped !== true) return;
  const keys = (runtime.__minglaAdPageViewKeys ??= {});
  const key = currentAdPageViewKey();
  if (key === null || keys[key]) return;
  keys[key] = true;
  safePixel(() => runtime.fbq?.("track", "PageView"));
  safePixel(() => runtime.ttq?.page?.());
  safePixel(() => runtime.snaptr?.("track", "PAGE_VIEW"));
  safePixel(() => runtime.rdt?.("track", "PageVisit"));
}

export function fireAdViewContent(
  props?: AdCommerceEventProps & { eventId?: string },
): void {
  const runtime = pixelWindow();
  if (runtime.__minglaAdPixelsBootstrapped !== true) return;
  const completeProps = completeAdCommerceEventProps(props);
  if (completeProps === null) return;
  const { value, currency, contentId, brandId } = completeProps;
  const serverKeys = (runtime.__minglaAdViewContentKeys ??= {});
  if (serverKeys[contentId] || firedViewContentKeys.has(contentId)) return;
  const eventId =
    props?.eventId ??
    globalThis.crypto?.randomUUID?.() ??
    `view-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  firedViewContentKeys.add(contentId);
  serverKeys[contentId] = true;
  safePixel(() =>
    runtime.fbq?.(
      "track",
      "ViewContent",
      definedProps({
        value,
        currency,
        content_type: "product",
        content_ids: [contentId],
        brand_id: brandId,
      }),
      { eventID: eventId },
    ),
  );
  safePixel(() =>
    runtime.ttq?.track?.(
      "ViewContent",
      definedProps({
        value,
        currency,
        content_type: "product",
        content_id: contentId,
        brand_id: brandId,
      }),
      { event_id: eventId },
    ),
  );
  safePixel(() =>
    runtime.snaptr?.(
      "track",
      "VIEW_CONTENT",
      definedProps({
        price: value,
        currency,
        item_ids: [contentId],
        brand_id: brandId,
        transaction_id: eventId,
        client_dedup_id: eventId,
      }),
    ),
  );
  safePixel(() =>
    runtime.rdt?.("track", "ViewContent", definedProps({ value, currency })),
  );
}

function fireAdConversion(
  eventId: string,
  props: AdCommerceEventProps,
  purchase: boolean,
): void {
  const runtime = pixelWindow();
  if (runtime.__minglaAdPixelsBootstrapped !== true || !eventId) return;
  const completeProps = completeAdCommerceEventProps(props);
  if (completeProps === null) return;
  const { value, currency, contentId, brandId } = completeProps;
  safePixel(() =>
    runtime.fbq?.(
      "track",
      purchase ? "Purchase" : "CompleteRegistration",
      definedProps({
        value,
        currency,
        content_type: "product",
        content_ids: [contentId],
        brand_id: brandId,
      }),
      { eventID: eventId },
    ),
  );
  safePixel(() =>
    runtime.ttq?.track?.(
      purchase ? "CompletePayment" : "CompleteRegistration",
      definedProps({
        value,
        currency,
        content_type: "product",
        content_id: contentId,
        brand_id: brandId,
      }),
      { event_id: eventId },
    ),
  );
  safePixel(() =>
    runtime.snaptr?.(
      "track",
      purchase ? "PURCHASE" : "SIGN_UP",
      definedProps({
        price: value,
        currency,
        item_ids: [contentId],
        brand_id: brandId,
        transaction_id: eventId,
        client_dedup_id: eventId,
      }),
    ),
  );
  safePixel(() =>
    runtime.rdt?.(
      "track",
      purchase ? "Purchase" : "SignUp",
      definedProps({ value, currency, conversion_id: eventId }),
    ),
  );
}

export function fireAdPurchase(
  eventId: string,
  props: AdCommerceEventProps,
): void {
  const isPaidPurchase = !(typeof props.value === "number" && props.value <= 0);
  fireAdConversion(eventId, props, isPaidPurchase);
}

export function fireAdReservation(
  eventId: string,
  props: AdCommerceEventProps = {},
): void {
  fireAdConversion(eventId, props, false);
}

export function fireAdInitiateCheckout(
  eventId: string,
  props: AdCommerceEventProps = {},
): void {
  const runtime = pixelWindow();
  if (runtime.__minglaAdPixelsBootstrapped !== true || !eventId) return;
  const completeProps = completeAdCommerceEventProps(props);
  if (completeProps === null) return;
  const { value, currency, contentId, brandId } = completeProps;
  safePixel(() =>
    runtime.fbq?.(
      "track",
      "InitiateCheckout",
      definedProps({
        value,
        currency,
        content_type: "product",
        content_ids: [contentId],
        brand_id: brandId,
      }),
      { eventID: eventId },
    ),
  );
  safePixel(() =>
    runtime.ttq?.track?.(
      "InitiateCheckout",
      definedProps({
        value,
        currency,
        content_type: "product",
        content_id: contentId,
        brand_id: brandId,
      }),
      { event_id: eventId },
    ),
  );
  safePixel(() =>
    runtime.snaptr?.(
      "track",
      "START_CHECKOUT",
      definedProps({
        price: value,
        currency,
        item_ids: [contentId],
        brand_id: brandId,
        transaction_id: eventId,
        client_dedup_id: eventId,
      }),
    ),
  );
}

async function sha256Browser(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function identifyAdBuyer(input: {
  email?: string | null;
  phone?: string | null;
}): Promise<void> {
  const runtime = pixelWindow();
  if (runtime.__minglaAdPixelsBootstrapped !== true) return;
  const identify = runtime.ttq?.identify;
  if (typeof identify !== "function") return;
  const email = input.email?.trim().toLowerCase() ?? "";
  const phone = input.phone?.replace(/[^0-9]/g, "") ?? "";
  const payload = definedProps({
    email: email ? await sha256Browser(email) : undefined,
    phone_number: phone ? await sha256Browser(phone) : undefined,
  });
  if (Object.keys(payload).length > 0) safePixel(() => identify(payload));
}
