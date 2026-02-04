import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Filter, Eye, Edit2, Trash2, CheckCircle, XCircle, 
  AlertCircle, MoreVertical, Grid, List, Flag, Shield
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { Textarea } from '../ui/textarea';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner@2.0.3';
import CardEditorModal from '../CardEditorModal';
import CardPreviewModal from '../CardPreviewModal';
import { CardCreatorBadge } from '../CardCreatorBadge';
import QAPageLayout from './QAPageLayout';

interface QAModerateProps {
  userData?: any;
}

export default function QAModerate({ userData }: QAModerateProps) {
  const [experiences, setExperiences] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [creatorFilter, setCreatorFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
  const [selectedExp, setSelectedExp] = useState<any>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagReason, setFlagReason] = useState('');

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const currentUserId = currentUser.id || currentUser.username || userData?.email || '';

  useEffect(() => {
    loadExperiences();
  }, []);

  const loadExperiences = () => {
    // QA sees ALL experiences for moderation
    const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    setExperiences(platformCards);
  };

  const filteredExperiences = useMemo(() => {
    let filtered = experiences;

    if (searchQuery) {
      filtered = filtered.filter(exp =>
        exp.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exp.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'flagged') {
        filtered = filtered.filter(exp => exp.flaggedForReview);
      } else {
        filtered = filtered.filter(exp => exp.status === statusFilter);
      }
    }

    if (creatorFilter !== 'all') {
      if (creatorFilter === 'api') {
        filtered = filtered.filter(exp => exp.isApiGenerated || exp.createdByRole === 'api');
      } else {
        filtered = filtered.filter(exp => exp.createdByRole === creatorFilter);
      }
    }

    return filtered;
  }, [experiences, searchQuery, statusFilter, creatorFilter]);

  const handleFlag = (exp: any) => {
    setSelectedExp(exp);
    setShowFlagModal(true);
  };

  const handleSubmitFlag = () => {
    if (!flagReason.trim()) {
      toast.error('Please provide a reason for flagging');
      return;
    }

    const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    const updated = platformCards.map((c: any) =>
      c.id === selectedExp.id 
        ? { 
            ...c, 
            flaggedForReview: true,
            flagReason,
            flaggedBy: userData?.email || 'QA Manager',
            flaggedAt: new Date().toISOString(),
            status: 'in-review'
          }
        : c
    );
    localStorage.setItem('platformCards', JSON.stringify(updated));
    loadExperiences();
    setShowFlagModal(false);
    setFlagReason('');
    setSelectedExp(null);
    toast.success('Experience flagged for admin review');
  };

  const handleUnflag = (exp: any) => {
    if (confirm('Are you sure you want to remove the flag from this experience?')) {
      const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
      const updated = platformCards.map((c: any) =>
        c.id === exp.id 
          ? { 
              ...c, 
              flaggedForReview: false,
              flagReason: null,
              flaggedBy: null,
              flaggedAt: null,
              status: 'live'
            }
          : c
      );
      localStorage.setItem('platformCards', JSON.stringify(updated));
      loadExperiences();
      toast.success('Flag removed from experience');
    }
  };

  const handleEdit = (exp: any) => {
    setSelectedExp(exp);
    setShowEditor(true);
  };

  const handlePreview = (exp: any) => {
    setSelectedExp(exp);
    setShowPreview(true);
  };

  const handleSave = (cardData: any) => {
    const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    const updated = platformCards.map((c: any) =>
      c.id === selectedExp.id 
        ? { ...c, ...cardData, lastEditedBy: userData?.email, lastEditedAt: new Date().toISOString() }
        : c
    );
    localStorage.setItem('platformCards', JSON.stringify(updated));
    loadExperiences();
    setShowEditor(false);
    setSelectedExp(null);
    toast.success('Experience updated');
  };

  const getStatusBadge = (exp: any) => {
    if (exp.flaggedForReview) {
      return <Badge className="bg-red-500 text-white">Flagged</Badge>;
    }
    
    const variants: any = {
      draft: <Badge variant="secondary">Draft</Badge>,
      'in-review': <Badge variant="outline" className="border-yellow-500 text-yellow-700">In Review</Badge>,
      live: <Badge className="bg-green-500 text-white">Live</Badge>,
      returned: <Badge className="bg-orange-500 text-white">Returned</Badge>
    };
    
    return variants[exp.status] || <Badge>{exp.status}</Badge>;
  };

  const flaggedCount = experiences.filter(e => e.flaggedForReview).length;
  const liveCount = experiences.filter(e => e.status === 'live' && !e.flaggedForReview).length;
  const reviewCount = experiences.filter(e => e.status === 'in-review').length;

  return (
    <QAPageLayout
      title="Content Moderation"
      description="Monitor and moderate all platform content"
    >
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="p-4 border border-gray-200">
            <p className="text-[#6B7280] text-sm">Total Experiences</p>
            <p className="text-[#111827] text-2xl mt-1">{experiences.length}</p>
          </Card>
          <Card className="p-4 border border-gray-200">
            <p className="text-[#6B7280] text-sm">Live Experiences</p>
            <p className="text-[#111827] text-2xl mt-1">{liveCount}</p>
          </Card>
          <Card className="p-4 border border-gray-200">
            <p className="text-[#6B7280] text-sm">In Review</p>
            <p className="text-[#111827] text-2xl mt-1">{reviewCount}</p>
          </Card>
          <Card className="p-4 border border-red-200 bg-red-50">
            <p className="text-red-700 text-sm">Flagged Content</p>
            <p className="text-red-900 text-2xl mt-1">{flaggedCount}</p>
          </Card>
        </div>

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
                <SelectItem value="in-review">In Review</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="flagged">Flagged</SelectItem>
              </SelectContent>
            </Select>

            {/* Creator Filter */}
            <Select value={creatorFilter} onValueChange={setCreatorFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Creator" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Creators</SelectItem>
                <SelectItem value="api">API Generated</SelectItem>
                <SelectItem value="curator">Curator</SelectItem>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="qa">QA Manager</SelectItem>
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

        {/* Experiences Grid/List */}
        {filteredExperiences.length === 0 ? (
          <Card className="p-12 border border-gray-200 text-center">
            <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-[#111827] mb-2">No experiences found</h3>
            <p className="text-[#6B7280]">
              {searchQuery ? 'Try adjusting your search or filters.' : 'No experiences available for moderation.'}
            </p>
          </Card>
        ) : (
          <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' : 'space-y-4'}>
            {filteredExperiences.map((exp) => (
              <motion.div
                key={exp.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className={`overflow-hidden border-2 hover:shadow-lg transition-shadow ${
                  exp.flaggedForReview ? 'border-red-300 bg-red-50' : 'border-gray-200'
                }`}>
                  {viewMode === 'grid' ? (
                    <>
                      <div className="aspect-video bg-gradient-to-br from-purple-100 to-blue-100 relative">
                        {exp.image && (
                          <img src={exp.image} alt={exp.title} className="w-full h-full object-cover" />
                        )}
                        <div className="absolute top-3 right-3">
                          {getStatusBadge(exp)}
                        </div>
                        {exp.createdBy && (
                          <div className="absolute top-3 left-3">
                            <CardCreatorBadge
                              createdBy={exp.createdBy}
                              createdByRole={exp.createdByRole}
                              createdByName={exp.createdByName}
                              currentUserId={currentUserId}
                              isApiGenerated={exp.isApiGenerated}
                            />
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="text-[#111827] mb-2 line-clamp-2">{exp.title}</h3>
                        <p className="text-[#6B7280] text-sm line-clamp-2 mb-4">{exp.description}</p>
                        
                        {exp.flaggedForReview && (
                          <div className="mb-4 p-3 bg-red-100 border border-red-200 rounded-lg">
                            <p className="text-red-900 text-sm">
                              <strong>Flagged:</strong> {exp.flagReason}
                            </p>
                            <p className="text-red-700 text-xs mt-1">
                              By {exp.flaggedBy} • {new Date(exp.flaggedAt).toLocaleDateString()}
                            </p>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Button
                            onClick={() => handlePreview(exp)}
                            size="sm"
                            variant="outline"
                            className="flex-1"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            View
                          </Button>
                          <Button
                            onClick={() => handleEdit(exp)}
                            size="sm"
                            variant="outline"
                            className="flex-1"
                          >
                            <Edit2 className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          {exp.flaggedForReview ? (
                            <Button
                              onClick={() => handleUnflag(exp)}
                              size="sm"
                              className="bg-green-500 hover:bg-green-600 text-white"
                            >
                              <CheckCircle className="w-3 h-3" />
                            </Button>
                          ) : (
                            <Button
                              onClick={() => handleFlag(exp)}
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Flag className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="p-4 flex gap-4">
                      <div className="w-32 h-24 bg-gradient-to-br from-purple-100 to-blue-100 rounded-lg flex-shrink-0">
                        {exp.image && (
                          <img src={exp.image} alt={exp.title} className="w-full h-full object-cover rounded-lg" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-[#111827] line-clamp-1">{exp.title}</h3>
                          {getStatusBadge(exp)}
                        </div>
                        <p className="text-[#6B7280] text-sm line-clamp-2 mt-1">{exp.description}</p>
                        {exp.flaggedForReview && (
                          <p className="text-red-600 text-sm mt-1">
                            <strong>Flagged:</strong> {exp.flagReason}
                          </p>
                        )}
                        <div className="flex gap-2 mt-3">
                          <Button onClick={() => handlePreview(exp)} size="sm" variant="outline">
                            <Eye className="w-3 h-3 mr-1" />
                            View
                          </Button>
                          <Button onClick={() => handleEdit(exp)} size="sm" variant="outline">
                            <Edit2 className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          {exp.flaggedForReview ? (
                            <Button
                              onClick={() => handleUnflag(exp)}
                              size="sm"
                              className="bg-green-500 hover:bg-green-600 text-white"
                            >
                              Unflag
                            </Button>
                          ) : (
                            <Button
                              onClick={() => handleFlag(exp)}
                              size="sm"
                              variant="outline"
                              className="text-red-600"
                            >
                              <Flag className="w-3 h-3 mr-1" />
                              Flag
                            </Button>
                          )}
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

      {/* Flag Modal */}
      <AnimatePresence>
        {showFlagModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-md w-full p-6"
            >
              <h3 className="text-[#111827] text-xl mb-4">Flag Experience</h3>
              <p className="text-[#6B7280] mb-4">
                Please provide a reason for flagging this experience. It will be sent to administrators for review.
              </p>
              <Textarea
                placeholder="Describe the issue..."
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
                className="mb-4"
                rows={4}
              />
              <div className="flex gap-3">
                <Button
                  onClick={() => {
                    setShowFlagModal(false);
                    setFlagReason('');
                    setSelectedExp(null);
                  }}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitFlag}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                >
                  Submit Flag
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Editor Modal */}
      {showEditor && selectedExp && (
        <CardEditorModal
          card={selectedExp}
          onClose={() => {
            setShowEditor(false);
            setSelectedExp(null);
          }}
          onSave={handleSave}
        />
      )}

      {/* Preview Modal */}
      {showPreview && selectedExp && (
        <CardPreviewModal
          card={selectedExp}
          onClose={() => {
            setShowPreview(false);
            setSelectedExp(null);
          }}
        />
      )}
    </QAPageLayout>
  );
}
