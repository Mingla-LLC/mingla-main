import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const E164_REGEX = /^\+[1-9]\d{1,14}$/
const CODE_REGEX = /^\d{6}$/

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

    // Validate JWT with anon client
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

    const { phone, code } = await req.json()
    if (!phone || !E164_REGEX.test(phone)) {
      return new Response(JSON.stringify({ error: 'Invalid phone number format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!code || !CODE_REGEX.test(code)) {
      return new Response(JSON.stringify({ error: 'Invalid code format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!
    const serviceSid = Deno.env.get('TWILIO_VERIFY_SERVICE_SID')!

    const twilioResponse = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: phone, Code: code }),
      }
    )

    const twilioData = await twilioResponse.json()

    if (!twilioResponse.ok) {
      if (twilioResponse.status === 404 || twilioData?.code === 60200) {
        return new Response(JSON.stringify({ error: 'Code expired. Request a new one.' }), {
          status: 410,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      console.error('Twilio verify error:', twilioData)
      return new Response(JSON.stringify({ error: 'Verification failed. Try again.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (twilioData.status === 'approved') {
      // Save verified phone to profile using service role client
      const serviceClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      // Defense-in-depth: reject if phone was claimed by another user between
      // send-otp (which also checks) and this verification
      const { data: existingProfile } = await serviceClient
        .from('profiles')
        .select('id')
        .eq('phone', phone)
        .neq('id', user.id)
        .maybeSingle()

      if (existingProfile) {
        // Check if the claiming user's auth account still exists —
        // if not, the profile is orphaned from a failed account deletion
        const { data: authCheck } = await serviceClient.auth.admin.getUserById(existingProfile.id)
        if (!authCheck?.user) {
          console.warn(`[verify-otp] Orphaned profile ${existingProfile.id} claims phone — clearing`)
          const { error: clearError } = await serviceClient
            .from('profiles')
            .update({ phone: null })
            .eq('id', existingProfile.id)
          if (clearError) {
            console.error('[verify-otp] Failed to clear orphaned phone:', clearError.message)
            return new Response(JSON.stringify({ error: 'Could not free phone number. Please try again.' }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
          }
          // Phone freed — fall through to save it for the current user
        } else {
          return new Response(JSON.stringify({ error: 'This phone number is already associated with another account.' }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }

      const { error: updateError } = await serviceClient
        .from('profiles')
        .update({ phone })
        .eq('id', user.id)

      if (updateError) {
        // Handle UNIQUE constraint violation (final safety net)
        if (updateError.code === '23505') {
          return new Response(JSON.stringify({ error: 'This phone number is already associated with another account.' }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        console.error('[verify-otp] Profile update failed:', {
          code: updateError.code,
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
        })
        return new Response(JSON.stringify({
          error: 'Phone verified but save failed. Contact support.',
          debug_code: updateError.code,
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ success: true, status: 'approved' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // status === "pending" means code was wrong
    return new Response(JSON.stringify({ error: 'Incorrect code' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('verify-otp error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
