import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Filter, Eye, Edit2, Trash2, CheckCircle, XCircle, 
  AlertCircle, MoreVertical, Grid, List, Download
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
import AdminPageLayout from './AdminPageLayout';

interface AdminModerateProps {
  userData?: any;
}

export default function AdminModerate({ userData }: AdminModerateProps) {
  const [experiences, setExperiences] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [creatorFilter, setCreatorFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
  const [selectedExp, setSelectedExp] = useState<any>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedback, setFeedback] = useState('');

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const currentUserId = currentUser.id || currentUser.username || userData?.email || '';

  useEffect(() => {
    loadExperiences();
  }, []);

  const loadExperiences = () => {
    // Admin sees ALL experiences (no filtering)
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
      filtered = filtered.filter(exp => exp.status === statusFilter);
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

  const handleApprove = (exp: any) => {
    const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    const updated = platformCards.map((c: any) =>
      c.id === exp.id 
        ? { ...c, status: 'live', publishedAt: new Date().toISOString() }
        : c
    );
    localStorage.setItem('platformCards', JSON.stringify(updated));
    loadExperiences();
    toast.success('Experience approved and published');
  };

  const handleReturn = (exp: any) => {
    setSelectedExp(exp);
    setShowFeedbackModal(true);
  };

  const handleSubmitFeedback = () => {
    if (!feedback.trim()) {
      toast.error('Please provide feedback');
      return;
    }

    const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    const updated = platformCards.map((c: any) =>
      c.id === selectedExp.id 
        ? { ...c, status: 'returned', feedback: `Admin: ${feedback}` }
        : c
    );
    localStorage.setItem('platformCards', JSON.stringify(updated));
    loadExperiences();
    setShowFeedbackModal(false);
    setFeedback('');
    setSelectedExp(null);
    toast.success('Experience returned with feedback');
  };

  const handleDelete = (expId: string) => {
    if (confirm('Are you sure you want to permanently delete this experience?')) {
      const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
      const updated = platformCards.filter((c: any) => c.id !== expId);
      localStorage.setItem('platformCards', JSON.stringify(updated));
      loadExperiences();
      toast.success('Experience deleted');
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
        ? { ...c, ...cardData, lastEdited: new Date().toISOString() }
        : c
    );
    localStorage.setItem('platformCards', JSON.stringify(updated));
    loadExperiences();
    setShowEditor(false);
    setSelectedExp(null);
    toast.success('Experience updated');
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

  const stats = [
    { label: 'Total', value: experiences.length, color: 'text-blue-600' },
    { label: 'In Review', value: experiences.filter(e => e.status === 'in-review').length, color: 'text-yellow-600' },
    { label: 'Live', value: experiences.filter(e => e.status === 'live').length, color: 'text-green-600' },
    { label: 'Returned', value: experiences.filter(e => e.status === 'returned').length, color: 'text-red-600' }
  ];

  return (
    <AdminPageLayout
      title="Moderate Experiences"
      description="Review, edit, and manage all experiences on the platform"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
        >
          {viewMode === 'grid' ? <List className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
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
          <Select value={creatorFilter} onValueChange={setCreatorFilter}>
            <SelectTrigger className="w-full lg:w-[180px]">
              <SelectValue placeholder="Creator" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Creators</SelectItem>
              <SelectItem value="curator">Curators</SelectItem>
              <SelectItem value="business">Businesses</SelectItem>
              <SelectItem value="qa">QA Managers</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
              <SelectItem value="api">API Generated</SelectItem>
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

      {/* Experiences Grid/List */}
      {filteredExperiences.length === 0 ? (
        <Card className="p-12 border border-gray-200">
          <p className="text-[#6B7280] text-center">No experiences match your filters</p>
        </Card>
      ) : (
        <div className={viewMode === 'grid'
          ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
          : 'space-y-4'
        }>
          <AnimatePresence mode="popLayout">
            {filteredExperiences.map((exp) => (
              <motion.div
                key={exp.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Card className="overflow-hidden border border-gray-200 hover:shadow-lg transition-shadow">
                  <div className="relative h-48 bg-gray-100">
                    {exp.image && (
                      <img src={exp.image} alt={exp.title} className="w-full h-full object-cover" />
                    )}
                    <div className="absolute top-3 left-3">
                      <CardCreatorBadge
                        createdBy={exp.createdBy}
                        createdByRole={exp.createdByRole}
                        createdByName={exp.createdByName}
                        currentUserId={currentUserId}
                        isApiGenerated={exp.isApiGenerated}
                      />
                    </div>
                    <div className="absolute top-3 right-3">
                      {getStatusBadge(exp.status)}
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="text-[#111827] line-clamp-2">{exp.title}</h3>
                    <p className="text-[#6B7280] text-sm mt-2 line-clamp-2">{exp.description}</p>
                    {exp.feedback && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-xs text-red-800">{exp.feedback}</p>
                      </div>
                    )}
                    <div className="flex gap-2 mt-4">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handlePreview(exp)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleEdit(exp)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      {exp.status === 'in-review' && (
                        <>
                          <Button 
                            size="sm"
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => handleApprove(exp)}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                          <Button 
                            size="sm"
                            variant="outline"
                            className="border-red-300 text-red-600 hover:bg-red-50"
                            onClick={() => handleReturn(exp)}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(exp.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedbackModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md p-6">
            <h2 className="text-[#111827] mb-4">Return Experience</h2>
            <p className="text-[#6B7280] text-sm mb-4">
              Provide feedback for <span className="font-medium">{selectedExp?.title}</span>
            </p>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Enter your feedback..."
              rows={4}
              className="mb-4"
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowFeedbackModal(false);
                  setFeedback('');
                  setSelectedExp(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmitFeedback}
                className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
              >
                Submit Feedback
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && selectedExp && (
        <CardEditorModal
          isOpen={showEditor}
          onClose={() => {
            setShowEditor(false);
            setSelectedExp(null);
          }}
          card={selectedExp}
          onSave={handleSave}
        />
      )}

      {/* Preview Modal */}
      {showPreview && selectedExp && (
        <CardPreviewModal
          isOpen={showPreview}
          onClose={() => {
            setShowPreview(false);
            setSelectedExp(null);
          }}
          card={selectedExp}
        />
      )}
      </div>
    </AdminPageLayout>
  );
}
