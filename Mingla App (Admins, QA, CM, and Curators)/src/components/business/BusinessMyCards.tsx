import React, { useState } from 'react';
import { 
  Search, Edit, Eye, Trash2, Plus, Filter,
  CheckCircle, Clock, XCircle, FileText, Package,
  MapPin, Star, Share2, Building2, Users, Music, Sparkles, Calendar,
  X, ChevronRight, DollarSign, Navigation, Ticket
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { motion, AnimatePresence } from 'motion/react';
import BusinessPageLayout from './BusinessPageLayout';
import { CardCreatorBadge } from '../CardCreatorBadge';
import { getCategoryLabel } from '../utils/formatters';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import { getIconComponent } from '../swipeable-cards/utils';
import { getCategoryDisplayName } from '../utils/preferences';

interface BusinessMyCardsProps {
  businessData?: any;
  experiences: any[];
  onEditCard: (card: any) => void;
  onViewCard: (card: any) => void;
  onDeleteCard: (cardId: string) => void;
  onCreateCard: () => void;
  currentUserId?: string;
}

export default function BusinessMyCards({
  businessData,
  experiences,
  onEditCard,
  onViewCard,
  onDeleteCard,
  onCreateCard,
  currentUserId
}: BusinessMyCardsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'in-review' | 'live' | 'returned'>('all');

  const filteredExperiences = experiences.filter(exp => {
    const matchesSearch = exp.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         exp.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'all' || exp.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'live':
        return { icon: CheckCircle, color: 'text-green-600 bg-green-50 border-green-200', label: 'Live' };
      case 'in-review':
        return { icon: Clock, color: 'text-blue-600 bg-blue-50 border-blue-200', label: 'In Review' };
      case 'returned':
        return { icon: XCircle, color: 'text-red-600 bg-red-50 border-red-200', label: 'Returned' };
      case 'draft':
      default:
        return { icon: FileText, color: 'text-gray-600 bg-gray-50 border-gray-200', label: 'Draft' };
    }
  };

  const stats = {
    total: experiences.length,
    live: experiences.filter(e => e.status === 'live').length,
    inReview: experiences.filter(e => e.status === 'in-review').length,
    draft: experiences.filter(e => e.status === 'draft').length,
  };

  return (
    <BusinessPageLayout
      title=""
      description=""
      actions={
        <div className="space-y-3 w-full">
          {/* Stats Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col items-center justify-center px-4 py-3 border border-gray-200 rounded-2xl bg-white">
              <span className="text-2xl font-bold text-gray-900 mb-1">{stats.total}</span>
              <span className="text-sm text-gray-500 font-medium">Total</span>
            </div>
            <div className="flex flex-col items-center justify-center px-4 py-3 border border-green-200 rounded-2xl bg-green-50">
              <span className="text-2xl font-bold text-green-900 mb-1">{stats.live}</span>
              <span className="text-sm text-green-600 font-medium">Live</span>
            </div>
            <div className="flex flex-col items-center justify-center px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50">
              <span className="text-2xl font-bold text-gray-900 mb-1">{stats.draft}</span>
              <span className="text-sm text-gray-500 font-medium">Draft</span>
            </div>
          </div>

          {/* Search and Filter Row */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                type="text"
                placeholder="Search experiences..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterStatus} onValueChange={(value: any) => setFilterStatus(value)}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="in-review">In Review</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="returned">Returned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Cards Grid */}
        {filteredExperiences.length === 0 ? (
          <Card className="p-8 sm:p-12 text-center border border-gray-200">
            <Package className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-[#111827] mb-2">
              {searchQuery || filterStatus !== 'all' ? 'No experiences found' : 'No experiences yet'}
            </h3>
            <p className="text-[#6B7280] mb-6 max-w-md mx-auto">
              {searchQuery || filterStatus !== 'all'
                ? 'Try adjusting your filters or search query'
                : 'Create your first experience card to start attracting customers'}
            </p>
            {!searchQuery && filterStatus === 'all' && (
              <Button 
                onClick={onCreateCard}
                className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Card
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredExperiences.map((exp) => {
              const statusInfo = getStatusInfo(exp.status);
              const StatusIcon = statusInfo.icon;
              
              return (
                <Card key={exp.id} className="p-4 border border-gray-200 hover:shadow-lg transition-all group">
                  {/* Card Image with Badge Overlays */}
                  {(exp.coverImage || exp.heroImage || exp.image) && (
                    <div className="relative w-full h-40 sm:h-48 rounded-lg overflow-hidden mb-3">
                      <img
                        src={exp.coverImage || exp.heroImage || exp.image}
                        alt={exp.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      {/* Top Badges */}
                      <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-2">
                        {exp.matchScore && (
                          <div className="bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full flex items-center gap-1 shadow-md">
                            <Star className="w-3.5 h-3.5 text-[#eb7825] fill-[#eb7825]" />
                            <span className="text-sm font-semibold text-gray-900">{exp.matchScore}% Match</span>
                          </div>
                        )}
                        <Badge className={`${statusInfo.color} border ml-auto`}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {statusInfo.label}
                        </Badge>
                      </div>
                    </div>
                  )}
                  
                  {/* Card Content - Full Explorer View Style */}
                  <div className="flex-1 flex flex-col">
                    {/* Type and Host (for parties/festivals) */}
                    {(exp.type || exp.host) && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-[#eb7825]">{exp.type}</span>
                        {exp.host && (
                          <>
                            <span className="text-xs text-gray-400">•</span>
                            <div className="flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-gray-500" />
                              <span className="text-xs text-gray-600">{exp.host}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Category Icon and Name */}
                    <div className="flex items-center gap-2 mb-2">
                      {exp.categoryIcon && (() => {
                        const CategoryIcon = getIconComponent(exp.categoryIcon);
                        return (
                          <div className="w-8 h-8 bg-gradient-to-br from-orange-100 to-orange-50 rounded-full flex items-center justify-center shadow-sm">
                            <CategoryIcon className="w-4 h-4 text-[#eb7825]" />
                          </div>
                        );
                      })()}
                      <span className="text-sm text-gray-600 font-medium">
                        {exp.category ? getCategoryDisplayName(exp.category) : getCategoryLabel(exp.category)}
                      </span>
                    </div>

                    {/* Title */}
                    <h3 className="text-lg font-bold text-gray-900 mb-2 line-clamp-2">{exp.title}</h3>

                    {/* Venue Info */}
                    {(exp.venue || exp.venueName) && (
                      <div className="flex items-start gap-2 mb-2">
                        <MapPin className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{exp.venue || exp.venueName}</p>
                          {exp.address && <p className="text-xs text-gray-600 line-clamp-1">{exp.address}</p>}
                        </div>
                      </div>
                    )}

                    {/* Date & Time (for parties/festivals) */}
                    {(exp.date || exp.time) && (
                      <div className="flex items-center gap-3 mb-2 text-sm text-gray-600">
                        {exp.date && (
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{exp.date}</span>
                          </div>
                        )}
                        {exp.time && (
                          <>
                            {exp.date && <span className="text-gray-400">•</span>}
                            <div className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              <span className="text-xs">{exp.time}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Description */}
                    <p className="text-sm text-gray-600 mb-3 leading-relaxed line-clamp-2">
                      {exp.description}
                    </p>

                    {/* Attendees (for parties/festivals) */}
                    {(exp.attendees !== undefined || exp.maxCapacity) && (
                      <div className="flex items-center gap-1 text-sm text-gray-600 mb-2">
                        <Users className="w-4 h-4" />
                        <span>{exp.attendees || 0} attending</span>
                        {exp.maxCapacity && <span className="text-gray-400">/ {exp.maxCapacity} max</span>}
                      </div>
                    )}

                    {/* Music Genre (for parties/festivals) */}
                    {exp.musicGenre && (
                      <div className="flex items-center gap-1 mb-2">
                        <Music className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-xs text-gray-600">{exp.musicGenre}</span>
                      </div>
                    )}

                    {/* Vibe Tags */}
                    {exp.vibe && exp.vibe.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {exp.vibe.slice(0, 3).map((tag: string, idx: number) => (
                          <span key={idx} className="px-2 py-1 bg-purple-50 text-purple-700 text-xs rounded-full border border-purple-200">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Vibetags (alternative field) */}
                    {exp.vibeTags && exp.vibeTags.length > 0 && !exp.vibe && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {exp.vibeTags.slice(0, 3).map((tag: string, idx: number) => (
                          <span key={idx} className="px-2 py-1 bg-purple-50 text-purple-700 text-xs rounded-full border border-purple-200">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* What's Included */}
                    {exp.includes && exp.includes.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-700 mb-1.5">Includes:</p>
                        <div className="space-y-1">
                          {exp.includes.slice(0, 3).map((item: string, idx: number) => (
                            <div key={idx} className="flex items-start gap-1.5">
                              <Sparkles className="w-3 h-3 text-[#eb7825] mt-0.5 flex-shrink-0" />
                              <span className="text-xs text-gray-600 line-clamp-1">{item}</span>
                            </div>
                          ))}
                          {exp.includes.length > 3 && (
                            <span className="text-xs text-gray-500 ml-4">+{exp.includes.length - 3} more</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Info Badges */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {(exp.price || (exp.purchaseOptions && exp.purchaseOptions.length > 0)) && (
                        <div className="flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-[#eb7825] to-[#d6691f] rounded-full text-xs">
                          <span className="text-white font-bold">
                            {exp.price ? `$${exp.price}` : `From $${exp.purchaseOptions[0].price}`}
                          </span>
                        </div>
                      )}
                      {exp.rating && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-full text-xs">
                          <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                          <span className="text-gray-700 font-medium">{exp.rating}</span>
                          {exp.reviewCount && <span className="text-gray-500">({exp.reviewCount})</span>}
                        </div>
                      )}
                      {exp.distance && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-full text-xs">
                          <MapPin className="w-3 h-3 text-gray-600" />
                          <span className="text-gray-700">{exp.distance}</span>
                        </div>
                      )}
                      {exp.dressCode && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 rounded-full text-xs">
                          <span className="text-blue-700">{exp.dressCode}</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 mt-auto pt-3 border-t border-gray-100">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onViewCard(exp)}
                        className="flex-1"
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEditCard(exp)}
                        className="flex-1"
                      >
                        <Edit className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onDeleteCard(exp.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </BusinessPageLayout>
  );
}