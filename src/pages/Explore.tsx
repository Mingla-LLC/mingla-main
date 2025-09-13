import React, { useState, useEffect, useMemo } from 'react';
import { Search, TrendingUp, MapPin } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TripCard } from '@/components/TripCard';
import { TripCardExpanded } from '@/components/TripCardExpanded';
import { categories, getCategoryBySlug } from '@/lib/categories';
import { useExperiences } from '@/hooks/useExperiences';

const trending = [
  { name: 'Sip & Chill', trend: '+25%', slug: 'sip' },
  { name: 'Creative & Hands-On', trend: '+18%', slug: 'creative' },
  { name: 'Dining Experience', trend: '+15%', slug: 'dining' },
  { name: 'Take a Stroll', trend: '+12%', slug: 'stroll' }
];

const Explore = () => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);
  
  // Memoize the category filter to prevent unnecessary re-renders
  const categoryFilters = useMemo(() => {
    return selectedCategory ? [selectedCategory] : undefined;
  }, [selectedCategory]);
  
  // Fetch experiences based on selected category
  const { experiences, loading, error } = useExperiences(categoryFilters);

  // Convert experiences to trip format for cards
  const trips = experiences
    .filter(exp => 
      !searchQuery || 
      exp.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.category.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .map(exp => ({
      id: exp.id,
      title: exp.title,
      image: exp.image_url || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085',
      cost: exp.price_min || 25,
      duration: `${exp.duration_min || 90} min`,
      travelTime: '8 min walk',
      badges: ['Available'],
      whyItFits: 'Discover new experiences in your area',
      location: 'Local Area',
      category: getCategoryBySlug(exp.category_slug)?.name || exp.category,
      latitude: exp.lat || 47.6062,
      longitude: exp.lng || -122.3321
    }));

  const handleCategorySelect = (categorySlug: string) => {
    setSelectedCategory(categorySlug === selectedCategory ? null : categorySlug);
  };

  const handleTrendingSelect = (slug: string) => {
    setSelectedCategory(slug);
  };

  const handleSwipeRight = (tripId: string) => {
    // Handle like/save functionality
    console.log('Saved trip:', tripId);
  };

  const handleSwipeLeft = (tripId: string) => {
    // Handle dismiss functionality
    console.log('Dismissed trip:', tripId);
  };

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center px-6">
          <h3 className="text-lg font-semibold mb-2">Something went wrong</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-4">
        <h1 className="text-2xl font-bold mb-2">Explore</h1>
        <p className="text-muted-foreground mb-4">
          Discover experiences by category and trending activities
        </p>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search experiences..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-muted rounded-xl border-0 focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>
      </div>

      {/* Categories - Horizontal Scroll */}
      <div className="px-6 mb-6">
        <h2 className="text-lg font-semibold mb-3">Categories</h2>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {categories.map((category) => (
            <Card 
              key={category.slug} 
              className={`flex-shrink-0 p-3 cursor-pointer transition-all min-w-[120px] ${
                selectedCategory === category.slug 
                  ? 'bg-primary text-primary-foreground shadow-elevated' 
                  : 'hover:shadow-card'
              }`}
              onClick={() => handleCategorySelect(category.slug)}
            >
              <div className="text-center">
                <span className="text-2xl mb-1 block">{category.icon}</span>
                <h3 className="font-medium text-xs">{category.name}</h3>
                <p className={`text-xs mt-1 ${
                  selectedCategory === category.slug ? 'text-primary-foreground/80' : 'text-muted-foreground'
                }`}>
                  {experiences.filter(exp => exp.category_slug === category.slug).length}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Trending - Compact */}
      {!selectedCategory && (
        <div className="px-6 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Trending Now</h2>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {trending.map((item, index) => (
              <Card 
                key={index} 
                className="flex-shrink-0 p-3 hover:shadow-card transition-all cursor-pointer min-w-[100px]"
                onClick={() => handleTrendingSelect(item.slug)}
              >
                <div className="text-center">
                  <span className="font-medium text-xs block">{item.name}</span>
                  <Badge variant="outline" className="text-xs text-primary border-primary/20 mt-1">
                    {item.trend}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {selectedCategory && (
        <div className="px-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              {getCategoryBySlug(selectedCategory)?.name} Experiences
            </h2>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setSelectedCategory(null)}
            >
              Clear Filter
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading experiences...</p>
            </div>
          ) : trips.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No experiences found in this category</p>
            </div>
          ) : (
            <div className="space-y-4">
              {trips.slice(0, 10).map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onSwipeRight={() => handleSwipeRight(trip.id)}
                  onSwipeLeft={() => handleSwipeLeft(trip.id)}
                  onExpand={() => setExpandedTrip(trip.id)}
                  disableSwipe={false}
                  className="max-w-sm mx-auto"
                />
              ))}
              {trips.length > 10 && (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">
                    Showing 10 of {trips.length} experiences
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* All Experiences when no filter - Compact Grid */}
      {!selectedCategory && !loading && (
        <div className="px-6 pb-8">
          <h2 className="text-lg font-semibold mb-4">All Experiences</h2>
          {trips.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No experiences available</p>
            </div>
          ) : (
            <div className="space-y-4">
              {trips.slice(0, 5).map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onSwipeRight={() => handleSwipeRight(trip.id)}
                  onSwipeLeft={() => handleSwipeLeft(trip.id)}
                  onExpand={() => setExpandedTrip(trip.id)}
                  disableSwipe={false}
                  className="max-w-sm mx-auto"
                />
              ))}
              {trips.length > 5 && (
                <div className="text-center py-4">
                  <Button variant="outline" onClick={() => setSelectedCategory('')}>
                    View All {trips.length} Experiences
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Expanded Trip Modal */}
      {expandedTrip && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm">
            <TripCardExpanded
              trip={trips.find(t => t.id === expandedTrip)!}
              isOpen={true}
              onClose={() => setExpandedTrip(null)}
              onAccept={() => {
                handleSwipeRight(expandedTrip);
                setExpandedTrip(null);
              }}
              showAcceptButton={true}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Explore;