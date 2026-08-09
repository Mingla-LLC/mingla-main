import { isShortShareCode } from '@mingla/sharing';

export const CONTENT_SHARE_ATTRIBUTION_KEY = '@mingla_content_share_attribution';

export type ContentShareAttribution = { shortCode: string; version: number };
export type ContentShareAttributionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
export type IdentifiedActivationCapture = (
  event: 'share_native_opened',
  properties: {
    short_code: string;
    version: number;
    recipient_app: 'consumer';
    recipient_surface: 'native_content_share';
    outcome: 'identified_activation';
  },
) => void;

const listeners = new Set<() => void>();
let consumePromise: Promise<'empty' | 'malformed' | 'consumed'> | null = null;

export const parseContentShareAttribution = (raw: string): ContentShareAttribution | null => {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== 'shortCode' || keys[1] !== 'version') return null;
    if (!isShortShareCode(record.shortCode)) return null;
    if (!Number.isSafeInteger(record.version) || (record.version as number) < 1 || (record.version as number) > 1_000_000_000) return null;
    return { shortCode: record.shortCode, version: record.version as number };
  } catch {
    return null;
  }
};

export const persistContentShareAttribution = async (
  storage: ContentShareAttributionStorage,
  value: ContentShareAttribution,
): Promise<boolean> => {
  const exact = parseContentShareAttribution(JSON.stringify(value));
  if (!exact) return false;
  await storage.setItem(CONTENT_SHARE_ATTRIBUTION_KEY, JSON.stringify(exact));
  for (const listener of listeners) {
    try { listener(); } catch { /* Analytics readiness must never break /s resolution. */ }
  }
  return true;
};

export const subscribeContentShareAttributionWrites = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const consumeContentShareAttributionAfterIdentity = (
  storage: ContentShareAttributionStorage,
  capture: IdentifiedActivationCapture,
): Promise<'empty' | 'malformed' | 'consumed'> => {
  if (consumePromise) return consumePromise;
  const operation = (async () => {
    const raw = await storage.getItem(CONTENT_SHARE_ATTRIBUTION_KEY);
    if (raw === null) return 'empty' as const;
    const value = parseContentShareAttribution(raw);
    if (value === null) {
      await storage.removeItem(CONTENT_SHARE_ATTRIBUTION_KEY);
      return 'malformed' as const;
    }
    // Delete before capture: a crash/re-render can never emit the activation
    // twice. A failed delete emits nothing and leaves the state retryable.
    await storage.removeItem(CONTENT_SHARE_ATTRIBUTION_KEY);
    capture('share_native_opened', {
      short_code: value.shortCode,
      version: value.version,
      recipient_app: 'consumer',
      recipient_surface: 'native_content_share',
      outcome: 'identified_activation',
    });
    return 'consumed' as const;
  })().finally(() => {
    if (consumePromise === operation) consumePromise = null;
  });
  consumePromise = operation;
  return operation;
};
