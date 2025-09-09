import React from 'react';
import { Search, TrendingUp, MapPin } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const collections = [
  {
    id: 1,
    title: 'Tonight',
    subtitle: 'Perfect for this evening',
    image: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3',
    count: 12,
    color: 'from-primary to-primary-dark'
  },
  {
    id: 2,
    title: 'Weekend Brunch',
    subtitle: 'Lazy morning vibes',
    image: 'https://images.unsplash.com/photo-1551218808-94e220e084d2',
    count: 18,
    color: 'from-secondary to-secondary-dark'
  },
  {
    id: 3,
    title: 'Creative This Week', 
    subtitle: 'Hands-on experiences',
    image: 'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0',
    count: 9,
    color: 'from-accent to-accent-dark'
  }
];

const trending = [
  { name: 'Pottery Classes', trend: '+25%' },
  { name: 'Rooftop Dining', trend: '+18%' },
  { name: 'Wine Tasting', trend: '+15%' },
  { name: 'Art Galleries', trend: '+12%' }
];

const Explore = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <h1 className="text-2xl font-bold mb-2">Explore</h1>
        <p className="text-muted-foreground mb-6">
          Discover curated collections and trending experiences
        </p>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search experiences..."
            className="w-full pl-10 pr-4 py-3 bg-muted rounded-xl border-0 focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>
      </div>

      {/* Curated Collections */}
      <div className="px-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Curated Collections</h2>
        <div className="space-y-4">
          {collections.map((collection) => (
            <Card key={collection.id} className="overflow-hidden cursor-pointer hover:shadow-elevated transition-all">
              <div className="relative h-32">
                <img
                  src={collection.image}
                  alt={collection.title}
                  className="w-full h-full object-cover"
                />
                <div className={`absolute inset-0 bg-gradient-to-r ${collection.color} opacity-80`} />
                <div className="absolute inset-0 flex items-center justify-between p-4">
                  <div>
                    <h3 className="text-white font-bold text-lg">{collection.title}</h3>
                    <p className="text-white/90 text-sm">{collection.subtitle}</p>
                  </div>
                  <Badge variant="secondary" className="bg-white/20 text-white border-white/20">
                    {collection.count} experiences
                  </Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Trending */}
      <div className="px-6 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Trending Now</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {trending.map((item, index) => (
            <Card key={index} className="p-4 hover:shadow-card transition-all cursor-pointer">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{item.name}</span>
                <Badge variant="outline" className="text-xs text-primary border-primary/20">
                  {item.trend}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Quick Filters */}
      <div className="px-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Quick Filters</h2>
        <div className="flex flex-wrap gap-2">
          {['Under $30', 'Walking Distance', 'Indoor', 'Group Friendly', 'Date Night', 'Family'].map((filter) => (
            <Button key={filter} variant="outline" size="sm" className="rounded-full">
              {filter}
            </Button>
          ))}
        </div>
      </div>

      {/* Popular Locations */}
      <div className="px-6 pb-8">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Popular Areas</h2>
        </div>
        <div className="space-y-3">
          {['Capitol Hill', 'Pike Place Market', 'Belltown', 'Fremont'].map((location) => (
            <Card key={location} className="p-4 cursor-pointer hover:shadow-card transition-all">
              <div className="flex items-center justify-between">
                <span className="font-medium">{location}</span>
                <span className="text-sm text-muted-foreground">15 min away</span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Explore;