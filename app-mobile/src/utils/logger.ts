// Structured domain-prefixed logger for Metro terminal troubleshooting
// All output goes through console.log/error (captured by debugService automatically)

const fmt = (data?: Record<string, unknown>): string => {
  if (!data) return '';
  try {
    const parts = Object.entries(data).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
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

  error(message: string, data?: Record<string, unknown>) {
    console.error(`[ERROR] ${message}${fmt(data)}`);
  },
};
