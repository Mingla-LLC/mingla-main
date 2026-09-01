export const PRIVACY_EFFECTIVE_DATE = 'August 27, 2026'

export const PRIVACY_SECTIONS = [
  {
    title: '1. Introduction',
    paragraphs: [
      'Welcome to Mingla ("Mingla," "we," "our," or "us"). Mingla is an experience-planning and social-experiences app operated by MINGLA LLC at usemingla.com. We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application, our website, and any related services (collectively, the "Service").',
      'Please read this Privacy Policy carefully. By accessing, downloading, installing, or otherwise using the Service, you acknowledge that you have read, understood, and agree to the practices described in this Policy. If you do not agree, please discontinue use of the Service.',
    ],
  },
  {
    title: '2. Information We Collect',
    paragraphs: [
      'We collect information that you provide directly, information that is collected automatically when you use the Service, and information received from third parties.',
    ],
  },
  {
    title: '2.1 Information You Provide',
    paragraphs: [],
    bullets: [
      'Account profile: full name, display name, date of birth, gender (optional), country, city, and timezone',
      'Contact information: email address and phone number (used for account login, OTP verification, transactional communications, and the invite feature)',
      'Profile photo (uploaded by you to your account)',
      'Preferences and interests you select during onboarding or in settings',
      'User-generated content you submit, including date plans, place reviews and ratings, board discussion messages, photos, and voice recordings (beta feedback)',
      'Payment account identifiers when you start a Mingla Plus subscription (we never receive or store your full credit card number — see Section 5.1, Stripe)',
    ],
  },
  {
    title: '2.2 Information Collected Automatically',
    paragraphs: [],
    bullets: [
      'Device information: device type, operating system and version, screen size, language, and unique device identifiers',
      'Advertising identifiers: on iOS, the Identifier for Advertisers (IDFA) if you grant App Tracking Transparency permission; on Android, the Google Advertising ID. These are used for install attribution (Section 5.1, AppsFlyer)',
      'Usage data: features used, screens viewed, time spent in app, interaction events (taps, swipes, paywall views), and similar telemetry',
      'Location data (with your permission): precise GPS coordinates while the app is in use, and an approximate city/country derived from those coordinates. You can deny location at install time or revoke it later in your device settings; the app remains usable with manual city selection',
      'Log and diagnostic data: IP address, crash reports, stack traces, performance traces, breadcrumbs of in-app navigation, and a small sample of session replays for debugging (see Section 5.1, Sentry)',
    ],
  },
  {
    title: '2.3 Marketing email measurement',
    paragraphs: [
      'When you receive a consented marketing email sent through Mingla, we may use an invisible image on messages sent from campaigns.usemingla.com to estimate whether the email was opened and tracked links to understand whether a link was selected. Email apps, privacy protections, caching, and automated security tools may block or load images without a person reading the message, so open data can be incomplete or automated. We use this information to report aggregate campaign performance and improve delivery; an open signal is not proof that a named person read an email, and link clicks are a stronger engagement signal. Transactional emails such as sign-in codes, receipts, and account notifications are not open-tracked. You can unsubscribe from marketing email at any time using the link in the message.',
    ],
  },
  {
    title: '2.4 Information from Third Parties',
    paragraphs: [
      'If you choose to sign in with a third-party identity provider, we receive limited profile information from that provider:',
    ],
    bullets: [
      'Google Sign-In: name, email address, and profile picture from your Google account',
      'Apple Sign-In: name and email address from your Apple ID (or a private relay email if you choose to hide your real address)',
      'Subscription and entitlement state: from RevenueCat and the relevant app store (Apple App Store or Google Play) when you purchase or restore Mingla Plus',
    ],
  },
  {
    title: '3. How We Use Your Information',
    paragraphs: ['We use the information we collect to:'],
    bullets: [
      'Create and manage your Mingla account',
      'Verify your phone number via one-time SMS passcodes (OTP)',
      'Send invite SMS messages on your behalf when you invite friends to join Mingla',
      'Generate personalized experience and date plans based on your preferences, location, and prior interactions',
      'Suggest local experiences, venues, and activities near you',
      'Provide customer support and respond to your requests',
      'Send transactional emails (welcome messages, receipts, account notifications)',
      'Send push notifications related to your account, your saved plans, and friend activity, where you have granted permission',
      'Process Mingla Plus subscription payments through our payment processors',
      'Measure install attribution and the performance of marketing channels',
      'Monitor application performance, diagnose crashes, and improve reliability',
      'Detect, investigate, and prevent fraud, abuse, and security incidents',
      'Comply with our legal obligations and enforce our Terms of Service',
    ],
  },
  {
    title: '4. SMS Messaging',
    paragraphs: ['Mingla uses SMS messaging for two purposes:'],
  },
  {
    title: '4.1 Phone Number Verification (OTP)',
    paragraphs: [
      'When you sign up or add a phone number, we send a one-time passcode (OTP) to verify that the number belongs to you. This is a single transactional message and does not constitute marketing.',
    ],
  },
  {
    title: '4.2 Invite Messages',
    paragraphs: [
      'When you choose to invite a friend to Mingla, you may enter their phone number and we will send them a single SMS invite on your behalf. By submitting a contact’s phone number, you confirm that you have their permission to send them this message. The invited person will receive one SMS only and will not be contacted again unless they sign up and opt in to further communications.',
      'To opt out of receiving SMS messages from Mingla, reply STOP to any message. For help, reply HELP.',
    ],
  },
  {
    title: '5. How We Share Your Information',
    paragraphs: [
      'We do not sell your personal information. We do not share your personal information with third parties for their independent advertising or marketing purposes. We share information only with service providers we engage to operate the Mingla Service, where required by law, or in connection with a business transfer, each as described below.',
    ],
  },
  {
    title: '5.1 Service Providers',
    paragraphs: [
      'We engage the following service providers to operate the Mingla Service. Each receives only the data necessary to perform its function and is contractually required to protect that data.',
    ],
    bullets: [
      'Supabase — backend infrastructure (authentication, database, file storage, realtime sync, server-side edge functions)',
      'Cloudinary — storage and delivery of user-uploaded photos and audio recordings',
      'Twilio — SMS delivery for OTP verification and friend-invite messages',
      'Resend — transactional email delivery without open tracking (welcome messages, receipts, account notifications), plus delivery and measurement of consented marketing campaigns, including estimated open signals',
      'Google — Sign-In authentication, and location services including Places search, Distance Matrix travel-time estimates, and reverse geocoding (converting coordinates to city/country)',
      'Apple — Sign-In authentication',
      'Mapbox — map rendering inside the app',
      'OpenWeatherMap — weather data tied to a coordinate (no personal identifier sent)',
      'BestTime — foot-traffic forecasts for venues (no personal identifier sent)',
      'Ticketmaster — public event metadata (no personal identifier sent)',
      'Mixpanel — product analytics (in-app event tracking, retention metrics, funnel analysis); linked to a stable user identifier',
      'AppsFlyer — mobile install attribution and marketing performance measurement; receives the IDFA (iOS, after your App Tracking Transparency consent) or the Google Advertising ID (Android), plus a stable user identifier',
      'OneSignal — push notification delivery; receives the push subscription token and a stable user identifier',
      'Sentry — application crash reporting, error monitoring, and a small sample of session replays for debugging; includes your IP address and account identifier so that engineers can correlate crashes with the affected account',
      'RevenueCat — subscription state management for Mingla Plus (entitlement tracking, trial management, receipt validation)',
      'Stripe — payment processing for Mingla Plus subscriptions. Stripe handles all credit card data directly; Mingla never receives or stores your full card number or CVC. Stripe is integrated with RevenueCat for subscription processing',
      'Expo — application build, over-the-air update, and runtime infrastructure',
    ],
  },
  {
    title: '5.2 Legal Requirements',
    paragraphs: [
      'We may disclose your information if we are required to do so by law, court order, subpoena, or other governmental authority, or if disclosure is necessary to protect the rights, property, or safety of Mingla, our users, or the public, or to detect, prevent, or investigate fraud, security incidents, or violations of our Terms of Service.',
    ],
  },
  {
    title: '5.3 Business Transfers',
    paragraphs: [
      'If Mingla is involved in a merger, acquisition, financing, reorganization, bankruptcy, or sale of all or a portion of its assets, your information may be transferred or sold as part of that transaction. We will notify you of any change in ownership or material change in the use of your personal information, and you will have an opportunity to opt out of the new use before your information becomes subject to a different privacy policy.',
    ],
  },
  {
    title: '6. International Data Transfers',
    paragraphs: [
      'Mingla is operated from the United States, and several of our service providers (including Supabase, Mixpanel, Sentry, AppsFlyer, OneSignal, Resend, Cloudinary, Stripe, and RevenueCat) process data in the United States and other jurisdictions. If you use the Service from outside the United States, your information may be transferred to, stored in, and processed in countries other than your own, including the United States, where data protection laws may differ from those of your country.',
      'By using the Service, you consent to the transfer, storage, and processing of your information in any such country. Where required by law, we rely on appropriate safeguards (such as Standard Contractual Clauses) for the international transfer of personal data.',
    ],
  },
  {
    title: '7. Data Retention',
    paragraphs: [
      'We retain your personal information for as long as your account is active or as needed to provide you with the Service. If you delete your account through the in-app Settings → Delete Account flow, we will delete or anonymize your personal data within thirty (30) days, except where we are required to retain certain records for legal, regulatory, fraud-prevention, or tax purposes. Hashed identifiers may be retained to prevent fraudulent re-registration and trial abuse.',
      'Anonymized aggregate data that cannot reasonably be associated with you may be retained indefinitely for analytics and product improvement purposes.',
    ],
  },
  {
    title: '8. Your Rights and Choices',
    paragraphs: [
      'Depending on your location, you may have the following rights with respect to your personal information:',
    ],
    bullets: [
      'Access — request a copy of the personal data we hold about you',
      'Correction — request that we correct inaccurate or incomplete information',
      'Deletion — request that we delete your personal data (also available via in-app Settings → Delete Account)',
      'Portability — request a copy of your data in a structured, machine-readable format',
      'Restriction — request that we limit how we process your information',
      'Objection — object to certain processing activities',
      'Opt out of SMS — reply STOP to any Mingla SMS message',
      'Opt out of push notifications — disable in your device settings or in the app',
      'Withdraw consent — for processing based on your consent, withdraw at any time',
    ],
    footer: 'To exercise any of these rights, contact us at privacy@usemingla.com. We will respond within thirty (30) days, or as required by applicable law.',
  },
  {
    title: '9. Children’s Privacy',
    paragraphs: [
      'Mingla is not intended for use by individuals under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected personal information from a child under 13, we will take steps to delete that information promptly. If you believe we have collected information from a child under 13, please contact us at privacy@usemingla.com.',
      'Users between the ages of 13 and 17 must have parental or legal guardian consent to use the Service. Parents and guardians who wish to review, modify, or delete information collected from their child may contact us at the address above.',
    ],
  },
  {
    title: '10. Security',
    paragraphs: [
      'We implement industry-standard administrative, technical, and physical security measures to protect your information, including encryption in transit (HTTPS / TLS), secure authentication via Supabase, role-based access controls, row-level security policies on our database, and ongoing monitoring for security incidents. However, no method of electronic storage or transmission over the internet is one hundred percent secure, and we cannot guarantee absolute security. You are responsible for keeping your account credentials confidential and for notifying us immediately of any unauthorized account access.',
    ],
  },
  {
    title: '11. Third-Party Links and Services',
    paragraphs: [
      'The Service may contain links to, or integrate with, third-party websites, services, or applications that are not operated by Mingla (for example, links to venue websites, ticketing partners, or social media). We are not responsible for the privacy practices, content, or security of those third parties. We encourage you to read the privacy policies of every third-party service you interact with through Mingla. Your use of any third-party service is subject solely to the terms and privacy policy of that third party.',
    ],
  },
  {
    title: '12. Changes to This Policy',
    paragraphs: [
      'We may update this Privacy Policy from time to time to reflect changes in our practices, the Service, or applicable law. If we make material changes, we will notify you by posting the updated Policy on our website, updating the Effective Date above, and, where required, by sending you a notice through the Service or by email. Your continued use of the Service after changes take effect constitutes your acceptance of the updated Policy. If you do not agree to the updated Policy, you should discontinue use of the Service.',
    ],
  },
  {
    title: '13. Contact Us',
    paragraphs: [
      'If you have any questions, concerns, or requests regarding this Privacy Policy or our handling of your personal information, please contact us at:',
    ],
    contact: {
      name: 'MINGLA LLC — Privacy Office',
      email: 'privacy@usemingla.com',
      website: 'https://usemingla.com',
    },
  },
] as const
