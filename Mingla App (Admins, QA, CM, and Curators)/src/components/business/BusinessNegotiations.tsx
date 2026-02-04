import React, { useState, useMemo } from 'react';
import { 
  Target, Search, CheckCircle, Clock, XCircle, MessageSquare,
  TrendingUp, AlertCircle, Eye, Filter, Mail
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
import BusinessPageLayout from './BusinessPageLayout';
import BusinessInvitations from './BusinessInvitations';

interface BusinessNegotiationsProps {
  business?: any;
  formatCurrency?: (amount: number) => string;
  businessEmail?: string;
}

export default function BusinessNegotiations({ business, formatCurrency, businessEmail }: BusinessNegotiationsProps) {
  const [activeTab, setActiveTab] = useState<'invitations' | 'negotiations'>('invitations');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');

  // Get current user email
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const userEmail = businessEmail || currentUser.email || '';

  // Get invitations count
  const invitationsCount = (() => {
    const allInvitations = JSON.parse(localStorage.getItem('business_invitations') || '[]');
    return allInvitations.filter((inv: any) => 
      inv.invitedEmail?.toLowerCase() === userEmail?.toLowerCase()
    ).length;
  })();

  // Get negotiations from localStorage
  const negotiations = useMemo(() => {
    const allCollaborations = JSON.parse(localStorage.getItem('collaborations') || '[]');
    return allCollaborations
      .filter((collab: any) => collab.businessId === business?.id && collab.commissionHistory)
      .map((collab: any) => {
        const history = collab.commissionHistory || [];
        return history.map((nego: any) => ({
          ...nego,
          businessName: collab.businessName,
          curatorName: collab.curatorName,
          collaborationId: collab.id
        }));
      })
      .flat();
  }, [business?.id]);

  const filteredNegotiations = negotiations.filter((nego: any) => {
    const matchesSearch = 
      nego.curatorName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      nego.businessName?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = 
      filterStatus === 'all' ||
      nego.status === filterStatus;
    
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: negotiations.length,
    pending: negotiations.filter((n: any) => n.status === 'pending').length,
    accepted: negotiations.filter((n: any) => n.status === 'accepted').length,
    rejected: negotiations.filter((n: any) => n.status === 'rejected').length,
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'accepted':
        return { icon: CheckCircle, color: 'bg-green-50 text-green-700 border-green-200', label: 'Accepted' };
      case 'rejected':
        return { icon: XCircle, color: 'bg-red-50 text-red-700 border-red-200', label: 'Rejected' };
      case 'pending':
      default:
        return { icon: Clock, color: 'bg-yellow-50 text-yellow-700 border-yellow-200', label: 'Pending' };
    }
  };

  const formatCurr = (amount: number) => {
    if (formatCurrency) return formatCurrency(amount);
    return `$${amount.toFixed(2)}`;
  };

  return (
    <BusinessPageLayout
      title="Commission Negotiations"
      description="Track and manage curator commission negotiations"
    >
      <div className="space-y-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4 sm:p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[#6B7280] text-sm">Total</p>
              <Target className="w-5 h-5 text-[#eb7825]" />
            </div>
            <p className="text-[#111827] text-2xl sm:text-3xl">{stats.total}</p>
          </Card>

          <Card className="p-4 sm:p-5 border border-yellow-200 bg-yellow-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-yellow-700 text-sm">Pending</p>
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
            <p className="text-yellow-900 text-2xl sm:text-3xl">{stats.pending}</p>
          </Card>

          <Card className="p-4 sm:p-5 border border-green-200 bg-green-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-green-600 text-sm">Accepted</p>
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-green-900 text-2xl sm:text-3xl">{stats.accepted}</p>
          </Card>

          <Card className="p-4 sm:p-5 border border-red-200 bg-red-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-red-600 text-sm">Rejected</p>
              <XCircle className="w-5 h-5 text-red-600" />
            </div>
            <p className="text-red-900 text-2xl sm:text-3xl">{stats.rejected}</p>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            className={`w-full sm:w-[160px] ${activeTab === 'invitations' ? 'bg-gray-100' : 'bg-gray-50'}`}
            onClick={() => setActiveTab('invitations')}
          >
            <Mail className="w-4 h-4 mr-2" />
            Invitations ({invitationsCount})
          </Button>
          <Button
            className={`w-full sm:w-[160px] ${activeTab === 'negotiations' ? 'bg-gray-100' : 'bg-gray-50'}`}
            onClick={() => setActiveTab('negotiations')}
          >
            <Filter className="w-4 h-4 mr-2" />
            Negotiations
          </Button>
        </div>

        {/* Invitations Tab */}
        {activeTab === 'invitations' && (
          <BusinessInvitations businessEmail={userEmail} />
        )}

        {/* Negotiations Tab */}
        {activeTab === 'negotiations' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  type="text"
                  placeholder="Search by curator name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={filterStatus} onValueChange={(value: any) => setFilterStatus(value)}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Negotiations List */}
            {filteredNegotiations.length === 0 ? (
              <Card className="p-12 text-center border border-gray-200">
                <Target className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-[#111827] mb-2">
                  {searchQuery || filterStatus !== 'all' ? 'No negotiations found' : 'No negotiations yet'}
                </h3>
                <p className="text-[#6B7280] max-w-md mx-auto">
                  {searchQuery || filterStatus !== 'all'
                    ? 'Try adjusting your filters or search query'
                    : 'Commission negotiations with curators will appear here'}
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredNegotiations.map((nego: any) => {
                  const statusInfo = getStatusInfo(nego.status);
                  const StatusIcon = statusInfo.icon;
                  
                  return (
                    <Card key={nego.id || nego.timestamp} className="p-4 sm:p-6 border border-gray-200 hover:shadow-md transition-shadow">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div className="flex-1 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="text-[#111827] mb-1">{nego.curatorName}</h3>
                              <p className="text-[#6B7280] text-sm">
                                {new Date(nego.timestamp).toLocaleDateString()} at{' '}
                                {new Date(nego.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                            <Badge className={`${statusInfo.color} border`}>
                              <StatusIcon className="w-3 h-3 mr-1" />
                              {statusInfo.label}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            <div>
                              <p className="text-[#6B7280] text-xs mb-1">Proposed By</p>
                              <p className="text-[#111827] text-sm">{nego.proposedBy === 'curator' ? 'Curator' : 'Business'}</p>
                            </div>
                            <div>
                              <p className="text-[#6B7280] text-xs mb-1">Previous Rate</p>
                              <p className="text-[#111827] text-sm">{nego.previousRate}%</p>
                            </div>
                            <div>
                              <p className="text-[#6B7280] text-xs mb-1">Proposed Rate</p>
                              <p className="text-[#eb7825]">{nego.proposedRate}%</p>
                            </div>
                          </div>

                          {nego.message && (
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                              <p className="text-[#6B7280] text-xs mb-1">Message</p>
                              <p className="text-[#111827] text-sm">{nego.message}</p>
                            </div>
                          )}

                          {nego.response && (
                            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                              <p className="text-blue-600 text-xs mb-1">Response</p>
                              <p className="text-[#111827] text-sm">{nego.response}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </BusinessPageLayout>
  );
}