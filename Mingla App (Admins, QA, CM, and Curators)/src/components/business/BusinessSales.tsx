import React, { useState } from 'react';
import { 
  TrendingUp, Calendar, CheckCircle, Clock, Download, Eye,
  Filter, Search, DollarSign, ShoppingCart, Users, QrCode
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import BusinessPageLayout from './BusinessPageLayout';

interface BusinessSalesProps {
  purchases: any[];
  formatCurrency: (amount: number) => string;
  onViewPurchase?: (purchase: any) => void;
}

export default function BusinessSales({
  purchases,
  formatCurrency,
  onViewPurchase
}: BusinessSalesProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'redeemed' | 'pending'>('all');
  const [dateRange, setDateRange] = useState('30');

  const filteredPurchases = purchases.filter(purchase => {
    const matchesSearch = 
      purchase.experienceName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      purchase.purchaserName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      purchase.orderId?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = 
      filterStatus === 'all' ||
      (filterStatus === 'redeemed' && purchase.redeemed) ||
      (filterStatus === 'pending' && !purchase.redeemed);
    
    return matchesSearch && matchesFilter;
  });

  const stats = {
    totalSales: purchases.length,
    redeemed: purchases.filter(p => p.redeemed).length,
    pending: purchases.filter(p => !p.redeemed).length,
    totalRevenue: purchases.reduce((sum, p) => sum + p.amount, 0),
    redeemedRevenue: purchases.filter(p => p.redeemed).reduce((sum, p) => sum + p.amount, 0),
    pendingRevenue: purchases.filter(p => !p.redeemed).reduce((sum, p) => sum + p.amount, 0),
  };

  const exportSales = () => {
    const csvData = filteredPurchases.map(p => ({
      'Order ID': p.orderId,
      'Date': new Date(p.purchaseDate).toLocaleDateString(),
      'Experience': p.experienceName,
      'Customer': p.purchaserName,
      'Amount': p.amount,
      'Status': p.redeemed ? 'Redeemed' : 'Pending',
      'Redeemed Date': p.redeemedAt ? new Date(p.redeemedAt).toLocaleDateString() : 'N/A'
    }));
    
    // Simple CSV export
    const headers = Object.keys(csvData[0] || {}).join(',');
    const rows = csvData.map(row => Object.values(row).join(','));
    const csv = [headers, ...rows].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <BusinessPageLayout
      title="Sales & Orders"
      description={`Track and manage your ${stats.totalSales} sale${stats.totalSales !== 1 ? 's' : ''}`}
      actions={
        <Button 
          onClick={exportSales}
          variant="outline"
          className="border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white"
        >
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Sales Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 sm:p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[#6B7280] text-sm">Total Sales</p>
              <ShoppingCart className="w-5 h-5 text-[#eb7825]" />
            </div>
            <p className="text-[#111827] text-2xl sm:text-3xl">{stats.totalSales}</p>
            <p className="text-[#6B7280] text-xs sm:text-sm mt-1">{formatCurrency(stats.totalRevenue)} revenue</p>
          </Card>

          <Card className="p-4 sm:p-5 border border-green-200 bg-green-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-green-600 text-sm">Redeemed</p>
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-green-900 text-2xl sm:text-3xl">{stats.redeemed}</p>
            <p className="text-green-600 text-xs sm:text-sm mt-1">{formatCurrency(stats.redeemedRevenue)}</p>
          </Card>

          <Card className="p-4 sm:p-5 border border-yellow-200 bg-yellow-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-yellow-700 text-sm">Pending</p>
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
            <p className="text-yellow-900 text-2xl sm:text-3xl">{stats.pending}</p>
            <p className="text-yellow-700 text-xs sm:text-sm mt-1">{formatCurrency(stats.pendingRevenue)}</p>
          </Card>

          <Card className="p-4 sm:p-5 border border-blue-200 bg-blue-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-blue-600 text-sm">Avg. Order Value</p>
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-blue-900 text-2xl sm:text-3xl">
              {formatCurrency(stats.totalSales > 0 ? stats.totalRevenue / stats.totalSales : 0)}
            </p>
            <p className="text-blue-600 text-xs sm:text-sm mt-1">Per transaction</p>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              type="text"
              placeholder="Search by order ID, customer, or experience..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-3">
            <Select value={filterStatus} onValueChange={(value: any) => setFilterStatus(value)}>
              <SelectTrigger className="w-full sm:w-[140px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Orders</SelectItem>
                <SelectItem value="redeemed">Redeemed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-full sm:w-[140px]">
                <Calendar className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Sales Table */}
        <Card className="border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider">Order</th>
                  <th className="px-4 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider">Experience</th>
                  <th className="px-4 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider hidden sm:table-cell">Customer</th>
                  <th className="px-4 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider hidden md:table-cell">Date</th>
                  <th className="px-4 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filteredPurchases.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-[#6B7280]">
                        {searchQuery || filterStatus !== 'all' 
                          ? 'No sales found matching your filters'
                          : 'No sales yet'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredPurchases.map((purchase) => (
                    <tr key={purchase.orderId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4">
                        <p className="text-[#111827] text-sm font-mono">#{purchase.orderId?.slice(0, 8)}</p>
                        <p className="text-[#6B7280] text-xs sm:hidden mt-1">
                          {new Date(purchase.purchaseDate).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-[#111827] text-sm line-clamp-2">{purchase.experienceName}</p>
                        <p className="text-[#6B7280] text-xs sm:hidden mt-1">{purchase.purchaserName}</p>
                      </td>
                      <td className="px-4 py-4 hidden sm:table-cell">
                        <p className="text-[#111827] text-sm">{purchase.purchaserName}</p>
                        <p className="text-[#6B7280] text-xs">{purchase.purchaserEmail}</p>
                      </td>
                      <td className="px-4 py-4 hidden md:table-cell">
                        <p className="text-[#111827] text-sm">
                          {new Date(purchase.purchaseDate).toLocaleDateString()}
                        </p>
                        <p className="text-[#6B7280] text-xs">
                          {new Date(purchase.purchaseDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-[#111827]">{formatCurrency(purchase.amount)}</p>
                      </td>
                      <td className="px-4 py-4">
                        {purchase.redeemed ? (
                          <Badge className="bg-green-50 text-green-700 border border-green-200">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Redeemed
                          </Badge>
                        ) : (
                          <Badge className="bg-yellow-50 text-yellow-700 border border-yellow-200">
                            <Clock className="w-3 h-3 mr-1" />
                            Pending
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onViewPurchase?.(purchase)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </BusinessPageLayout>
  );
}
