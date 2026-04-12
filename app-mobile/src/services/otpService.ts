import { trackedInvoke } from './supabase'
import { extractFunctionError } from '../utils/edgeFunctionError'

export type OtpChannel = 'sms' | 'whatsapp' | 'call'

interface SendOtpResult {
  success: boolean
  error?: string
  status?: string
  channel?: OtpChannel
}

interface VerifyOtpResult {
  success: boolean
  error?: string
}

/**
 * Send OTP to the given phone number via Twilio Verify (proxied through edge function).
 */
export async function sendOtp(phone: string, channel?: OtpChannel): Promise<SendOtpResult> {
  const { data, error } = await trackedInvoke('send-otp', {
    body: { phone, ...(channel && { channel }) },
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

  return { success: true, status: data?.status, channel: data?.channel }
}

/**
 * Verify OTP code. On success, phone is saved to profiles.phone server-side.
 */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const { data, error } = await trackedInvoke('verify-otp', {
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
