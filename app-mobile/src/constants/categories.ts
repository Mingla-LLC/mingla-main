export interface Category {
  slug: string;
  name: string;
  icon: string;
  description: string;
}

export const categories: Category[] = [
  {
    slug: 'stroll',
    name: 'Take a Stroll',
    icon: '🚶‍♀️',
    description: 'Walking experiences, parks, neighborhoods, scenic routes'
  },
  {
    slug: 'sip',
    name: 'Sip & Chill',
    icon: '☕',
    description: 'Coffee shops, tea houses, casual drinking spots, lounges'
  },
  {
    slug: 'dining',
    name: 'Dining Experience',
    icon: '🍽️',
    description: 'Restaurants, food markets, culinary experiences'
  },
  {
    slug: 'creative',
    name: 'Creative & Hands-On',
    icon: '🎨',
    description: 'Art studios, workshops, maker spaces, creative activities'
  },
  {
    slug: 'shopping',
    name: 'Market & Shopping',
    icon: '🛍️',
    description: 'Markets, boutiques, unique shopping experiences'
  },
  {
    slug: 'wellness',
    name: 'Health & Wellness',
    icon: '🧘‍♀️',
    description: 'Spas, yoga studios, fitness activities, wellness centers'
  },
  {
    slug: 'culture',
    name: 'Arts & Culture',
    icon: '🎭',
    description: 'Museums, galleries, theaters, cultural events'
  },
  {
    slug: 'nightlife',
    name: 'Social & Nightlife',
    icon: '🌃',
    description: 'Bars, clubs, social venues, evening entertainment'
  }
];

export const getCategoryBySlug = (slug: string): Category | undefined => {
  return categories.find(category => category.slug === slug);
};
