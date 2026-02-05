import React, { useState, useMemo } from 'react';
import { 
  Mail, Search, CheckCircle, Clock, XCircle, User,
  AlertCircle, Filter, Percent, Building2
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
import { toast } from 'sonner@2.0.3';

interface BusinessInvitationsProps {
  businessEmail: string;
  businessId?: string;
}

export default function BusinessInvitations({ businessEmail, businessId }: BusinessInvitationsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');
  const [selectedInvitation, setSelectedInvitation] = useState<any>(null);
  const [showResponseModal, setShowResponseModal] = useState(false);

  // Get invitations addressed to this business user's email
  const invitations = useMemo(() => {
    const allInvitations = JSON.parse(localStorage.getItem('business_invitations') || '[]');
    return allInvitations.filter((inv: any) => 
      inv.invitedEmail?.toLowerCase() === businessEmail?.toLowerCase()
    );
  }, [businessEmail]);

  const filteredInvitations = invitations.filter((inv: any) => {
    const matchesSearch = 
      inv.businessName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.curatorName?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = 
      filterStatus === 'all' ||
      inv.status === filterStatus;
    
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: invitations.length,
    pending: invitations.filter((inv: any) => inv.status === 'pending').length,
    accepted: invitations.filter((inv: any) => inv.status === 'accepted').length,
    rejected: invitations.filter((inv: any) => inv.status === 'rejected').length,
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

  const handleAcceptInvitation = (invitation: any) => {
    const allInvitations = JSON.parse(localStorage.getItem('business_invitations') || '[]');
    const updatedInvitations = allInvitations.map((inv: any) => 
      inv.id === invitation.id 
        ? { ...inv, status: 'accepted', respondedAt: new Date().toISOString() }
        : inv
    );
    localStorage.setItem('business_invitations', JSON.stringify(updatedInvitations));

    // Update business status to active
    const allBusinesses = JSON.parse(localStorage.getItem('businesses') || '[]');
    const updatedBusinesses = allBusinesses.map((bus: any) =>
      bus.id === invitation.businessId
        ? { ...bus, status: 'active', commissionStatus: 'approved' }
        : bus
    );
    localStorage.setItem('businesses', JSON.stringify(updatedBusinesses));

    toast.success(`Collaboration with ${invitation.curatorName} accepted!`);
    window.location.reload();
  };

  const handleRejectInvitation = (invitation: any, message?: string) => {
    const allInvitations = JSON.parse(localStorage.getItem('business_invitations') || '[]');
    const updatedInvitations = allInvitations.map((inv: any) => 
      inv.id === invitation.id 
        ? { 
            ...inv, 
            status: 'rejected', 
            respondedAt: new Date().toISOString(),
            responseMessage: message || 'Invitation declined'
          }
        : inv
    );
    localStorage.setItem('business_invitations', JSON.stringify(updatedInvitations));

    toast.success('Invitation declined');
    window.location.reload();
  };

  const getPlatformCommission = () => {
    return Number(localStorage.getItem('platform_commission') || '10');
  };

  return (
    <BusinessPageLayout
      title="Curator Invitations"
      description="Review and respond to collaboration invitations from curators"
    >
      <div className="space-y-6">
        {/* Info Banner */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-blue-900 mb-1">
                How Invitations Work
              </h4>
              <p className="text-sm text-blue-700">
                Curators create your business profile and invite you to collaborate. You must accept their invitation and approve their commission rate before they can create experiences for your business.
              </p>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4 sm:p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[#6B7280] text-sm">Total</p>
              <Mail className="w-5 h-5 text-[#eb7825]" />
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

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              type="text"
              placeholder="Search by business or curator..."
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

        {/* Invitations List */}
        {filteredInvitations.length === 0 ? (
          <Card className="p-12 text-center border border-gray-200">
            <Mail className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-[#111827] mb-2">
              {searchQuery || filterStatus !== 'all' ? 'No invitations found' : 'No invitations yet'}
            </h3>
            <p className="text-[#6B7280] max-w-md mx-auto">
              {searchQuery || filterStatus !== 'all'
                ? 'Try adjusting your filters or search query'
                : 'Curator collaboration invitations will appear here'}
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredInvitations.map((invitation: any) => {
              const statusInfo = getStatusInfo(invitation.status);
              const StatusIcon = statusInfo.icon;
              const platformCommission = getPlatformCommission();
              const businessShare = 100 - platformCommission - invitation.commission;
              
              return (
                <Card key={invitation.id} className="p-4 sm:p-6 border border-gray-200 hover:shadow-md transition-shadow">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h3 className="text-[#111827] mb-1">{invitation.businessName}</h3>
                          <p className="text-[#6B7280] text-sm">
                            Invited by <span className="font-medium text-[#eb7825]">{invitation.curatorName}</span>
                          </p>
                          <p className="text-[#6B7280] text-xs mt-1">
                            {new Date(invitation.sentAt).toLocaleDateString()} at{' '}
                            {new Date(invitation.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                      <Badge className={`${statusInfo.color} border`}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusInfo.label}
                      </Badge>
                    </div>

                    {/* Commission Breakdown */}
                    <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-xl p-4 border border-orange-200">
                      <div className="flex items-start gap-3">
                        <Percent className="w-5 h-5 text-[#eb7825] flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <h4 className="text-sm font-medium text-gray-900 mb-3">
                            Proposed Commission Structure
                          </h4>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Mingla Platform Fee</span>
                              <span className="font-medium text-gray-900">{platformCommission}%</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Curator Commission</span>
                              <span className="font-medium text-[#eb7825]">{invitation.commission}%</span>
                            </div>
                            <div className="flex justify-between text-sm pt-2 border-t border-orange-200">
                              <span className="text-gray-900 font-medium">You Receive</span>
                              <span className="font-bold text-green-700">{businessShare}%</span>
                            </div>
                            <div className="pt-2 mt-2 border-t border-orange-200">
                              <p className="text-xs text-gray-600">
                                Example: On a $100 sale, you receive ${businessShare.toFixed(2)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    {invitation.status === 'pending' && (
                      <div className="flex flex-col sm:flex-row gap-3">
                        <Button
                          onClick={() => handleAcceptInvitation(invitation)}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Accept & Approve Commission
                        </Button>
                        <Button
                          onClick={() => handleRejectInvitation(invitation)}
                          variant="outline"
                          className="flex-1 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          Decline Invitation
                        </Button>
                      </div>
                    )}

                    {invitation.status === 'accepted' && (
                      <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                        <p className="text-sm text-green-700">
                          ✓ You accepted this collaboration on {new Date(invitation.respondedAt).toLocaleDateString()}. 
                          The curator can now create experiences for your business.
                        </p>
                      </div>
                    )}

                    {invitation.status === 'rejected' && invitation.responseMessage && (
                      <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                        <p className="text-xs text-red-600 mb-1">Your Response</p>
                        <p className="text-sm text-red-900">{invitation.responseMessage}</p>
                      </div>
                    )}
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
