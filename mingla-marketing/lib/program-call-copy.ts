// #4339 Creators and Locals calls (Seth approved, 9 Nov) — what each program
// call page says, the approved design word for word. Read on the server
// (app/schedule/ProgramCallPage.tsx) and passed to ScheduleClient as a prop,
// so the words ride in the page, not in the client bundle (#4339 first-load
// budget).

export const PROGRAM_CALL_COPY = {
  creator: {
    pill: 'Mingla Creators',
    team: 'Creators team.',
    lead: 'Twenty minutes with the people who run the program. You’ll get a calendar invite with a video link.',
    covers: [
      'How gigs are posted, and how you raise your hand',
      'What hosts look for in your work',
      'Contracts, delivery and how you get paid',
    ],
    next: 'Creator setup lives in the Mingla app. Get it before the call and we can walk through your profile together.',
    back: { href: '/creators', label: 'Back to Creators' },
    handoff: 'creators_call_booked',
  },
  local: {
    pill: 'Mingla Locals',
    team: 'Locals team.',
    lead: 'Twenty minutes on how the monthly review works. You’ll get a calendar invite with a video link.',
    covers: [
      'When your city opens, and how the three seats are chosen',
      'Which places are eligible for a review',
      'Approval, disclosure and how the $150 is paid',
    ],
    next: 'You apply inside Mingla when your city opens. Get it now so you’re ready.',
    back: { href: '/locals', label: 'Back to Locals' },
    handoff: 'locals_call_booked',
  },
} as const

export type ProgramCallCopy = (typeof PROGRAM_CALL_COPY)[keyof typeof PROGRAM_CALL_COPY]
