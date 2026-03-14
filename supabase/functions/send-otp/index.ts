import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const E164_REGEX = /^\+[1-9]\d{1,14}$/

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

    const { phone } = await req.json()
    if (!phone || !E164_REGEX.test(phone)) {
      return new Response(JSON.stringify({ error: 'Invalid phone number format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Service role client for cross-user queries (RLS bypass)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check if this phone is already verified for this user — skip SMS if so
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('phone')
      .eq('id', user.id)
      .single()

    if (profile?.phone === phone) {
      return new Response(JSON.stringify({ success: true, status: 'already_verified' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check if this phone is already claimed by a different user
    const { data: existingProfile } = await serviceClient
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .neq('id', user.id)
      .maybeSingle()

    if (existingProfile) {
      // Defense: check if the other profile's auth user still exists.
      // If the user deleted their account but profile deletion failed,
      // the phone is orphaned — free it and let the new user proceed.
      const { data: authCheck } = await serviceClient.auth.admin.getUserById(existingProfile.id)
      if (!authCheck?.user) {
        console.warn(`Orphaned profile ${existingProfile.id} claims phone ${phone.slice(0, 4)}**** — clearing`)
        const { error: clearError } = await serviceClient
          .from('profiles')
          .update({ phone: null })
          .eq('id', existingProfile.id)
        if (clearError) {
          console.error('Failed to clear orphaned phone:', clearError.message)
          return new Response(JSON.stringify({ error: 'Could not free phone number. Please try again.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        // Phone is now free — fall through to send OTP
      } else {
        return new Response(JSON.stringify({ error: 'This phone number is already associated with another account.' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
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
        body: new URLSearchParams({ To: phone, Channel: 'sms' }),
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

    return new Response(JSON.stringify({ success: true, status: twilioData.status }), {
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
