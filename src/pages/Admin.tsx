import React from 'react';
import { AdminPanel } from '@/components/AdminPanel';

const Admin: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Manage user roles and content permissions
          </p>
        </div>
        <AdminPanel />
      </div>
    </div>
  );
};

export default Admin;