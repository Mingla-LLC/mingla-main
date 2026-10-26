import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  conflictingPhoneOwners,
  getPhoneIdentityOwners,
  hasCurrentVerifiedPhoneOwnership,
  isProfileOnlyPhoneOwner,
} from '../_shared/phoneIdentityOwnership.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const E164_REGEX = /^\+[1-9]\d{1,14}$/

// ALLOWED_CHANNELS: Twilio Verify channel allowlist.
// WhatsApp requires Console setup (WhatsApp Sender on Verify Service).
// Voice is enabled by default. Do not add 'auto' or 'sna' without reviewing
// investigation ORCH-0370 for UX and rate-limit implications.
const ALLOWED_CHANNELS = ['sms', 'whatsapp', 'call'] as const
type AllowedChannel = typeof ALLOWED_CHANNELS[number]

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate JWT
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { phone, channel: rawChannel } = await req.json()
    if (!phone || !E164_REGEX.test(phone)) {
      return new Response(JSON.stringify({ error: 'Invalid phone number format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ORCH-0977: App Store / Play Store review bypass. REVIEWER_TEST_PHONE is a
    // fictional NANP 555-0199 number that can never be a real line. For this
    // number we skip the real Twilio SMS so a store reviewer can clear the
    // mandatory phone-verification onboarding step (verify-otp accepts a fixed
    // code for the same number). No effect on any real phone number.
    const REVIEWER_TEST_PHONE = '+12015550199'
    if (phone === REVIEWER_TEST_PHONE) {
      return new Response(JSON.stringify({ success: true, status: 'pending', channel: 'sms' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const channel: AllowedChannel = rawChannel ?? 'sms'
    if (!ALLOWED_CHANNELS.includes(channel)) {
      return new Response(JSON.stringify({ error: 'Invalid channel. Must be sms, whatsapp, or call.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Service role client for cross-user queries (RLS bypass)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // #4063: profiles.phone is not the complete ownership authority. Account
    // deletion can retain GoTrue and verified-phone rows for Business history,
    // so checking only profiles would let a second account take the number and
    // claim every paid order attached to it. Read all three authorities and
    // fail closed if that complete view is unavailable.
    let ownership = await getPhoneIdentityOwners(serviceClient, phone)
    if (ownership.error) {
      console.error('[send-otp] Phone ownership lookup failed:', ownership.error)
      return new Response(JSON.stringify({ error: 'Could not verify phone availability. Please try again.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const conflicts = conflictingPhoneOwners(ownership.owners, user.id)
    for (const owner of conflicts) {
      // Preserve the historical failed-deletion repair, but only for a row
      // owned by profiles alone. A verified ledger or GoTrue owner must never
      // be cleared as an onboarding side effect.
      if (!isProfileOnlyPhoneOwner(owner)) {
        return new Response(JSON.stringify({ error: 'This phone number is already associated with another account.' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { data: authCheck, error: authCheckError } =
        await serviceClient.auth.admin.getUserById(owner.userId)
      if (authCheck?.user) {
        return new Response(JSON.stringify({ error: 'This phone number is already associated with another account.' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (authCheckError && authCheckError.status !== 404) {
        console.error('[send-otp] Could not validate profile-only phone owner:', authCheckError.message)
        return new Response(JSON.stringify({ error: 'Could not verify phone availability. Please try again.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      console.warn(`[send-otp] Clearing orphaned profile-only phone owner ${owner.userId}`)
      const { error: clearError } = await serviceClient
        .from('profiles')
        .update({ phone: null })
        .eq('id', owner.userId)
      if (clearError) {
        console.error('[send-otp] Failed to clear orphaned phone:', clearError.message)
        return new Response(JSON.stringify({ error: 'Could not free phone number. Please try again.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    if (conflicts.length > 0) {
      ownership = await getPhoneIdentityOwners(serviceClient, phone)
      if (
        ownership.error ||
        conflictingPhoneOwners(ownership.owners, user.id).length > 0
      ) {
        console.error('[send-otp] Phone ownership remained ambiguous after orphan cleanup:', ownership.error)
        return new Response(JSON.stringify({ error: 'Could not verify phone availability. Please try again.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // A current profile or verified-phone ledger row is already sufficient;
    // an auth.users-only remnant is not, so it receives a fresh OTP and proof.
    if (hasCurrentVerifiedPhoneOwnership(ownership.owners, user.id)) {
      return new Response(JSON.stringify({ success: true, status: 'already_verified' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!
    const serviceSid = Deno.env.get('TWILIO_VERIFY_SERVICE_SID')!

    const twilioResponse = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: phone, Channel: channel }),
      }
    )

    const twilioData = await twilioResponse.json()

    if (!twilioResponse.ok) {
      if (twilioResponse.status === 429 || twilioData?.code === 60203) {
        return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      console.error('Twilio error:', twilioData)
      return new Response(JSON.stringify({ error: "Couldn't send code. Try again." }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, status: twilioData.status, channel }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-otp error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
