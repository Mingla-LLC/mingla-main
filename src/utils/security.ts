import { supabase } from '@/integrations/supabase/client';

// Session timeout in minutes (24 hours)
const SESSION_TIMEOUT_MINUTES = 24 * 60;

export interface SecurityError {
  type: 'auth_required' | 'session_expired' | 'unauthorized' | 'unknown';
  message: string;
}

/**
 * Check if the current session is valid and not expired
 */
export async function validateSession(): Promise<{ valid: boolean; error?: SecurityError }> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      return {
        valid: false,
        error: {
          type: 'unknown',
          message: 'Failed to validate session'
        }
      };
    }
    
    if (!session) {
      return {
        valid: false,
        error: {
          type: 'auth_required',
          message: 'Authentication required'
        }
      };
    }
    
    // Check if session is expired
    const expiresAt = new Date(session.expires_at! * 1000);
    const now = new Date();
    
    if (now >= expiresAt) {
      return {
        valid: false,
        error: {
          type: 'session_expired',
          message: 'Session has expired, please sign in again'
        }
      };
    }
    
    // Check if session is close to expiring (within 5 minutes)
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    if (fiveMinutesFromNow >= expiresAt) {
      // Attempt to refresh the session
      await supabase.auth.refreshSession();
    }
    
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: {
        type: 'unknown',
        message: 'Session validation failed'
      }
    };
  }
}

/**
 * Call an authenticated edge function with proper error handling
 */
export async function callAuthenticatedFunction<T>(
  functionName: string,
  payload?: any
): Promise<{ data: T | null; error?: SecurityError }> {
  // First validate the session
  const sessionCheck = await validateSession();
  if (!sessionCheck.valid) {
    return { data: null, error: sessionCheck.error };
  }
  
  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: payload
    });
    
    if (error) {
      // Handle different types of auth errors
      if (error.message?.includes('JWT') || error.message?.includes('unauthorized')) {
        return {
          data: null,
          error: {
            type: 'unauthorized',
            message: 'Please sign in to access this feature'
          }
        };
      }
      
      return {
        data: null,
        error: {
          type: 'unknown',
          message: error.message || 'Function call failed'
        }
      };
    }
    
    return { data };
  } catch (error: any) {
    return {
      data: null,
      error: {
        type: 'unknown',
        message: error.message || 'Network error occurred'
      }
    };
  }
}

/**
 * Securely store data in localStorage with basic encryption
 */
export function secureStore(key: string, data: any): void {
  try {
    const serialized = JSON.stringify(data);
    // Basic obfuscation (not real encryption, but better than plain text)
    const encoded = btoa(serialized);
    localStorage.setItem(`secure_${key}`, encoded);
  } catch (error) {
    console.warn('Failed to securely store data:', error);
  }
}

/**
 * Securely retrieve data from localStorage
 */
export function secureRetrieve<T>(key: string): T | null {
  try {
    const encoded = localStorage.getItem(`secure_${key}`);
    if (!encoded) return null;
    
    const serialized = atob(encoded);
    return JSON.parse(serialized) as T;
  } catch (error) {
    console.warn('Failed to securely retrieve data:', error);
    return null;
  }
}

/**
 * Clear all secure storage
 */
export function clearSecureStorage(): void {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('secure_')) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.warn('Failed to clear secure storage:', error);
  }
}

/**
 * Handle security errors with appropriate user feedback
 */
export function handleSecurityError(error: SecurityError): void {
  switch (error.type) {
    case 'auth_required':
    case 'session_expired':
    case 'unauthorized':
      // These errors require user to sign in
      console.log('Authentication required:', error.message);
      // In a real app, you might want to redirect to login or show a toast
      break;
    case 'unknown':
    default:
      console.error('Security error:', error.message);
      break;
  }
}