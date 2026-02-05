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
import AdminPageLayout from './AdminPageLayout';

interface AdminMyCardsProps {
  userData?: any;
  triggerCreate?: boolean;
}

export default function AdminMyCards({ userData, triggerCreate }: AdminMyCardsProps) {
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
    // Admin sees their own created cards
    const adminCards = platformCards.filter((card: any) => 
      card.createdBy === currentUserId || 
      card.createdBy?.includes('admin') ||
      card.createdByRole === 'admin'
    );
    setCards(adminCards);
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
      loadCards();
      toast.success('Experience deleted successfully');
    }
  };

  const handleSaveCard = (cardData: any) => {
    const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    
    if (selectedCard) {
      // Update existing card
      const updatedCards = platformCards.map((c: any) =>
        c.id === selectedCard.id ? { ...c, ...cardData, lastEdited: new Date().toISOString() } : c
      );
      localStorage.setItem('platformCards', JSON.stringify(updatedCards));
      toast.success('Experience updated successfully');
    } else {
      // Create new card
      const newCard = {
        id: `card-${Date.now()}`,
        ...cardData,
        createdBy: currentUserId,
        createdByRole: 'admin',
        createdByName: userData?.name || 'Admin',
        createdAt: new Date().toISOString(),
        lastEdited: new Date().toISOString(),
        views: 0,
        likes: 0,
        saves: 0,
        shares: 0
      };
      platformCards.push(newCard);
      localStorage.setItem('platformCards', JSON.stringify(platformCards));
      toast.success('Experience created successfully');
    }
    
    loadCards();
    setShowCreator(false);
    setShowEditor(false);
    setSelectedCard(null);
  };

  const getStatusBadge = (status: string) => {
    const variants: any = {
      draft: { variant: 'secondary', label: 'Draft' },
      'in-review': { variant: 'outline', label: 'In Review' },
      live: { variant: 'default', label: 'Live', className: 'bg-green-500' },
      returned: { variant: 'destructive', label: 'Returned' }
    };
    const config = variants[status] || variants.draft;
    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const statCards = [
    { label: 'Total Cards', value: cards.length, color: 'text-blue-600' },
    { label: 'Live', value: cards.filter(c => c.status === 'live').length, color: 'text-green-600' },
    { label: 'In Review', value: cards.filter(c => c.status === 'in-review').length, color: 'text-yellow-600' },
    { label: 'Draft', value: cards.filter(c => c.status === 'draft').length, color: 'text-gray-600' }
  ];

  return (
    <AdminPageLayout
      title="My Cards"
      description="Create and manage your experience cards"
      actions={
        <Button 
          onClick={handleCreateCard}
          className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Card
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statCards.map((stat, index) => (
          <Card key={index} className="p-4 border border-gray-200">
            <p className="text-[#6B7280] text-sm">{stat.label}</p>
            <p className={`text-2xl mt-1 ${stat.color}`}>{stat.value}</p>
          </Card>
        ))}
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
          <Select value={statusFilter} onValueChange={setStatusFilter}>
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
        <Card className="p-12 border border-gray-200">
          <div className="text-center">
            <p className="text-[#6B7280] mb-4">
              {searchQuery || statusFilter !== 'all' || categoryFilter !== 'all'
                ? 'No experiences match your filters'
                : 'You haven\'t created any experiences yet'}
            </p>
            {!searchQuery && statusFilter === 'all' && categoryFilter === 'all' && (
              <Button onClick={handleCreateCard} className="bg-[#eb7825] hover:bg-[#d6691f] text-white">
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
                      <p className="text-[#6B7280] text-sm mt-2 line-clamp-2">{card.description}</p>
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
                          onClick={() => handlePreviewCard(card)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          Preview
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="flex-1"
                          onClick={() => handleEditCard(card)}
                        >
                          <Edit2 className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteCard(card.id)}
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
                            <p className="text-[#6B7280] text-sm mt-1 line-clamp-2">{card.description}</p>
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
                                onClick={() => handlePreviewCard(card)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handleEditCard(card)}
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteCard(card.id)}
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

      {/* Modals */}
      {showCreator && (
        <CardCreatorModal
          isOpen={showCreator}
          onClose={() => setShowCreator(false)}
          onSave={handleSaveCard}
        />
      )}

      {showEditor && selectedCard && (
        <CardEditorModal
          isOpen={showEditor}
          onClose={() => {
            setShowEditor(false);
            setSelectedCard(null);
          }}
          card={selectedCard}
          onSave={handleSaveCard}
        />
      )}

      {showPreview && selectedCard && (
        <CardPreviewModal
          isOpen={showPreview}
          onClose={() => {
            setShowPreview(false);
            setSelectedCard(null);
          }}
          card={selectedCard}
        />
      )}
      </div>
    </AdminPageLayout>
  );
}
