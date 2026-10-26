import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { seedReviewerAccount } from '../_shared/seedReviewerAccount.ts'
import {
  conflictingPhoneOwners,
  getPhoneIdentityOwners,
  isProfileOnlyPhoneOwner,
} from '../_shared/phoneIdentityOwnership.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const E164_REGEX = /^\+[1-9]\d{1,14}$/
const CODE_REGEX = /^\d{6}$/

/**
 * #2269: record a Twilio-APPROVED number as an account possession proof.
 *
 * `record_verified_phone` is service_role-only and is the ONLY writer of
 * public.verified_phone_identities, which `verified_account_identifiers` reads
 * as the widened phone arm of the #2217 attendance claim.
 */
// Structural, not `ReturnType<typeof createClient>`: this helper needs exactly
// one capability, and naming it that way keeps the reviewer client and the
// service client — which carry different generic parameters — both assignable.
type RpcCapable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

async function recordVerifiedPhone(
  client: RpcCapable,
  userId: string,
  phone: string,
): Promise<{ ledgerError: string | null }> {
  const { data, error } = await client.rpc('record_verified_phone', {
    p_user_id: userId,
    p_phone: phone,
  })
  if (error) return { ledgerError: error.message }
  // PostgREST hands back the function's jsonb. Anything other than 'recorded'
  // means the number did not become a possession proof, and saying so is the
  // whole point — a swallowed failure here is the bug #2269 fixes.
  const result = (data as { result?: string } | null)?.result
  if (result !== 'recorded') return { ledgerError: `record_verified_phone returned ${result ?? 'null'}` }
  return { ledgerError: null }
}

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

    // ORCH-0977: App Store / Play Store review bypass. For the fictional
    // REVIEWER_TEST_PHONE + fixed REVIEWER_TEST_CODE, accept without calling
    // Twilio and attach the test number to this (already-authenticated)
    // reviewer account so onboarding proceeds. Frees the number from any prior
    // reviewer account first so repeat reviews work. No effect on real numbers.
    const REVIEWER_TEST_PHONE = '+12015550199'
    const REVIEWER_TEST_CODE = '123456'
    if (phone === REVIEWER_TEST_PHONE && code === REVIEWER_TEST_CODE) {
      const reviewerClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )
      await reviewerClient
        .from('profiles')
        .update({ phone: null })
        .eq('phone', REVIEWER_TEST_PHONE)
        .neq('id', user.id)
      await reviewerClient
        .from('profiles')
        .update({ phone: REVIEWER_TEST_PHONE })
        .eq('id', user.id)
      // #2269: the reviewer path writes `profiles` and never GoTrue, so before
      // this the reviewer account had NO possession proof at all and its ticket
      // could never be claimed (measured: 87207cdb, 1 order). Record it in the
      // ledger the claim actually reads.
      await recordVerifiedPhone(reviewerClient, user.id, REVIEWER_TEST_PHONE)
      // ORCH-1245: pre-populate the reviewer's fresh account with friends, a
      // group chat, and posts so Apple App Review (2.1(a)) can verify those
      // features. Idempotent + reviewer-only; NEVER block login on a seed error.
      try {
        await seedReviewerAccount(reviewerClient, user.id)
      } catch (seedErr) {
        console.error('[verify-otp] reviewer seed failed (login continues):', seedErr?.message ?? seedErr)
      }
      return new Response(JSON.stringify({ success: true, status: 'approved' }), {
        status: 200,
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

      // #4063 defense-in-depth: send-otp checked before sending the code, but
      // ownership may have changed while the user entered it. Re-check the
      // complete profile + verified-ledger + GoTrue authority set now.
      let ownership = await getPhoneIdentityOwners(serviceClient, phone)
      if (ownership.error) {
        console.error('[verify-otp] Phone ownership lookup failed:', ownership.error)
        return new Response(JSON.stringify({ error: 'Could not verify phone availability. Please try again.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const conflicts = conflictingPhoneOwners(ownership.owners, user.id)
      for (const owner of conflicts) {
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
          console.error('[verify-otp] Could not validate profile-only phone owner:', authCheckError.message)
          return new Response(JSON.stringify({ error: 'Could not verify phone availability. Please try again.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        console.warn(`[verify-otp] Clearing orphaned profile-only phone owner ${owner.userId}`)
        const { error: clearError } = await serviceClient
          .from('profiles')
          .update({ phone: null })
          .eq('id', owner.userId)
        if (clearError) {
          console.error('[verify-otp] Failed to clear orphaned phone:', clearError.message)
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
          console.error('[verify-otp] Phone ownership remained ambiguous after orphan cleanup:', ownership.error)
          return new Response(JSON.stringify({ error: 'Could not verify phone availability. Please try again.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }

      // Save the profile authority only after the complete duplicate guard has
      // passed. Its UNIQUE constraint is the final safety net for a concurrent
      // profile claim; the possession ledger is written only after this succeeds.
      const { error: updateError } = await serviceClient
        .from('profiles')
        .update({ phone })
        .eq('id', user.id)
      if (updateError) {
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

      // #2269: THE POSSESSION PROOF. Written before the GoTrue sync, because
      // the GoTrue sync is the thing that fails.
      //
      // `auth.users.phone` carries `users_phone_key UNIQUE (phone)`. When a
      // stale account still holds this number, updateUserById THROWS, the catch
      // below swallows it, and GoTrue never mints the provider='phone' identity
      // that `verified_account_identifiers` reads — so a number Twilio really
      // did approve becomes invisible to the ticket claim. Measured on
      // production 2026-08-18: 2 accounts, 3 guest orders, both Google/Apple
      // sign-ins whose duplicate guard passed because it reads `profiles` only.
      //
      // The ledger does not share that constraint, so the proof survives.
      // NOT `profiles.phone`: `authenticated` holds a column UPDATE grant on it
      // and could write its own proof.
      const { ledgerError } = await recordVerifiedPhone(serviceClient, user.id, phone)
      if (ledgerError) {
        console.error('[verify-otp] Failed to record verified phone possession:', ledgerError)
        return new Response(JSON.stringify({ error: 'Phone verified but save failed. Contact support.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Sync to auth.users for dashboard visibility. Still non-fatal — but no
      // longer SILENT, and no longer load-bearing: #2269 moved the claim's
      // proof off this call precisely because it can refuse.
      try {
        await serviceClient.auth.admin.updateUserById(user.id, { phone })
      } catch (err) {
        console.error(
          '[verify-otp] auth.users phone sync refused (claim unaffected — #2269 ledger holds the proof):',
          err?.message ?? err,
        )
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
