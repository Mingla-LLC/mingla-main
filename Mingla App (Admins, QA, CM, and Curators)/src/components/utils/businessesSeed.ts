/**
 * Seed data for businesses onboarded to the platform
 */

export const BUSINESSES_SEED = [
  {
    id: 'business-le-jardin',
    name: 'Le Jardin',
    logo: '',
    website: 'https://lejardinsf.com',
    description: 'Fine dining restaurant featuring seasonal tasting menus with locally-sourced ingredients',
    category: 'diningExp',
    location: 'Mission District, San Francisco',
    contactEmail: 'contact@lejardinsf.com',
    contactPhone: '(415) 555-0101',
    curatorId: null, // Self-managed business
    createdBy: 'business-le-jardin',
    createdAt: '2025-01-05T09:00:00Z',
    updatedAt: '2025-01-05T09:00:00Z',
    status: 'active'
  },
  {
    id: 'business-clay-co',
    name: 'Clay & Co Studio',
    logo: '',
    website: 'https://clayandco.com',
    description: 'Professional pottery studio offering workshops and classes for all skill levels',
    category: 'creative',
    location: 'SOMA, San Francisco',
    contactEmail: 'hello@clayandco.com',
    contactPhone: '(415) 555-0102',
    curatorId: null, // Self-managed business
    createdBy: 'business-clay-co',
    createdAt: '2025-01-07T10:00:00Z',
    updatedAt: '2025-01-07T10:00:00Z',
    status: 'active'
  },
  {
    id: 'business-blue-note',
    name: 'The Blue Note SF',
    logo: '',
    website: 'https://bluenotesf.com',
    description: 'Intimate jazz club featuring live performances from local and touring artists',
    category: 'screenRelax',
    location: 'SoMa, San Francisco',
    contactEmail: 'info@bluenotesf.com',
    contactPhone: '(415) 555-0103',
    curatorId: 'curator-002',
    createdBy: 'curator-002',
    createdAt: '2025-01-06T14:00:00Z',
    updatedAt: '2025-01-06T14:00:00Z',
    status: 'active',
    commission: 10
  },
  {
    id: 'business-bay-adventures',
    name: 'Bay Adventures',
    logo: '',
    website: 'https://bayadventures.com',
    description: 'Outdoor adventure company specializing in kayaking and water sports',
    category: 'playMove',
    location: 'Marina District, San Francisco',
    contactEmail: 'adventures@bayexplore.com',
    contactPhone: '(415) 555-0104',
    curatorId: 'curator-002',
    createdBy: 'curator-002',
    createdAt: '2025-01-09T11:00:00Z',
    updatedAt: '2025-01-09T11:00:00Z',
    status: 'active',
    commission: 10
  },
  {
    id: 'business-farmhouse',
    name: 'The Farmhouse Kitchen',
    logo: '',
    website: 'https://farmhousekitchen.com',
    description: 'Farm-to-table restaurant focusing on seasonal, local ingredients',
    category: 'casualEats',
    location: 'Hayes Valley, San Francisco',
    contactEmail: 'reservations@farmhousekitchen.com',
    contactPhone: '(415) 555-0105',
    curatorId: 'curator-001',
    createdBy: 'curator-001',
    createdAt: '2025-01-11T08:00:00Z',
    updatedAt: '2025-01-11T08:00:00Z',
    status: 'active',
    commission: 10
  },
  {
    id: 'business-urban-explorers',
    name: 'Urban Explorers',
    logo: '',
    website: 'https://urbanexplorers.com',
    description: 'Walking tour company showcasing San Francisco\'s neighborhoods and hidden gems',
    category: 'stroll',
    location: 'Various SF Locations',
    contactEmail: 'tours@urbanexplorers.com',
    contactPhone: '(415) 555-0106',
    curatorId: null, // Self-managed business
    createdBy: 'business-urban-explorers',
    createdAt: '2025-01-13T09:00:00Z',
    updatedAt: '2025-01-13T09:00:00Z',
    status: 'active'
  },
  {
    id: 'business-skyview',
    name: 'SkyView Cinema',
    logo: '',
    website: 'https://skyviewcinema.com',
    description: 'Rooftop cinema featuring classic and indie films under the stars',
    category: 'screenRelax',
    location: 'Downtown SF',
    contactEmail: 'info@skyviewcinema.com',
    contactPhone: '(415) 555-0107',
    curatorId: 'curator-002',
    createdBy: 'curator-002',
    createdAt: '2025-01-12T13:00:00Z',
    updatedAt: '2025-01-12T13:00:00Z',
    status: 'active',
    commission: 10
  }
];
