import { supabase } from './supabase'

interface SendOtpResult {
  success: boolean
  error?: string
  status?: string
}

interface VerifyOtpResult {
  success: boolean
  error?: string
}

/**
 * Extract the real error message from a Supabase FunctionsHttpError.
 * supabase-js v2 wraps non-2xx responses in a FunctionsHttpError with
 * the generic message "Edge Function returned a non-2xx status code".
 * The actual error body is in error.context (the raw Response object).
 */
async function extractFunctionError(error: any, fallback: string): Promise<string> {
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const body = await error.context.json()
      if (body?.error) return body.error
    }
  } catch {
    // Response body couldn't be parsed — fall through
  }
  return fallback
}

/**
 * Send OTP to the given phone number via Twilio Verify (proxied through edge function).
 */
export async function sendOtp(phone: string): Promise<SendOtpResult> {
  const { data, error } = await supabase.functions.invoke('send-otp', {
    body: { phone },
  })

  if (error) {
    console.error('[sendOtp] Edge function error:', error.name, error.message)
    const msg = await extractFunctionError(error, "Couldn't send code. Try again.")
    console.error('[sendOtp] Actual error:', msg)
    return { success: false, error: msg }
  }

  if (data?.error) {
    return { success: false, error: data.error }
  }

  return { success: true, status: data?.status }
}

/**
 * Verify OTP code. On success, phone is saved to profiles.phone server-side.
 */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const { data, error } = await supabase.functions.invoke('verify-otp', {
    body: { phone, code },
  })

  if (error) {
    console.error('[verifyOtp] Edge function error:', error.name, error.message)
    const msg = await extractFunctionError(error, 'Verification failed. Try again.')
    console.error('[verifyOtp] Actual error:', msg)
    return { success: false, error: msg }
  }

  if (data?.error) {
    return { success: false, error: data.error }
  }

  return { success: true }
}
