import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Filter, Grid, List, Eye, Edit2, Trash2, MoreVertical } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner@2.0.3';
import CardCreatorModal from '../CardCreatorModal';
import CardEditorModal from '../CardEditorModal';
import CardPreviewModal from '../CardPreviewModal';
import { CardCreatorBadge } from '../CardCreatorBadge';
import QAPageLayout from './QAPageLayout';

interface QAMyCardsProps {
  userData?: any;
  triggerCreate?: boolean;
}

export default function QAMyCards({ userData, triggerCreate }: QAMyCardsProps) {
  const [cards, setCards] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
  const [showCreator, setShowCreator] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const currentUserId = currentUser.id || currentUser.username || userData?.email || '';

  useEffect(() => {
    loadCards();
  }, []);

  useEffect(() => {
    if (triggerCreate) {
      setShowCreator(true);
    }
  }, [triggerCreate]);

  const loadCards = () => {
    const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    // QA Manager sees their own created cards
    const qaCards = platformCards.filter((card: any) => 
      card.createdBy === currentUserId || 
      card.createdBy?.includes('qa') ||
      card.createdByRole === 'qa'
    );
    setCards(qaCards);
  };

  const filteredCards = useMemo(() => {
    let filtered = cards;

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(card =>
        card.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        card.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        card.location?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(card => card.status === statusFilter);
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(card => card.category === categoryFilter);
    }

    return filtered;
  }, [cards, searchQuery, statusFilter, categoryFilter]);

  const handleCreateCard = () => {
    setShowCreator(true);
  };

  const handleEditCard = (card: any) => {
    setSelectedCard(card);
    setShowEditor(true);
  };

  const handlePreviewCard = (card: any) => {
    setSelectedCard(card);
    setShowPreview(true);
  };

  const handleDeleteCard = (cardId: string) => {
    if (confirm('Are you sure you want to delete this experience?')) {
      const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
      const updatedCards = platformCards.filter((c: any) => c.id !== cardId);
      localStorage.setItem('platformCards', JSON.stringify(updatedCards));
      setCards(cards.filter(c => c.id !== cardId));
      toast.success('Experience deleted');
    }
  };

  const handleSaveCard = (newCard: any) => {
    const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    const cardWithMetadata = {
      ...newCard,
      id: `qa-card-${Date.now()}`,
      createdBy: currentUserId,
      createdByName: userData?.name || 'QA Manager',
      createdByRole: 'qa',
      createdAt: new Date().toISOString(),
      status: 'live'
    };
    platformCards.push(cardWithMetadata);
    localStorage.setItem('platformCards', JSON.stringify(platformCards));
    setCards([...cards, cardWithMetadata]);
    setShowCreator(false);
    toast.success('Experience created successfully');
  };

  const handleUpdateCard = (updatedCard: any) => {
    const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    const updatedCards = platformCards.map((c: any) =>
      c.id === updatedCard.id ? { ...updatedCard, lastEditedAt: new Date().toISOString() } : c
    );
    localStorage.setItem('platformCards', JSON.stringify(updatedCards));
    setCards(cards.map(c => c.id === updatedCard.id ? updatedCard : c));
    setShowEditor(false);
    toast.success('Experience updated successfully');
  };

  return (
    <QAPageLayout
      title="My Cards"
      description="Experiences you've created"
      actions={
        <Button
          onClick={handleCreateCard}
          className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] hover:from-[#d6691f] hover:to-[#eb7825] text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Experience
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Filters */}
        <Card className="p-4 border border-gray-200">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search experiences..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="in-review">In Review</SelectItem>
              </SelectContent>
            </Select>

            {/* Category Filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="dining">Dining</SelectItem>
                <SelectItem value="wellness">Wellness</SelectItem>
                <SelectItem value="creative">Creative</SelectItem>
                <SelectItem value="play-move">Play & Move</SelectItem>
              </SelectContent>
            </Select>

            {/* View Mode */}
            <div className="flex gap-2">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('grid')}
              >
                <Grid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="p-4 border border-gray-200">
            <p className="text-[#6B7280] text-sm">Total Experiences</p>
            <p className="text-[#111827] text-2xl mt-1">{cards.length}</p>
          </Card>
          <Card className="p-4 border border-gray-200">
            <p className="text-[#6B7280] text-sm">Live Experiences</p>
            <p className="text-[#111827] text-2xl mt-1">
              {cards.filter(c => c.status === 'live').length}
            </p>
          </Card>
          <Card className="p-4 border border-gray-200">
            <p className="text-[#6B7280] text-sm">Draft Experiences</p>
            <p className="text-[#111827] text-2xl mt-1">
              {cards.filter(c => c.status === 'draft').length}
            </p>
          </Card>
        </div>

        {/* Cards Grid/List */}
        {filteredCards.length === 0 ? (
          <Card className="p-12 border border-gray-200 text-center">
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 bg-[#eb7825]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Plus className="w-8 h-8 text-[#eb7825]" />
              </div>
              <h3 className="text-[#111827] mb-2">No experiences yet</h3>
              <p className="text-[#6B7280] mb-4">
                {searchQuery ? 'No experiences match your search.' : 'Create your first experience to get started.'}
              </p>
              {!searchQuery && (
                <Button
                  onClick={handleCreateCard}
                  className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] hover:from-[#d6691f] hover:to-[#eb7825] text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Experience
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' : 'space-y-4'}>
            {filteredCards.map((card) => (
              <motion.div
                key={card.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className="overflow-hidden border border-gray-200 hover:shadow-lg transition-shadow">
                  {viewMode === 'grid' ? (
                    <>
                      <div className="aspect-video bg-gradient-to-br from-orange-100 to-amber-100 relative">
                        {card.image && (
                          <img src={card.image} alt={card.title} className="w-full h-full object-cover" />
                        )}
                        <div className="absolute top-3 right-3">
                          <Badge className={
                            card.status === 'live' 
                              ? 'bg-green-500 text-white' 
                              : 'bg-gray-500 text-white'
                          }>
                            {card.status}
                          </Badge>
                        </div>
                        {card.createdBy && (
                          <div className="absolute top-3 left-3">
                            <CardCreatorBadge
                              createdBy={card.createdBy}
                              createdByRole={card.createdByRole || 'qa'}
                              createdByName={card.createdByName}
                              currentUserId={currentUserId}
                              isApiGenerated={card.isApiGenerated}
                            />
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="text-[#111827] mb-2 line-clamp-2">{card.title}</h3>
                        <p className="text-[#6B7280] text-sm line-clamp-2 mb-4">{card.description}</p>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleEditCard(card)}
                            size="sm"
                            variant="outline"
                            className="flex-1"
                          >
                            <Edit2 className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          <Button
                            onClick={() => handlePreviewCard(card)}
                            size="sm"
                            variant="outline"
                            className="flex-1"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            View
                          </Button>
                          <Button
                            onClick={() => handleDeleteCard(card.id)}
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="p-4 flex gap-4">
                      <div className="w-32 h-24 bg-gradient-to-br from-orange-100 to-amber-100 rounded-lg flex-shrink-0">
                        {card.image && (
                          <img src={card.image} alt={card.title} className="w-full h-full object-cover rounded-lg" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-[#111827] line-clamp-1">{card.title}</h3>
                          <Badge className={
                            card.status === 'live' 
                              ? 'bg-green-500 text-white' 
                              : 'bg-gray-500 text-white'
                          }>
                            {card.status}
                          </Badge>
                        </div>
                        <p className="text-[#6B7280] text-sm line-clamp-2 mt-1">{card.description}</p>
                        <div className="flex gap-2 mt-3">
                          <Button onClick={() => handleEditCard(card)} size="sm" variant="outline">
                            <Edit2 className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          <Button onClick={() => handlePreviewCard(card)} size="sm" variant="outline">
                            <Eye className="w-3 h-3 mr-1" />
                            View
                          </Button>
                          <Button
                            onClick={() => handleDeleteCard(card.id)}
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreator && (
        <CardCreatorModal
          onClose={() => setShowCreator(false)}
          onSave={handleSaveCard}
        />
      )}

      {showEditor && selectedCard && (
        <CardEditorModal
          card={selectedCard}
          onClose={() => {
            setShowEditor(false);
            setSelectedCard(null);
          }}
          onSave={handleUpdateCard}
        />
      )}

      {showPreview && selectedCard && (
        <CardPreviewModal
          card={selectedCard}
          onClose={() => {
            setShowPreview(false);
            setSelectedCard(null);
          }}
        />
      )}
    </QAPageLayout>
  );
}
