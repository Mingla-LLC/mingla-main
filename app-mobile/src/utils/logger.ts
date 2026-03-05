// Structured domain-prefixed logger for Metro terminal troubleshooting
// All output goes through console.log/error (captured by debugService automatically)

const fmt = (data?: Record<string, unknown>): string => {
  if (!data) return '';
  try {
    const parts = Object.entries(data).map(([k, v]) => {
      // Extract stack traces from Error objects instead of losing them
      if (v instanceof Error) return `${k}="${v.message}"`;
      return `${k}=${JSON.stringify(v)}`;
    });
    return ` | ${parts.join(', ')}`;
  } catch {
    return '';
  }
};

export const logger = {
  nav(message: string, data?: Record<string, unknown>) {
    console.log(`[NAV] ${message}${fmt(data)}`);
  },

  auth(message: string, data?: Record<string, unknown>) {
    console.log(`[AUTH] ${message}${fmt(data)}`);
  },

  onboarding(message: string, data?: Record<string, unknown>) {
    console.log(`[ONBOARDING] ${message}${fmt(data)}`);
  },

  action(message: string, data?: Record<string, unknown>) {
    console.log(`[ACTION] ${message}${fmt(data)}`);
  },

  lifecycle(message: string, data?: Record<string, unknown>) {
    console.log(`[LIFECYCLE] ${message}${fmt(data)}`);
  },

  network(message: string, data?: Record<string, unknown>) {
    console.log(`[NETWORK] ${message}${fmt(data)}`);
  },

  query(message: string, data?: Record<string, unknown>) {
    console.log(`[QUERY] ${message}${fmt(data)}`);
  },

  supabase(message: string, data?: Record<string, unknown>) {
    console.log(`[SUPABASE] ${message}${fmt(data)}`);
  },

  render(message: string, data?: Record<string, unknown>) {
    console.log(`[RENDER] ${message}${fmt(data)}`);
  },

  error(message: string, data?: Record<string, unknown>) {
    console.error(`[ERROR] ${message}${fmt(data)}`);
  },

  /** Log an error with its full stack trace visible in Metro terminal */
  errorWithStack(domain: string, message: string, error: unknown) {
    if (error instanceof Error) {
      console.error(
        `[${domain}] ${message} | ${error.name}: ${error.message}\n${error.stack ?? '(no stack)'}`
      );
    } else {
      console.error(`[${domain}] ${message} | ${String(error)}`);
    }
  },
};
