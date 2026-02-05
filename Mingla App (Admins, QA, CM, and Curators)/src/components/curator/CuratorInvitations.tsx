import React, { useState, useMemo } from 'react';
import { 
  Mail, Search, CheckCircle, Clock, XCircle, Building2,
  AlertCircle, Filter, Eye, Percent
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
import CuratorPageLayout from './CuratorPageLayout';
import { toast } from 'sonner@2.0.3';

interface CuratorInvitationsProps {
  curatorId: string;
}

export default function CuratorInvitations({ curatorId }: CuratorInvitationsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');

  // Get invitations from localStorage
  const invitations = useMemo(() => {
    const allInvitations = JSON.parse(localStorage.getItem('business_invitations') || '[]');
    return allInvitations.filter((inv: any) => inv.curatorId === curatorId);
  }, [curatorId]);

  const filteredInvitations = invitations.filter((inv: any) => {
    const matchesSearch = 
      inv.businessName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.invitedEmail?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.invitedName?.toLowerCase().includes(searchQuery.toLowerCase());
    
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

  const handleCancelInvitation = (invitationId: string) => {
    if (!confirm('Are you sure you want to cancel this invitation?')) return;

    const allInvitations = JSON.parse(localStorage.getItem('business_invitations') || '[]');
    const updatedInvitations = allInvitations.filter((inv: any) => inv.id !== invitationId);
    localStorage.setItem('business_invitations', JSON.stringify(updatedInvitations));
    toast.success('Invitation cancelled');
    window.location.reload(); // Refresh to update the list
  };

  return (
    <CuratorPageLayout
      title="Business Invitations"
      description="Track invitations sent to business owners and their approval status"
    >
      <div className="space-y-6">
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
              placeholder="Search by business name or recipient..."
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
                : 'Create a business and invite business owners to start collaborating'}
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredInvitations.map((invitation: any) => {
              const statusInfo = getStatusInfo(invitation.status);
              const StatusIcon = statusInfo.icon;
              
              return (
                <Card key={invitation.id} className="p-4 sm:p-6 border border-gray-200 hover:shadow-md transition-shadow">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-6 h-6 text-white" />
                          </div>
                          <div>
                            <h3 className="text-[#111827] mb-1">{invitation.businessName}</h3>
                            <p className="text-[#6B7280] text-sm">
                              Sent {new Date(invitation.sentAt).toLocaleDateString()} at{' '}
                              {new Date(invitation.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                        <Badge className={`${statusInfo.color} border`}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {statusInfo.label}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pl-0 sm:pl-15">
                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                          <p className="text-[#6B7280] text-xs mb-1">Invited User</p>
                          <p className="text-[#111827] text-sm font-medium">{invitation.invitedName}</p>
                          <p className="text-[#6B7280] text-xs">{invitation.invitedEmail}</p>
                        </div>
                        <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                          <p className="text-[#6B7280] text-xs mb-1">Commission Rate</p>
                          <div className="flex items-center gap-1">
                            <Percent className="w-4 h-4 text-[#eb7825]" />
                            <p className="text-[#eb7825] font-bold">{invitation.commission}%</p>
                          </div>
                        </div>
                        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                          <p className="text-[#6B7280] text-xs mb-1">Status</p>
                          <p className="text-[#111827] text-sm">
                            {invitation.status === 'pending' && 'Awaiting Response'}
                            {invitation.status === 'accepted' && 'Approved - Can Create'}
                            {invitation.status === 'rejected' && 'Invitation Declined'}
                          </p>
                        </div>
                      </div>

                      {invitation.status === 'pending' && (
                        <div className="pl-0 sm:pl-15">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCancelInvitation(invitation.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Cancel Invitation
                          </Button>
                        </div>
                      )}

                      {invitation.responseMessage && (
                        <div className="pl-0 sm:pl-15">
                          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                            <p className="text-blue-600 text-xs mb-1">Response Message</p>
                            <p className="text-[#111827] text-sm">{invitation.responseMessage}</p>
                          </div>
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
    </CuratorPageLayout>
  );
}
