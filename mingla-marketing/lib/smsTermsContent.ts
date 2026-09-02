// META-ORCH-1161 COMPLIANCE-PAGES — SMS program terms content.
//
// Static program-terms page for Mingla's SMS messaging, mirroring the shape of
// termsContent.ts / privacyContent.ts so app/sms-terms/page.tsx reuses the same
// section renderer. This page is commonly required for carrier / toll-free
// verification. Copy is grounded in the real Mingla LLC values from
// Mingla_Artifacts/design/ORCH-1161/COPY_META-ORCH-1161_CONSENT_AND_MESSAGE_TEMPLATES.md
// (§1b, §2.5–§2.7, §4). No placeholders.

export const SMS_TERMS_EFFECTIVE_DATE = 'June 19, 2026'

export const SMS_TERMS_SECTIONS = [
  {
    title: '1. Program description',
    paragraphs: [
      'Mingla is operated by Mingla LLC ("Mingla," "we," "us"). When you provide your phone number and agree to receive texts — for example when you create a Mingla account, complete a booking or reservation, or join a waitlist — you consent to receive recurring automated text messages (SMS) from Mingla and from the venues and experience brands you book with ("Businesses").',
      'This page describes Mingla’s SMS messaging program, the types of messages you may receive, and how to get help or stop messages at any time.',
    ],
  },
  {
    title: '2. Types of messages you may receive',
    paragraphs: ['Depending on how you use Mingla, you may receive:'],
    bullets: [
      'Booking and reservation confirmations, changes, cancellations, refunds, and waitlist updates',
      'Event, experience, trip, and reservation reminders for bookings you make and for future events you may be interested in',
      'Account and security notices related to your activity',
      'Marketing and promotional messages, including offers and announcements from Mingla and from the Businesses you book with',
    ],
  },
  {
    title: '3. Message frequency',
    paragraphs: [
      'Message frequency varies and depends on your activity — for example, how often you book, reserve, or join waitlists, and the reminders and promotions tied to those bookings. We do not send a fixed number of messages per period.',
    ],
  },
  {
    title: '4. Cost',
    paragraphs: [
      'Msg & data rates may apply. Mingla does not charge you for receiving SMS messages, but your mobile carrier’s standard message and data rates may apply. Check with your carrier for details about your plan.',
    ],
  },
  {
    title: '5. How to opt out (STOP)',
    paragraphs: [
      'You can cancel the SMS program at any time. Reply STOP to any text message from the program to stop receiving further texts. We also honor QUIT, END, CANCEL, UNSUBSCRIBE, REVOKE, and OPT OUT.',
      'After you send a STOP message, you will receive one final message confirming that you have been unsubscribed. After that, you will no longer receive SMS messages from that program. Opting out of marketing texts does not stop transactional or account messages that are required to deliver what you booked.',
      'You can also opt out of all marketing messages — by email and text — at https://usemingla.com/unsubscribe, or adjust your notification preferences in the Mingla app at any time.',
    ],
  },
  {
    title: '6. How to get help (HELP)',
    paragraphs: [
      'For help with the SMS program, reply HELP to any text message, email us at support@usemingla.com, or call +1 888-250-5351.',
    ],
  },
  {
    title: '7. Carrier liability',
    paragraphs: [
      'Carriers are not liable for delayed or undelivered messages. Message delivery is subject to effective transmission from your wireless service provider and is not guaranteed by Mingla or your carrier.',
    ],
  },
  {
    title: '8. Privacy and terms',
    paragraphs: [
      'Your information is handled in accordance with our Privacy Policy, and your use of Mingla is governed by our Terms of Service. We do not sell your personal information except as described in the Privacy Policy. For full details, see the links below.',
    ],
  },
  {
    title: '9. Contact us',
    paragraphs: [
      'If you have any questions about Mingla’s SMS program, please contact us at:',
    ],
    contact: {
      name: 'Mingla LLC',
      address: '700 Corporate Center Dr, Raleigh, NC 27607, USA',
      email: 'support@usemingla.com',
      phone: '+1 888-250-5351',
      website: 'https://usemingla.com',
    },
  },
] as const
