/**
 * STRIPE CONNECT PAYMENT ARCHITECTURE - BACKEND REFERENCE
 * 
 * This file documents the backend implementation requirements.
 * Frontend devs: Use this as a reference for API contracts.
 * Backend devs: Implement these patterns exactly.
 */

/**
 * ============================================================================
 * CORE PRINCIPLE: Currency Derivation Path
 * ============================================================================
 * 
 * CORRECT PATH (The Only Allowed Path):
 * User selects experience → Frontend sends experienceId & merchantId to backend
 * → Backend queries Stripe: stripe.accounts.retrieve(merchantAccountId)
 * → Reads: account.default_currency
 * → Creates PaymentIntent with { currency: account.default_currency }
 * 
 * FORBIDDEN PATHS (Never Use These):
 * ❌ Card BIN lookup → currency
 * ❌ User IP geolocation → currency
 * ❌ Browser locale → currency
 * ❌ User preference/selection → currency
 * ❌ Frontend header/param → currency
 */

/**
 * ============================================================================
 * 1. MERCHANT ONBOARDING - Currency Lock-In
 * ============================================================================
 */

interface StripeConnectOnboarding {
  /**
   * Step 1: Create Stripe Connected Account
   * 
   * When merchant signs up, create their Stripe Connect account.
   * The country determines the default_currency automatically.
   * 
   * Backend Implementation:
   */
  createConnectedAccount: {
    endpoint: 'POST /api/merchants/stripe/onboard',
    
    requestBody: {
      merchantId: 'string',
      country: 'string', // ISO 3166-1 alpha-2 (e.g., "US", "GB", "JP")
      businessType: 'individual | company',
      email: 'string'
    },
    
    backendLogic: `
      // Create Stripe Connected Account
      const account = await stripe.accounts.create({
        type: 'express', // or 'standard'
        country: requestBody.country,
        email: requestBody.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        }
      });

      // CRITICAL: Store the default_currency with merchant
      await db.merchants.update(merchantId, {
        stripeAccountId: account.id,
        stripeAccountCountry: account.country,
        // This is the ONLY source of truth for charge currency
        payoutCurrency: account.default_currency,
        onboardingComplete: false,
        chargesEnabled: false
      });

      // Return account link for onboarding
      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: 'https://mingla.com/merchant/onboarding/refresh',
        return_url: 'https://mingla.com/merchant/onboarding/complete',
        type: 'account_onboarding'
      });

      return { accountLink: accountLink.url };
    `,
    
    securityNotes: [
      '✓ Country code must be validated against Stripe supported countries',
      '✓ Store payoutCurrency immediately - never allow it to be changed',
      '✓ Log account creation for audit trail',
      '✗ Never allow frontend to specify currency',
      '✗ Never allow merchant to change currency post-creation'
    ]
  },

  /**
   * Step 2: Webhook - Capture Account Updates
   * 
   * Listen for account.updated webhook to track onboarding progress
   */
  accountUpdatedWebhook: {
    endpoint: 'POST /api/webhooks/stripe',
    eventType: 'account.updated',
    
    backendLogic: `
      // Verify webhook signature
      const event = stripe.webhooks.constructEvent(
        request.body,
        request.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === 'account.updated') {
        const account = event.data.object;

        // Update merchant capabilities
        await db.merchants.update(
          { stripeAccountId: account.id },
          {
            chargesEnabled: account.charges_enabled,
            payoutsEnabled: account.payouts_enabled,
            onboardingComplete: account.details_submitted,
            // IMPORTANT: Verify currency hasn't changed (it shouldn't)
            payoutCurrency: account.default_currency
          }
        );

        // Guard: Verify currency consistency
        const merchant = await db.merchants.findOne({ 
          stripeAccountId: account.id 
        });
        
        if (merchant.payoutCurrency !== account.default_currency) {
          // This should NEVER happen, but log if it does
          logger.error('Currency mismatch detected', {
            merchantId: merchant.id,
            storedCurrency: merchant.payoutCurrency,
            stripeCurrency: account.default_currency
          });
          
          // Do NOT update - keep original currency and alert team
          throw new Error('Currency consistency violation');
        }
      }
    `,
    
    criticalChecks: [
      '✓ Verify webhook signature',
      '✓ Validate currency hasn\'t changed',
      '✓ Log any currency discrepancies',
      '✓ Never silently update currency'
    ]
  }
}

/**
 * ============================================================================
 * 2. PAYMENT CREATION - Currency Resolution
 * ============================================================================
 */

interface PaymentIntentCreation {
  /**
   * Create Payment Intent - The Core Payment Logic
   * 
   * This is where currency MUST be derived from merchant's Stripe account.
   */
  createPaymentIntent: {
    endpoint: 'POST /api/payments/create-intent',
    
    requestBody: {
      experienceId: 'string',
      merchantId: 'string',
      // IMPORTANT: No currency field in request body
    },
    
    backendLogic: `
      // Step 1: Fetch merchant data
      const merchant = await db.merchants.findById(merchantId);
      
      if (!merchant) {
        throw new Error('Merchant not found');
      }

      // Step 2: Verify merchant can accept charges
      if (!merchant.chargesEnabled) {
        throw new Error('Merchant onboarding incomplete');
      }

      // Step 3: Fetch experience and calculate amount
      const experience = await db.experiences.findById(experienceId);
      
      if (!experience || experience.merchantId !== merchantId) {
        throw new Error('Experience not found or merchant mismatch');
      }

      // Step 4: CRITICAL - Fetch currency from Stripe account
      // This is the ONLY source of truth for currency
      const stripeAccount = await stripe.accounts.retrieve(
        merchant.stripeAccountId
      );

      // Step 5: Guard - Verify currency consistency
      if (stripeAccount.default_currency !== merchant.payoutCurrency) {
        logger.error('Currency mismatch during payment creation', {
          merchantId: merchant.id,
          storedCurrency: merchant.payoutCurrency,
          stripeCurrency: stripeAccount.default_currency
        });
        throw new Error('Currency configuration error');
      }

      // Step 6: Create PaymentIntent with merchant's currency
      const paymentIntent = await stripe.paymentIntents.create({
        // Amount in smallest currency unit (cents, pence, yen, etc.)
        amount: Math.round(experience.price * 100),
        
        // CRITICAL: Currency from Stripe account ONLY
        currency: stripeAccount.default_currency,
        
        // Stripe Connect parameters
        application_fee_amount: Math.round(experience.price * 100 * 0.10), // 10% fee
        transfer_data: {
          destination: merchant.stripeAccountId,
        },
        
        // Or use on_behalf_of for direct charges:
        // on_behalf_of: merchant.stripeAccountId,
        
        metadata: {
          experienceId: experience.id,
          merchantId: merchant.id,
          // Store currency in metadata for reconciliation
          chargeCurrency: stripeAccount.default_currency
        }
      });

      // Step 7: Store payment record
      await db.payments.create({
        paymentIntentId: paymentIntent.id,
        experienceId: experience.id,
        merchantId: merchant.id,
        amount: experience.price,
        // IMPORTANT: Store the currency used
        currency: stripeAccount.default_currency,
        status: 'pending',
        createdAt: new Date()
      });

      return {
        clientSecret: paymentIntent.client_secret,
        // Return currency to frontend for display ONLY
        currency: stripeAccount.default_currency,
        amount: experience.price
      };
    `,
    
    responseBody: {
      clientSecret: 'string', // For Stripe.js
      currency: 'string', // Display only - not editable
      amount: 'number'
    },
    
    securityChecks: [
      '✓ Verify merchant exists and is enabled',
      '✓ Verify experience belongs to merchant',
      '✓ Fetch currency from Stripe account in real-time',
      '✓ Verify currency matches stored value',
      '✓ Log any currency discrepancies',
      '✗ Never accept currency from frontend',
      '✗ Never use fallback currency',
      '✗ Never infer currency from card or user'
    ]
  },

  /**
   * Alternative: Direct Charge (instead of PaymentIntent + transfer)
   */
  createDirectCharge: {
    backendLogic: `
      // If using direct charges instead of PaymentIntent
      const charge = await stripe.charges.create({
        amount: Math.round(experience.price * 100),
        currency: stripeAccount.default_currency, // Same rule applies
        source: tokenId,
        application_fee_amount: Math.round(experience.price * 100 * 0.10),
      }, {
        stripeAccount: merchant.stripeAccountId, // Direct charge to connected account
      });
    `,
    note: 'PaymentIntent is preferred over direct Charges for SCA compliance'
  }
}

/**
 * ============================================================================
 * 3. PAYMENT CONFIRMATION - Webhook Handling
 * ============================================================================
 */

interface PaymentWebhooks {
  paymentIntentSucceeded: {
    endpoint: 'POST /api/webhooks/stripe',
    eventType: 'payment_intent.succeeded',
    
    backendLogic: `
      const event = stripe.webhooks.constructEvent(
        request.body,
        request.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;

        // Update payment record
        await db.payments.update(
          { paymentIntentId: paymentIntent.id },
          {
            status: 'succeeded',
            // CRITICAL: Store the actual charged currency
            currencyCharged: paymentIntent.currency,
            completedAt: new Date()
          }
        );

        // Guard: Verify currency matches expected
        const payment = await db.payments.findOne({ 
          paymentIntentId: paymentIntent.id 
        });
        
        if (payment.currency !== paymentIntent.currency) {
          logger.error('Currency mismatch in completed payment', {
            paymentId: payment.id,
            expectedCurrency: payment.currency,
            actualCurrency: paymentIntent.currency
          });
          // Alert team - this should never happen
        }

        // Mark booking as confirmed
        await db.bookings.create({
          paymentId: payment.id,
          experienceId: payment.experienceId,
          merchantId: payment.merchantId,
          status: 'confirmed',
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency
        });
      }
    `,
    
    validation: [
      '✓ Verify webhook signature',
      '✓ Validate currency matches payment record',
      '✓ Log any currency mismatches',
      '✓ Store final currency for refund reconciliation'
    ]
  }
}

/**
 * ============================================================================
 * 4. REFUND HANDLING - Original Currency Enforcement
 * ============================================================================
 */

interface RefundHandling {
  createRefund: {
    endpoint: 'POST /api/payments/:paymentId/refund',
    
    requestBody: {
      paymentId: 'string',
      amount: 'number', // Optional - defaults to full refund
      reason: 'string'
    },
    
    backendLogic: `
      // Step 1: Fetch original payment
      const payment = await db.payments.findById(paymentId);
      
      if (!payment || payment.status !== 'succeeded') {
        throw new Error('Payment not found or not refundable');
      }

      // Step 2: Fetch merchant
      const merchant = await db.merchants.findById(payment.merchantId);

      // Step 3: CRITICAL - Verify currency consistency
      if (payment.currency !== merchant.payoutCurrency) {
        logger.error('Currency mismatch during refund', {
          paymentId: payment.id,
          paymentCurrency: payment.currency,
          merchantCurrency: merchant.payoutCurrency
        });
        throw new Error('Currency configuration error - cannot process refund');
      }

      // Step 4: Create refund in ORIGINAL currency
      const refund = await stripe.refunds.create({
        payment_intent: payment.paymentIntentId,
        // IMPORTANT: Amount in original currency's smallest unit
        amount: requestBody.amount 
          ? Math.round(requestBody.amount * 100)
          : undefined, // Undefined = full refund
        reason: requestBody.reason,
        metadata: {
          paymentId: payment.id,
          // Store original currency for audit
          originalCurrency: payment.currency
        }
      }, {
        // If using Connect with separate charges
        stripeAccount: merchant.stripeAccountId
      });

      // Step 5: Record refund
      await db.refunds.create({
        refundId: refund.id,
        paymentId: payment.id,
        amount: refund.amount / 100,
        // CRITICAL: Store currency to ensure it matches original
        currency: refund.currency,
        status: refund.status,
        createdAt: new Date()
      });

      // Step 6: Guard - Verify refund currency
      if (refund.currency !== payment.currency) {
        logger.critical('Refund currency mismatch', {
          paymentId: payment.id,
          paymentCurrency: payment.currency,
          refundCurrency: refund.currency
        });
        // This should never happen with Stripe
        throw new Error('Refund currency mismatch detected');
      }

      return { refund };
    `,
    
    criticalRules: [
      '✓ Always refund in original charge currency',
      '✓ Verify currency matches payment record',
      '✓ Log any currency discrepancies',
      '✗ Never convert to different currency',
      '✗ Never allow currency override',
      '✗ Never perform manual FX calculation'
    ]
  }
}

/**
 * ============================================================================
 * 5. CURRENCY VALIDATION - Frontend API
 * ============================================================================
 */

interface CurrencyValidation {
  /**
   * Get Merchant Currency Info
   * 
   * Frontend calls this to display currency info.
   * This is read-only for display purposes.
   */
  getMerchantCurrency: {
    endpoint: 'GET /api/merchants/:merchantId/currency',
    
    backendLogic: `
      const merchant = await db.merchants.findById(merchantId);
      
      if (!merchant) {
        throw new Error('Merchant not found');
      }

      // Fetch current Stripe account data
      const stripeAccount = await stripe.accounts.retrieve(
        merchant.stripeAccountId
      );

      return {
        merchantId: merchant.id,
        merchantName: merchant.name,
        stripeAccountId: merchant.stripeAccountId,
        payoutCurrency: stripeAccount.default_currency,
        country: stripeAccount.country,
        chargesEnabled: stripeAccount.charges_enabled,
        payoutsEnabled: stripeAccount.payouts_enabled
      };
    `,
    
    responseBody: {
      merchantId: 'string',
      merchantName: 'string',
      stripeAccountId: 'string',
      payoutCurrency: 'string', // Read-only
      country: 'string',
      chargesEnabled: 'boolean',
      payoutsEnabled: 'boolean'
    },
    
    frontendUsage: `
      // Frontend fetches this data to display
      const currencyInfo = await fetch(\`/api/merchants/\${merchantId}/currency\`);
      
      // Display in UI (read-only)
      <div>Price: {\formatPrice(price, currencyInfo.payoutCurrency)}</div>
      
      // Frontend NEVER sends currency back to backend
      // Payment creation uses only merchantId
      await fetch('/api/payments/create-intent', {
        method: 'POST',
        body: JSON.stringify({
          experienceId,
          merchantId
          // NO currency field
        })
      });
    `
  }
}

/**
 * ============================================================================
 * 6. ERROR HANDLING - Currency Rejection
 * ============================================================================
 */

interface ErrorHandling {
  /**
   * When to Reject Payment
   */
  rejectionScenarios: {
    scenario1: {
      condition: 'Merchant account not fully onboarded',
      check: `if (!merchant.chargesEnabled) { throw new Error(...) }`,
      httpStatus: 403,
      errorMessage: 'Merchant cannot accept payments yet',
      frontendAction: 'Display onboarding incomplete message'
    },
    
    scenario2: {
      condition: 'Currency configuration error',
      check: `if (stripeAccount.default_currency !== merchant.payoutCurrency) { throw new Error(...) }`,
      httpStatus: 500,
      errorMessage: 'Currency configuration error',
      frontendAction: 'Display error and contact support option'
    },
    
    scenario3: {
      condition: 'Card network doesn\'t support currency',
      check: 'Stripe will return error during charge attempt',
      httpStatus: 400,
      errorMessage: 'Card not supported for this currency',
      frontendAction: 'Display currency incompatibility message'
    },
    
    scenario4: {
      condition: 'Refund currency mismatch',
      check: `if (refund.currency !== payment.currency) { throw new Error(...) }`,
      httpStatus: 500,
      errorMessage: 'Refund currency mismatch',
      frontendAction: 'Contact support - critical error'
    }
  },

  /**
   * Error Response Format
   */
  errorResponse: {
    structure: `
      {
        error: {
          code: 'CURRENCY_ERROR' | 'MERCHANT_NOT_READY' | 'UNSUPPORTED_CARD',
          message: 'User-friendly error message',
          details: {
            merchantCurrency: 'usd',
            reason: 'Detailed technical reason'
          }
        }
      }
    `
  }
}

/**
 * ============================================================================
 * 7. LOGGING & MONITORING
 * ============================================================================
 */

interface LoggingRequirements {
  /**
   * Critical Events to Log
   */
  criticalLogs: [
    {
      event: 'Merchant account created',
      data: ['merchantId', 'stripeAccountId', 'payoutCurrency', 'country'],
      level: 'INFO'
    },
    {
      event: 'Currency mismatch detected',
      data: ['merchantId', 'expectedCurrency', 'actualCurrency', 'context'],
      level: 'ERROR'
    },
    {
      event: 'Payment intent created',
      data: ['paymentId', 'merchantId', 'currency', 'amount'],
      level: 'INFO'
    },
    {
      event: 'Payment succeeded',
      data: ['paymentId', 'currency', 'amount'],
      level: 'INFO'
    },
    {
      event: 'Refund created',
      data: ['refundId', 'paymentId', 'currency', 'amount'],
      level: 'INFO'
    },
    {
      event: 'Currency consistency violation',
      data: ['resourceId', 'expectedCurrency', 'actualCurrency'],
      level: 'CRITICAL'
    }
  ],

  /**
   * Monitoring Metrics
   */
  metrics: [
    'Currency mismatches per hour',
    'Failed payments by currency',
    'Refund currency matches',
    'Merchant onboarding completion rate by currency'
  ]
}

/**
 * ============================================================================
 * EXPORT TYPE DEFINITIONS
 * ============================================================================
 */

export type {
  StripeConnectOnboarding,
  PaymentIntentCreation,
  PaymentWebhooks,
  RefundHandling,
  CurrencyValidation,
  ErrorHandling,
  LoggingRequirements
};

/**
 * ============================================================================
 * SUMMARY OF HARD REQUIREMENTS
 * ============================================================================
 * 
 * 1. Currency MUST come from: merchant → Stripe account → default_currency
 * 2. Currency MUST NOT come from: card BIN, locale, IP, or frontend
 * 3. Frontend MUST NOT be able to override currency
 * 4. Stripe handles ALL FX automatically
 * 5. Refunds MUST use original charge currency
 * 6. Currency MUST be validated on every operation
 * 7. Currency mismatches MUST be logged as critical errors
 * 8. Frontend displays currency read-only
 * 9. Payment creation derives currency server-side
 * 10. No fallback currencies allowed
 */
