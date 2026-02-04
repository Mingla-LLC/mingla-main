import React, { useState } from 'react';
import { Plus, Mail } from 'lucide-react';
import { Button } from '../ui/button';
import CuratorPageLayout from './CuratorPageLayout';
import MyBusinessesSection from '../MyBusinessesSection';
import CuratorInvitations from './CuratorInvitations';

interface CuratorMyBusinessesProps {
  businesses: any[];
  onAddBusiness?: (business: any) => void;
  onUpdateBusiness?: (businessId: string, data: any) => void;
  onDeleteBusiness?: (businessId: string) => void;
  onViewBusiness?: (business: any) => void;
  onOpenCreateModal: () => void;
}

export default function CuratorMyBusinesses({
  businesses,
  onAddBusiness,
  onUpdateBusiness,
  onDeleteBusiness,
  onViewBusiness,
  onOpenCreateModal
}: CuratorMyBusinessesProps) {
  const [activeTab, setActiveTab] = useState<'businesses' | 'invitations'>('businesses');
  
  // Get current user
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const curatorId = currentUser.id || currentUser.email || 'curator-id';

  // Get invitations count
  const invitationsCount = (() => {
    const allInvitations = JSON.parse(localStorage.getItem('business_invitations') || '[]');
    return allInvitations.filter((inv: any) => inv.curatorId === curatorId).length;
  })();

  return (
    <CuratorPageLayout
      title="My Businesses"
      description="Manage businesses and track collaboration invitations"
      actions={
        activeTab === 'businesses' ? (
          <Button 
            onClick={onOpenCreateModal}
            className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Business
          </Button>
        ) : null
      }
    >
      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <div className="flex gap-6">
          <button
            onClick={() => setActiveTab('businesses')}
            className={`pb-3 px-1 border-b-2 transition-colors ${
              activeTab === 'businesses'
                ? 'border-[#eb7825] text-[#eb7825]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="font-medium">Businesses ({businesses.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('invitations')}
            className={`pb-3 px-1 border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'invitations'
                ? 'border-[#eb7825] text-[#eb7825]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Mail className="w-4 h-4" />
            <span className="font-medium">Invitations ({invitationsCount})</span>
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'businesses' ? (
        <MyBusinessesSection
          businesses={businesses}
          onAddBusiness={onAddBusiness}
          onUpdateBusiness={onUpdateBusiness}
          onDeleteBusiness={onDeleteBusiness}
          onViewBusiness={onViewBusiness}
        />
      ) : (
        <CuratorInvitations curatorId={curatorId} />
      )}
    </CuratorPageLayout>
  );
}