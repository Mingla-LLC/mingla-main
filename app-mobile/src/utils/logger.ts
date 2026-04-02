// Structured domain-prefixed logger for Metro terminal troubleshooting
// All output goes through console.log/error
// Every log also records a breadcrumb for error context trail

import { breadcrumbs, BreadcrumbCategory } from './breadcrumbs'

const fmt = (data?: Record<string, unknown>): string => {
  if (!data) return '';
  try {
    const parts = Object.entries(data).map(([k, v]) => {
      if (v instanceof Error) return `${k}="${v.message}"`;
      return `${k}=${JSON.stringify(v)}`;
    });
    return ` | ${parts.join(', ')}`;
  } catch {
    return '';
  }
};

/** Log + record breadcrumb in one call. */
const logAndCrumb = (
  domain: string,
  category: BreadcrumbCategory,
  message: string,
  data?: Record<string, unknown>,
) => {
  console.log(`[${domain}] ${message}${fmt(data)}`);
  breadcrumbs.add(category, message, data);
};

export const logger = {
  nav(message: string, data?: Record<string, unknown>) {
    logAndCrumb('NAV', 'nav', message, data);
  },

  auth(message: string, data?: Record<string, unknown>) {
    logAndCrumb('AUTH', 'auth', message, data);
  },

  onboarding(message: string, data?: Record<string, unknown>) {
    logAndCrumb('ONBOARDING', 'action', message, data);
  },

  action(message: string, data?: Record<string, unknown>) {
    logAndCrumb('ACTION', 'action', message, data);
  },

  lifecycle(message: string, data?: Record<string, unknown>) {
    logAndCrumb('LIFECYCLE', 'lifecycle', message, data);
  },

  network(message: string, data?: Record<string, unknown>) {
    logAndCrumb('NETWORK', 'network', message, data);
  },

  query(message: string, data?: Record<string, unknown>) {
    logAndCrumb('QUERY', 'query', message, data);
  },

  supabase(message: string, data?: Record<string, unknown>) {
    logAndCrumb('SUPABASE', 'action', message, data);
  },

  /** Log Zustand store state changes — called by the devLogger middleware. */
  store(action: string, data?: Record<string, unknown>) {
    logAndCrumb('STORE', 'action', action, data);
  },

  /** Log edge function invocations — called by trackedInvoke wrapper. */
  edge(message: string, data?: Record<string, unknown>) {
    logAndCrumb('EDGE', 'network', message, data);
  },

  /** Log Supabase Realtime channel events. */
  realtime(message: string, data?: Record<string, unknown>) {
    logAndCrumb('REALTIME', 'network', message, data);
  },

  /** Log OneSignal push notification events. */
  push(message: string, data?: Record<string, unknown>) {
    logAndCrumb('PUSH', 'action', message, data);
  },

  /** Log mutation start/success/error — called by QueryClient mutation cache. */
  mutation(message: string, data?: Record<string, unknown>) {
    logAndCrumb('MUTATION', 'mutation', message, data);
  },

  render(message: string, data?: Record<string, unknown>) {
    // Render logs are high-frequency — log to console but do NOT record breadcrumbs
    // to avoid flooding the 30-entry buffer with noise.
    console.log(`[RENDER] ${message}${fmt(data)}`);
  },

  /** Log a tap event (used by TrackedTouchableOpacity — but also available for manual use). */
  tap(label: string, data?: Record<string, unknown>) {
    logAndCrumb('TAP', 'tap', label, data);
  },

  /** Non-fatal issues — console.warn + breadcrumb (no dump). */
  warn(message: string, data?: Record<string, unknown>) {
    console.warn(`[WARN] ${message}${fmt(data)}`);
    breadcrumbs.add('action', `warn: ${message}`, data);
  },

  error(message: string, data?: Record<string, unknown>) {
    console.error(`[ERROR] ${message}${fmt(data)}`);
    breadcrumbs.add('error', message, data);
    breadcrumbs.dump(message);
  },

  /** Log an error with its full stack trace visible in Metro terminal + dump breadcrumbs. */
  errorWithStack(domain: string, message: string, error: unknown) {
    if (error instanceof Error) {
      console.error(
        `[${domain}] ${message} | ${error.name}: ${error.message}\n${error.stack ?? '(no stack)'}`
      );
      breadcrumbs.add('error', `${domain}: ${message} — ${error.message}`);
    } else {
      console.error(`[${domain}] ${message} | ${String(error)}`);
      breadcrumbs.add('error', `${domain}: ${message} — ${String(error)}`);
    }
    breadcrumbs.dump(`${domain}: ${message}`);
  },
};
