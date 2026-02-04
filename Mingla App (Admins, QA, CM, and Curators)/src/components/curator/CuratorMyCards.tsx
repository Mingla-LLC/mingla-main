import React, { useState } from 'react';
import { Search, Plus, Filter, Grid, List, Eye, Edit2, Trash2, Clock, CheckCircle, XCircle, Edit } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { motion, AnimatePresence } from 'motion/react';
import { CardCreatorBadge } from '../CardCreatorBadge';
import CuratorPageLayout from './CuratorPageLayout';

interface CuratorMyCardsProps {
  cards: any[];
  currentUserId: string;
  onCreateCard: () => void;
  onEditCard: (card: any) => void;
  onViewCard: (card: any) => void;
  onDeleteCard: (cardId: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filterStatus: string;
  setFilterStatus: (status: string) => void;
}

export default function CuratorMyCards({
  cards,
  currentUserId,
  onCreateCard,
  onEditCard,
  onViewCard,
  onDeleteCard,
  searchQuery,
  setSearchQuery,
  filterStatus,
  setFilterStatus
}: CuratorMyCardsProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { icon: any; color: string; label: string }> = {
      live: { icon: CheckCircle, color: 'bg-gradient-to-r from-emerald-50 to-green-50 text-emerald-700 border border-emerald-200', label: 'Live' },
      'in-review': { icon: Clock, color: 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 border border-blue-200', label: 'In Review' },
      draft: { icon: Edit, color: 'bg-gradient-to-r from-gray-50 to-slate-50 text-gray-700 border border-gray-200', label: 'Draft' },
      returned: { icon: XCircle, color: 'bg-gradient-to-r from-orange-50 to-amber-50 text-orange-700 border border-orange-200', label: 'Returned' }
    };
    
    const config = configs[status] || configs.draft;
    const Icon = config.icon;
    
    return (
      <Badge className={`${config.color} flex items-center gap-1 px-3 py-1`}>
        <Icon className="w-3.5 h-3.5" />
        <span>{config.label}</span>
      </Badge>
    );
  };

  const filteredCards = cards.filter(card => {
    const matchesSearch = card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         card.category.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'all' || card.status === filterStatus;
    const matchesCategory = categoryFilter === 'all' || card.category === categoryFilter;
    return matchesSearch && matchesFilter && matchesCategory;
  });

  const stats = {
    total: cards.length,
    live: cards.filter(c => c.status === 'live').length,
    inReview: cards.filter(c => c.status === 'in-review').length,
    drafts: cards.filter(c => c.status === 'draft').length,
  };

  return (
    <CuratorPageLayout
      title="My Cards"
      description="Create and manage your experience cards"
      actions={
        <Button 
          onClick={onCreateCard}
          className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Card
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4 border border-gray-200 hover:shadow-md transition-shadow">
            <p className="text-[#6B7280] text-sm">Total Cards</p>
            <p className="text-2xl text-[#111827] mt-1">{stats.total}</p>
          </Card>
          <Card className="p-4 border border-gray-200 hover:shadow-md transition-shadow">
            <p className="text-[#6B7280] text-sm">Live</p>
            <p className="text-2xl text-emerald-600 mt-1">{stats.live}</p>
          </Card>
          <Card className="p-4 border border-gray-200 hover:shadow-md transition-shadow">
            <p className="text-[#6B7280] text-sm">In Review</p>
            <p className="text-2xl text-blue-600 mt-1">{stats.inReview}</p>
          </Card>
          <Card className="p-4 border border-gray-200 hover:shadow-md transition-shadow">
            <p className="text-[#6B7280] text-sm">Drafts</p>
            <p className="text-2xl text-gray-600 mt-1">{stats.drafts}</p>
          </Card>
        </div>

        {/* Filters */}
        <Card className="p-4 border border-gray-200">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search experiences..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full lg:w-[180px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="in-review">In Review</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="returned">Returned</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full lg:w-[180px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="casualEats">Casual Eats</SelectItem>
                <SelectItem value="diningExperiences">Dining Experiences</SelectItem>
                <SelectItem value="sipChill">Sip & Chill</SelectItem>
                <SelectItem value="takeAStroll">Take a Stroll</SelectItem>
                <SelectItem value="playMove">Play & Move</SelectItem>
                <SelectItem value="screenRelax">Screen & Relax</SelectItem>
                <SelectItem value="creativeHandsOn">Creative & Hands-On</SelectItem>
                <SelectItem value="wellnessDates">Wellness Dates</SelectItem>
                <SelectItem value="picnics">Picnics & Outdoor Dining</SelectItem>
                <SelectItem value="freestyle">Freestyle</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setViewMode('grid')}
              >
                <Grid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setViewMode('list')}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>

        {/* Cards Grid/List */}
        {filteredCards.length === 0 ? (
          <Card className="p-8 border border-gray-200">
            <div className="text-center">
              <p className="text-[#6B7280] mb-4">
                {searchQuery || filterStatus !== 'all' || categoryFilter !== 'all'
                  ? 'No experiences match your filters'
                  : 'You haven\'t created any experiences yet'}
              </p>
              {!searchQuery && filterStatus === 'all' && categoryFilter === 'all' && (
                <Button onClick={onCreateCard} className="bg-[#eb7825] hover:bg-[#d6691f] text-white">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Card
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div className={viewMode === 'grid' 
            ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6'
            : 'space-y-4'
          }>
            <AnimatePresence mode="popLayout">
              {filteredCards.map((card) => (
                <motion.div
                  key={card.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  {viewMode === 'grid' ? (
                    <Card className="overflow-hidden border border-gray-200 hover:shadow-lg transition-shadow">
                      <div className="relative h-48 bg-gray-100">
                        {card.image && (
                          <img src={card.image} alt={card.title} className="w-full h-full object-cover" />
                        )}
                        <div className="absolute top-3 left-3">
                          <CardCreatorBadge
                            createdBy={card.createdBy}
                            createdByRole={card.createdByRole}
                            createdByName={card.createdByName}
                            currentUserId={currentUserId}
                            isApiGenerated={card.isApiGenerated}
                          />
                        </div>
                        <div className="absolute top-3 right-3">
                          {getStatusBadge(card.status)}
                        </div>
                      </div>
                      <div className="p-4">
                        <h3 className="text-[#111827] line-clamp-2">{card.title}</h3>
                        <p className="text-[#6B7280] text-sm mt-2 line-clamp-2">{card.description || card.category}</p>
                        <div className="flex items-center gap-4 mt-4 text-sm text-[#6B7280]">
                          <div className="flex items-center gap-1">
                            <Eye className="w-4 h-4" />
                            <span>{card.views || 0}</span>
                          </div>
                          <span>{card.category}</span>
                        </div>
                        <div className="flex gap-2 mt-4">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="flex-1"
                            onClick={() => onViewCard(card)}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Preview
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="flex-1"
                            onClick={() => onEditCard(card)}
                          >
                            <Edit2 className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onDeleteCard(card.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ) : (
                    <Card className="p-4 border border-gray-200 hover:shadow-md transition-shadow">
                      <div className="flex gap-4">
                        <div className="relative w-32 h-32 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                          {card.image && (
                            <img src={card.image} alt={card.title} className="w-full h-full object-cover" />
                          )}
                          <div className="absolute top-2 left-2">
                            <CardCreatorBadge
                              createdBy={card.createdBy}
                              createdByRole={card.createdByRole}
                              createdByName={card.createdByName}
                              currentUserId={currentUserId}
                              isApiGenerated={card.isApiGenerated}
                            />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <h3 className="text-[#111827]">{card.title}</h3>
                              <p className="text-[#6B7280] text-sm mt-1 line-clamp-2">{card.description || card.category}</p>
                              <div className="flex items-center gap-4 mt-2 text-sm text-[#6B7280]">
                                <span>{card.category}</span>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                  <Eye className="w-4 h-4" />
                                  <span>{card.views || 0} views</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              {getStatusBadge(card.status)}
                              <div className="flex gap-2">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => onViewCard(card)}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => onEditCard(card)}
                                >
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onDeleteCard(card.id)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </CuratorPageLayout>
  );
}
