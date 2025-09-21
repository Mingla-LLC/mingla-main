import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, Users, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { RecommendationCard } from '@/types/recommendations';

interface TrafficHeatmapProps {
  card: RecommendationCard;
}

interface PopularTime {
  hour: number;
  popularity: number; // 0-100
}

export const TrafficHeatmap: React.FC<TrafficHeatmapProps> = ({ card }) => {
  const [popularTimes, setPopularTimes] = useState<PopularTime[]>([]);
  const [currentPopularity, setCurrentPopularity] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Generate realistic popular times data based on category
  const generatePopularTimes = (category: string): PopularTime[] => {
    const times: PopularTime[] = [];
    
    // Define patterns based on category
    const patterns: Record<string, { peak: number[]; moderate: number[]; low: number[] }> = {
      'sip': {
        peak: [17, 18, 19, 20, 21, 22],
        moderate: [16, 23],
        low: [9, 10, 11, 12, 13, 14, 15, 0, 1]
      },
      'dining': {
        peak: [12, 13, 18, 19, 20],
        moderate: [11, 14, 17, 21],
        low: [9, 10, 15, 16, 22, 23, 0, 1]
      },
      'casual_eats': {
        peak: [12, 13, 17, 18, 19],
        moderate: [11, 14, 15, 16, 20],
        low: [9, 10, 21, 22, 23, 0, 1]
      },
      'stroll': {
        peak: [10, 11, 14, 15, 16, 17],
        moderate: [9, 12, 13, 18],
        low: [19, 20, 21, 22, 23, 0, 1]
      },
      'play_move': {
        peak: [9, 10, 11, 17, 18, 19],
        moderate: [8, 12, 16, 20],
        low: [13, 14, 15, 21, 22, 23, 0, 1]
      },
      'creative': {
        peak: [14, 15, 16, 17, 18],
        moderate: [10, 11, 12, 13, 19],
        low: [9, 20, 21, 22, 23, 0, 1]
      },
      'screen_relax': {
        peak: [19, 20, 21, 22],
        moderate: [14, 15, 16, 17, 18],
        low: [9, 10, 11, 12, 13, 23, 0, 1]
      }
    };

    const pattern = patterns[category] || patterns['stroll'];
    
    for (let hour = 0; hour < 24; hour++) {
      let popularity = 20; // Base popularity
      
      if (pattern.peak.includes(hour)) {
        popularity = 70 + Math.random() * 30; // 70-100%
      } else if (pattern.moderate.includes(hour)) {
        popularity = 40 + Math.random() * 30; // 40-70%
      } else if (pattern.low.includes(hour)) {
        popularity = 10 + Math.random() * 30; // 10-40%
      }
      
      times.push({ hour, popularity: Math.round(popularity) });
    }
    
    return times;
  };

  const getCurrentPopularity = (times: PopularTime[]): number => {
    const currentHour = new Date().getHours();
    const currentTime = times.find(t => t.hour === currentHour);
    return currentTime?.popularity || 30;
  };

  const getPopularityLevel = (popularity: number): {
    level: 'low' | 'moderate' | 'high';
    color: string;
    icon: React.ReactNode;
    text: string;
  } => {
    if (popularity < 40) {
      return {
        level: 'low',
        color: 'bg-green-100 text-green-800 border-green-200',
        icon: <TrendingDown className="h-3 w-3" />,
        text: 'Usually quiet'
      };
    } else if (popularity < 70) {
      return {
        level: 'moderate',
        color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        icon: <Minus className="h-3 w-3" />,
        text: 'Moderately busy'
      };
    } else {
      return {
        level: 'high',
        color: 'bg-red-100 text-red-800 border-red-200',
        icon: <TrendingUp className="h-3 w-3" />,
        text: 'Usually busy'
      };
    }
  };

  const getPeakHours = (times: PopularTime[]): string => {
    const peaks = times
      .filter(t => t.popularity > 70)
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 3);
    
    if (peaks.length === 0) return 'No peak hours';
    
    return peaks
      .map(p => `${p.hour}:00`)
      .join(', ');
  };

  useEffect(() => {
    const times = generatePopularTimes(card.category);
    setPopularTimes(times);
    setCurrentPopularity(getCurrentPopularity(times));
    setLoading(false);
  }, [card.category]);

  if (loading) {
    return (
      <Card className="p-3 bg-muted/30">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-muted rounded w-20"></div>
          <div className="h-3 bg-muted rounded w-32"></div>
        </div>
      </Card>
    );
  }

  const popularityInfo = getPopularityLevel(currentPopularity);
  const peakHours = getPeakHours(popularTimes);

  return (
    <Card className="p-3 bg-gradient-to-br from-background/50 to-accent/10 border border-border/50">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Current Activity</span>
        </div>
        
        <div className="flex items-center justify-between">
          <Badge 
            variant="outline"
            className={`text-xs font-medium border ${popularityInfo.color}`}
          >
            <div className="flex items-center gap-1">
              {popularityInfo.icon}
              <span>{popularityInfo.text}</span>
            </div>
          </Badge>
          <span className="text-xs text-muted-foreground">
            {currentPopularity}% busy
          </span>
        </div>

        {/* Visual popularity bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Activity Level</span>
            <span>{currentPopularity}%</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 rounded-full ${
                currentPopularity < 40 ? 'bg-green-500' :
                currentPopularity < 70 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${currentPopularity}%` }}
            />
          </div>
        </div>

        {peakHours !== 'No peak hours' && (
          <div className="flex items-start gap-2 pt-1 border-t border-border/30">
            <Clock className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Peak hours:</span> {peakHours}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};