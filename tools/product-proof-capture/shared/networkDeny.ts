import { Linking } from "react-native";

type BlockedKind = "fetch" | "xhr" | "websocket" | "eventsource" | "external_link";

export const blockedAttempts: BlockedKind[] = [];

const safeTarget = (value: unknown): string => {
  try {
    const url = new URL(String(value));
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "non-url-target";
  }
};

const deny = (kind: BlockedKind, target?: unknown): never => {
  blockedAttempts.push(kind);
  const error = new Error(`capture_harness_blocked_${kind}:${safeTarget(target)}`);
  setTimeout(() => { throw error; }, 0);
  throw error;
};

export function installNetworkDeny(): void {
  const originalFetch = globalThis.fetch;
  const OriginalXHR = globalThis.XMLHttpRequest;
  const OriginalSocket = globalThis.WebSocket;
  const OriginalEventSource = (globalThis as typeof globalThis & { EventSource?: new (...args: never[]) => unknown }).EventSource;
  const isMetro = (value: unknown): boolean => /^(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(String(value));
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isMetro(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)) return originalFetch(input, init);
    return deny("fetch", typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  }) as typeof fetch;
  class DeniedXHR extends OriginalXHR {
    open(method: string, url: string, ...rest: unknown[]) {
      if (!isMetro(url)) return deny("xhr", url);
      return super.open(method, url, ...(rest as [boolean?, string?, string?]));
    }
  }
  class DeniedSocket extends OriginalSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (!isMetro(url)) deny("websocket", url);
      super(url, protocols);
    }
  }
  class DeniedEventSource extends (OriginalEventSource ?? class {}) {
    constructor(...args: never[]) {
      if (!isMetro(args[0])) deny("eventsource", args[0]);
      super(...args);
    }
  }
  Object.assign(globalThis, {
    XMLHttpRequest: DeniedXHR,
    WebSocket: DeniedSocket,
    EventSource: DeniedEventSource,
  });
  Object.assign(Linking, {
    openURL: async (url: string) => deny("external_link", url),
    canOpenURL: async (url: string) => deny("external_link", url),
  });
}

export function denyExternalLink(): never { return deny("external_link"); }
