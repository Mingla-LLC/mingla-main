import { supabase } from './supabase'

export interface PhoneLookupResult {
  found: boolean
  user: {
    id: string
    display_name: string | null
    first_name: string | null
    last_name: string | null
    username: string
    avatar_url: string | null
  } | null
  friendship_status: 'none' | 'pending_sent' | 'pending_received' | 'friends'
}

export interface PendingInvite {
  id: string
  inviterId: string
  phoneE164: string
  status: 'pending' | 'converted' | 'cancelled'
  convertedUserId: string | null
  createdAt: string
}

export async function lookupPhone(phoneE164: string): Promise<PhoneLookupResult> {
  const { data, error } = await supabase.functions.invoke('lookup-phone', {
    body: { phone_e164: phoneE164 },
  })

  if (error) {
    // Extract the real error message from the edge function response body
    let detail = error.message || 'Phone lookup failed'
    try {
      if ('context' in error && error.context instanceof Response) {
        const body = await error.context.json()
        if (body?.error) detail = body.error
      }
    } catch {
      // Response body already consumed or not JSON — use default message
    }
    console.error(`[phoneLookupService] lookupPhone error for ${phoneE164}: ${detail}`)
    throw new Error(detail)
  }

  return data as PhoneLookupResult
}

export async function createPendingInvite(inviterId: string, phoneE164: string): Promise<void> {
  const { error } = await supabase
    .from('pending_invites')
    .upsert(
      { inviter_id: inviterId, phone_e164: phoneE164, status: 'pending' },
      { onConflict: 'inviter_id,phone_e164' }
    )

  if (error) {
    console.error('[phoneLookupService] createPendingInvite error:', error)
    throw new Error(error.message || 'Failed to create pending invite')
  }
}

export async function getPendingInvites(inviterId: string): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from('pending_invites')
    .select('*')
    .eq('inviter_id', inviterId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[phoneLookupService] getPendingInvites error:', error)
    return []
  }

  return (data ?? []).map(row => ({
    id: row.id,
    inviterId: row.inviter_id,
    phoneE164: row.phone_e164,
    status: row.status,
    convertedUserId: row.converted_user_id,
    createdAt: row.created_at,
  }))
}

export async function cancelPendingInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from('pending_invites')
    .update({ status: 'cancelled' })
    .eq('id', inviteId)

  if (error) {
    console.error('[phoneLookupService] cancelPendingInvite error:', error)
    throw new Error(error.message || 'Failed to cancel pending invite')
  }
}

export async function createPendingSessionInvite(
  sessionId: string,
  inviterId: string,
  phoneE164: string
): Promise<void> {
  const { error } = await supabase
    .from('pending_session_invites')
    .upsert(
      { session_id: sessionId, inviter_id: inviterId, phone_e164: phoneE164, status: 'pending' },
      { onConflict: 'session_id,phone_e164' }
    )

  if (error) {
    console.error('[phoneLookupService] createPendingSessionInvite error:', error)
    throw new Error(error.message || 'Failed to create pending session invite')
  }
}
