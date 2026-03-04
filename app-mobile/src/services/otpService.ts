import { supabase } from './supabase'

interface SendOtpResult {
  success: boolean
  error?: string
}

interface VerifyOtpResult {
  success: boolean
  error?: string
}

/**
 * Send OTP to the given phone number via Twilio Verify (proxied through edge function).
 */
export async function sendOtp(phone: string): Promise<SendOtpResult> {
  const { data, error } = await supabase.functions.invoke('send-otp', {
    body: { phone },
  })

  if (error) {
    return { success: false, error: error.message ?? "Couldn't send code. Try again." }
  }

  if (data?.error) {
    return { success: false, error: data.error }
  }

  return { success: true }
}

/**
 * Verify OTP code. On success, phone is saved to profiles.phone server-side.
 */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const { data, error } = await supabase.functions.invoke('verify-otp', {
    body: { phone, code },
  })

  if (error) {
    return { success: false, error: error.message ?? 'Verification failed. Try again.' }
  }

  if (data?.error) {
    return { success: false, error: data.error }
  }

  return { success: true }
}
