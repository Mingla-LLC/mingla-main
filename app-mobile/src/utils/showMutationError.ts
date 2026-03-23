/**
 * Shared mutation error handler.
 *
 * Extracts a user-friendly message from common error types and shows a toast.
 * This is NOT a hook — the showToast function must be passed in by the caller.
 */

type ShowToastFn = (config: {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  position?: 'top' | 'bottom';
}) => void;

const SUPABASE_CODE_MESSAGES: Record<string, string> = {
  '42501': "You don't have permission to do that",
  '23505': 'This already exists',
};

function isUserFriendlyMessage(message: string): boolean {
  // Reject stack traces, raw SQL errors, and overly technical messages
  if (message.includes('\n') || message.includes('  at ')) return false;
  if (message.startsWith('ERROR:') || message.startsWith('relation ')) return false;
  if (message.length > 120) return false;
  return true;
}

function extractMessage(error: unknown, context: string): string {
  if (error == null || typeof error !== 'object') {
    return `Something went wrong while ${context}. Please try again.`;
  }

  const err = error as Record<string, unknown>;

  // Supabase error with a known code
  if (typeof err.code === 'string') {
    const mapped = SUPABASE_CODE_MESSAGES[err.code];
    if (mapped) return mapped;

    if (err.code.startsWith('PGRST')) {
      return 'Something went wrong. Please try again.';
    }
  }

  // Check .message for pattern-based matching
  if (typeof err.message === 'string') {
    const msg = err.message;

    if (msg.toLowerCase().includes('timed out')) {
      return 'Request timed out. Please try again.';
    }

    if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('fetch')) {
      return 'Network error. Please check your connection.';
    }

    if (isUserFriendlyMessage(msg)) {
      return msg;
    }
  }

  return `Something went wrong while ${context}. Please try again.`;
}

export function showMutationError(
  error: unknown,
  context: string,
  showToastFn: ShowToastFn
): void {
  console.warn('[MutationError]', context, error);

  const message = extractMessage(error, context);
  showToastFn({ message, type: 'error' });
}
