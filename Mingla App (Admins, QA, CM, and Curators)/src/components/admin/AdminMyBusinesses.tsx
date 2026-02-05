import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { toast } from 'sonner@2.0.3';
import AdminPageLayout from './AdminPageLayout';
import MyBusinessesSection from '../MyBusinessesSection';
import CreateBusinessModal from '../CreateBusinessModal';

interface AdminMyBusinessesProps {
  userData?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

export default function AdminMyBusinesses({ userData }: AdminMyBusinessesProps) {
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [allExperiences, setAllExperiences] = useState<any[]>([]);
  const [showCreateBusinessModal, setShowCreateBusinessModal] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<any>(null);
  const [accountPreferences, setAccountPreferences] = useState<any>(null);

  // Load data from localStorage
  useEffect(() => {
    loadBusinesses();
    loadExperiences();
    loadAccountPreferences();
  }, [userData]);

  const loadBusinesses = () => {
    const allBusinesses = JSON.parse(localStorage.getItem('businesses') || '[]');
    // Filter businesses created by this admin
    const adminBusinesses = allBusinesses.filter((b: any) => b.curatorId === userData?.id);
    setBusinesses(adminBusinesses);
  };

  const loadExperiences = () => {
    const experiences = JSON.parse(localStorage.getItem('experienceCards') || '[]');
    setAllExperiences(experiences);
  };

  const loadAccountPreferences = () => {
    const prefs = JSON.parse(localStorage.getItem('accountPreferences') || '{}');
    setAccountPreferences(prefs);
  };

  const handleCreateBusiness = (businessData: any) => {
    const allBusinesses = JSON.parse(localStorage.getItem('businesses') || '[]');
    
    if (editingBusiness) {
      // Update existing business
      const updatedBusinesses = allBusinesses.map((b: any) => 
        b.id === editingBusiness.id ? { ...b, ...businessData, updatedAt: new Date().toISOString() } : b
      );
      localStorage.setItem('businesses', JSON.stringify(updatedBusinesses));
      toast.success('Business updated successfully');
    } else {
      // Create new business
      const newBusiness = {
        ...businessData,
        id: `business-${Date.now()}`,
        curatorId: userData?.id,
        curatorName: userData?.name,
        createdAt: new Date().toISOString(),
        commissionStatus: 'approved', // Admins can auto-approve
        businessUsers: [] // Empty array for business users
      };
      
      allBusinesses.push(newBusiness);
      localStorage.setItem('businesses', JSON.stringify(allBusinesses));
      toast.success('Business created successfully');
    }
    
    setShowCreateBusinessModal(false);
    setEditingBusiness(null);
    loadBusinesses();
  };

  const handleDeleteBusiness = (businessId: string) => {
    if (!confirm('Are you sure you want to remove this business? This action cannot be undone.')) {
      return;
    }

    const allBusinesses = JSON.parse(localStorage.getItem('businesses') || '[]');
    const updatedBusinesses = allBusinesses.filter((b: any) => b.id !== businessId);
    localStorage.setItem('businesses', JSON.stringify(updatedBusinesses));
    
    toast.success('Business removed successfully');
    loadBusinesses();
  };

  return (
    <>
      <AdminPageLayout
        title="My Businesses"
        description="Manage businesses and create experiences on their behalf"
        actions={
          <Button 
            onClick={() => {
              setEditingBusiness(null);
              setShowCreateBusinessModal(true);
            }}
            className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Business
          </Button>
        }
      >
        <MyBusinessesSection
          businesses={businesses}
          onCreateBusiness={() => {
            setEditingBusiness(null);
            setShowCreateBusinessModal(true);
          }}
          onEditBusiness={(business) => {
            setEditingBusiness(business);
            setShowCreateBusinessModal(true);
          }}
          onViewBusiness={(business) => {
            // Can be implemented if needed
          }}
          onDeleteBusiness={handleDeleteBusiness}
          accountPreferences={accountPreferences}
          allExperiences={allExperiences}
        />
      </AdminPageLayout>

      {/* Create/Edit Business Modal */}
      {showCreateBusinessModal && (
        <CreateBusinessModal
          isOpen={showCreateBusinessModal}
          onClose={() => {
            setShowCreateBusinessModal(false);
            setEditingBusiness(null);
          }}
          onCreateBusiness={handleCreateBusiness}
          curatorId={userData?.id || ''}
          editMode={!!editingBusiness}
          existingBusiness={editingBusiness}
        />
      )}
    </>
  );
}
