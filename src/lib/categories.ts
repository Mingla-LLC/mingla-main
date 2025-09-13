export interface Category {
  slug: string;
  name: string;
  icon: string;
}

export const categories: Category[] = [
  {
    slug: 'stroll',
    name: 'Take a Stroll',
    icon: '🥾'
  },
  {
    slug: 'sip',
    name: 'Sip & Chill',
    icon: '☕'
  },
  {
    slug: 'casual_eats',
    name: 'Casual Eats',
    icon: '🍔'
  },
  {
    slug: 'screen_relax',
    name: 'Screen & Relax',
    icon: '🎬'
  },
  {
    slug: 'creative',
    name: 'Creative & Hands-On',
    icon: '🎨'
  },
  {
    slug: 'play_move',
    name: 'Play & Move',
    icon: '🏃'
  },
  {
    slug: 'dining',
    name: 'Dining Experience',
    icon: '🍽️'
  },
  {
    slug: 'freestyle',
    name: 'Freestyle',
    icon: '🔀'
  }
];

export const getCategoryBySlug = (slug: string): Category | undefined => {
  return categories.find(category => category.slug === slug);
};

export const getCategoriesBySlug = (slugs: string[]): Category[] => {
  return slugs.map(getCategoryBySlug).filter((category): category is Category => category !== undefined);
};