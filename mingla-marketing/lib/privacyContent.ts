export const PRIVACY_EFFECTIVE_DATE = 'February 16, 2026'

export const PRIVACY_SECTIONS = [
  {
    title: '1. Introduction',
    paragraphs: [
      'Welcome to Mingla ("we," "our," or "us"). Mingla is a date and hangout planning app operated by usemingla.com. We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application and website (collectively, the "Service").',
      'Please read this policy carefully. If you disagree with its terms, please discontinue use of our Service.',
    ],
  },
  {
    title: '2. Information We Collect',
    paragraphs: [],
  },
  {
    title: '2.1 Information You Provide',
    paragraphs: [],
    bullets: [
      'Full name and display name',
      'Email address',
      'Phone number (used for SMS verification and invite features)',
      'Profile information such as preferences, location, and interests',
      'Content you submit, including date plans, reviews, and messages',
    ],
  },
  {
    title: '2.2 Information Collected Automatically',
    paragraphs: [],
    bullets: [
      'Device information (device type, operating system, unique device identifiers)',
      'Usage data (features used, pages visited, time spent in-app)',
      'Location data (with your permission, to suggest local experiences)',
      'Log data (IP address, browser type, referring URLs)',
    ],
  },
  {
    title: '2.3 Information from Third Parties',
    paragraphs: [],
    bullets: [
      'Google Sign-In: name, email address, and profile picture from your Google account',
      'Apple Sign-In: name and email address from your Apple ID',
    ],
  },
  {
    title: '3. How We Use Your Information',
    paragraphs: ['We use the information we collect to:'],
    bullets: [
      'Create and manage your Mingla account',
      'Verify your phone number via one-time SMS passcodes (OTP)',
      'Send invite SMS messages on your behalf when you invite friends to join Mingla',
      'Generate personalized date and hangout plans based on your preferences',
      'Suggest local experiences, venues, and activities near you',
      'Improve and develop our Service',
      'Communicate with you about updates, features, and support',
      'Detect and prevent fraud, abuse, and security incidents',
      'Comply with legal obligations',
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
    paragraphs: ['We do not sell your personal information. We may share your information with:'],
  },
  {
    title: '5.1 Service Providers',
    paragraphs: [],
    bullets: [
      'Supabase – database and authentication infrastructure',
      'Twilio – SMS delivery for OTP verification and invite messages',
      'Vonage – SMS delivery services',
      'Google – authentication services (Google Sign-In)',
      'Apple – authentication services (Apple Sign-In)',
    ],
  },
  {
    title: '5.2 Legal Requirements',
    paragraphs: [
      'We may disclose your information if required by law, court order, or governmental authority, or to protect the rights, property, or safety of Mingla, our users, or the public.',
    ],
  },
  {
    title: '5.3 Business Transfers',
    paragraphs: [
      'In the event of a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction. We will notify you before your information is transferred and becomes subject to a different privacy policy.',
    ],
  },
  {
    title: '6. Data Retention',
    paragraphs: [
      'We retain your personal information for as long as your account is active or as needed to provide you with our Service. If you delete your account, we will delete or anonymize your personal data within 30 days, unless we are required to retain it for legal or regulatory reasons.',
    ],
  },
  {
    title: '7. Your Rights and Choices',
    paragraphs: [
      'Depending on your location, you may have the following rights:',
    ],
    bullets: [
      'Access: Request a copy of the personal data we hold about you',
      'Correction: Request that we correct inaccurate or incomplete data',
      'Deletion: Request that we delete your personal data',
      'Portability: Request a copy of your data in a machine-readable format',
      'Opt-out: Opt out of SMS messages by replying STOP',
    ],
    footer: 'To exercise any of these rights, contact us at privacy@usemingla.com.',
  },
  {
    title: '8. Children’s Privacy',
    paragraphs: [
      'Mingla is not intended for use by individuals under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected data from a child under 13, we will take steps to delete it promptly.',
    ],
  },
  {
    title: '9. Security',
    paragraphs: [
      'We implement industry-standard security measures to protect your information, including encryption in transit and at rest, secure authentication via Supabase, and access controls. However, no method of electronic storage or transmission is 100% secure, and we cannot guarantee absolute security.',
    ],
  },
  {
    title: '10. Third-Party Links',
    paragraphs: [
      'Our Service may contain links to third-party websites or services. We are not responsible for the privacy practices of those third parties and encourage you to review their privacy policies.',
    ],
  },
  {
    title: '11. Changes to This Policy',
    paragraphs: [
      'We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on our website and updating the effective date. Your continued use of the Service after changes are posted constitutes your acceptance of the updated policy.',
    ],
  },
  {
    title: '12. Contact Us',
    paragraphs: [
      'If you have any questions about this Privacy Policy, please contact us at:',
    ],
    contact: {
      name: 'Mingla / usemingla.com',
      email: 'developer@usemingla.com',
      website: 'https://www.usemingla.com',
    },
  },
] as const
