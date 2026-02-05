// Demo support tickets for QA Manager Dashboard testing
// In production, this will be replaced with Supabase queries

export const DEMO_SUPPORT_TICKETS = [
  {
    id: 'TKT001A',
    type: 'bug',
    title: 'Cards not loading on dashboard',
    description: 'When I log in to my curator dashboard, the cards section shows a loading spinner but never loads the actual cards. I\'ve tried refreshing multiple times and clearing my browser cache, but the issue persists.\n\nSteps to reproduce:\n1. Log in to curator dashboard\n2. Navigate to Cards tab\n3. Wait for cards to load\n4. Cards never appear\n\nExpected: Cards should load within 2-3 seconds\nActual: Infinite loading spinner',
    priority: 'high',
    status: 'new',
    submittedBy: {
      name: 'Sarah Martinez',
      email: 'sarah.martinez@example.com'
    },
    attachments: [],
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'TKT002B',
    type: 'issue',
    title: 'Unable to upload business logo',
    description: 'I\'m trying to upload a logo for my business profile, but I keep getting an error message saying "Upload failed". The file is a PNG and only 800KB in size, well under any reasonable limit.\n\nI\'ve tried:\n- Different image formats (PNG, JPG)\n- Smaller file sizes\n- Different browsers (Chrome, Safari)\n\nNone of these workarounds help. This is blocking me from completing my business profile.',
    priority: 'medium',
    status: 'in-progress',
    submittedBy: {
      name: 'David Chen',
      email: 'david.chen@example.com'
    },
    attachments: [],
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() // 1 hour ago
  },
  {
    id: 'TKT003C',
    type: 'feature',
    title: 'Add bulk edit feature for experience cards',
    description: 'As a curator managing multiple experiences, I would love to have a bulk edit feature that allows me to:\n\n1. Select multiple cards at once\n2. Edit common fields (like availability, pricing, etc.) in one go\n3. Apply changes to all selected cards\n\nThis would save so much time when I need to update availability or pricing across multiple experiences. Currently, I have to edit each card individually which is very time-consuming when managing 20+ experiences.\n\nExample use case: Updating all my experiences to be unavailable during a vacation period.',
    priority: 'low',
    status: 'new',
    submittedBy: {
      name: 'Jessica Williams',
      email: 'jessica.williams@example.com'
    },
    attachments: [],
    createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
    updatedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'TKT004D',
    type: 'bug',
    title: 'Commission calculator showing incorrect percentages',
    description: 'The commission calculator in the business collaboration module is showing incorrect percentages. When I set my commission to 15%, it displays as 1.5% in the preview.\n\nThis is confusing for both me and the business owners I\'m working with. It seems like a decimal point issue in the calculation or display logic.',
    priority: 'critical',
    status: 'new',
    submittedBy: {
      name: 'Michael Thompson',
      email: 'michael.thompson@example.com'
    },
    attachments: [],
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString()
  },
  {
    id: 'TKT005E',
    type: 'issue',
    title: 'QR code validation not working at venue',
    description: 'I had a customer try to redeem their QR code at my experience today, but when I scanned it with the validation app, it said "Invalid code" even though they had just purchased it 10 minutes earlier.\n\nThe customer showed me their purchase confirmation email and the QR code looked legitimate. I had to manually verify and let them in, but this could become a big problem if it happens frequently.\n\nTicket number from their purchase: PUR-2024-10567',
    priority: 'high',
    status: 'resolved',
    submittedBy: {
      name: 'Emily Rodriguez',
      email: 'emily.rodriguez@example.com'
    },
    attachments: [],
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
  }
];

// Function to seed tickets to localStorage (for demo purposes)
export function seedDemoTickets() {
  const existingTickets = JSON.parse(localStorage.getItem('supportTickets') || '[]');
  
  // Only seed if there are no tickets yet
  if (existingTickets.length === 0) {
    localStorage.setItem('supportTickets', JSON.stringify(DEMO_SUPPORT_TICKETS));
    console.log('Demo support tickets seeded successfully');
  }
}

// Function to clear all tickets (useful for testing)
export function clearAllTickets() {
  localStorage.removeItem('supportTickets');
  console.log('All support tickets cleared');
}

// Function to add a single demo ticket
export function addDemoTicket(ticket: any) {
  const existingTickets = JSON.parse(localStorage.getItem('supportTickets') || '[]');
  existingTickets.push(ticket);
  localStorage.setItem('supportTickets', JSON.stringify(existingTickets));
  console.log('Demo ticket added:', ticket.id);
}
