import React, { useState, useEffect } from 'react';
import { 
  DollarSign, TrendingUp, Download, Filter, Calendar, Search,
  CreditCard, ArrowUpRight, ArrowDownRight, Eye, FileText
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { motion } from 'motion/react';
import AdminPageLayout from './AdminPageLayout';

export default function AdminFinances({ userData }: any) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = () => {
    const purchases = JSON.parse(localStorage.getItem('userPurchases') || '[]');
    
    // Format purchases as transactions
    const txns = purchases.map((p: any) => ({
      id: p.id,
      type: 'purchase',
      user: p.userName,
      userId: p.userId,
      description: p.experienceName,
      amount: parseFloat(p.price?.replace(/[^0-9.]/g, '') || '0'),
      date: p.purchaseDate,
      status: 'completed',
      method: 'credit_card'
    }));

    setTransactions(txns);
  };

  const filteredTransactions = transactions.filter(txn => {
    if (searchQuery && !txn.description.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !txn.user.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (typeFilter !== 'all' && txn.type !== typeFilter) return false;
    if (dateFilter !== 'all') {
      const txnDate = new Date(txn.date);
      const now = new Date();
      const daysDiff = (now.getTime() - txnDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (dateFilter === '7d' && daysDiff > 7) return false;
      if (dateFilter === '30d' && daysDiff > 30) return false;
      if (dateFilter === '90d' && daysDiff > 90) return false;
    }
    return true;
  });

  const totalRevenue = filteredTransactions.reduce((sum, txn) => sum + txn.amount, 0);
  const avgTransaction = filteredTransactions.length > 0 
    ? totalRevenue / filteredTransactions.length 
    : 0;

  const stats = [
    { 
      label: 'Total Revenue', 
      value: `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      change: '+23%',
      trend: 'up',
      color: 'text-green-600'
    },
    { 
      label: 'Total Transactions', 
      value: filteredTransactions.length.toString(),
      change: '+18%',
      trend: 'up',
      color: 'text-blue-600'
    },
    { 
      label: 'Avg Transaction', 
      value: `$${avgTransaction.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      change: '+5%',
      trend: 'up',
      color: 'text-purple-600'
    },
    { 
      label: 'Platform Fee (15%)', 
      value: `$${(totalRevenue * 0.15).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      change: '+23%',
      trend: 'up',
      color: 'text-orange-600'
    }
  ];

  const handleExport = () => {
    const csv = filteredTransactions.map(txn => 
      `${txn.id},${txn.type},${txn.user},${txn.description},${txn.amount},${txn.date},${txn.status}`
    ).join('\n');
    
    const blob = new Blob([`ID,Type,User,Description,Amount,Date,Status\n${csv}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <AdminPageLayout
      title="Finances"
      description="Track all transactions and revenue across the platform"
      actions={
        <Button onClick={handleExport} variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <Card key={index} className="p-6 border border-gray-200">
            <p className="text-[#6B7280] text-sm">{stat.label}</p>
            <p className={`text-2xl mt-2 ${stat.color}`}>{stat.value}</p>
            <div className="flex items-center gap-1 mt-2">
              {stat.trend === 'up' ? (
                <ArrowUpRight className="w-4 h-4 text-green-600" />
              ) : (
                <ArrowDownRight className="w-4 h-4 text-red-600" />
              )}
              <span className={stat.trend === 'up' ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>
                {stat.change}
              </span>
            </div>
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
                placeholder="Search transactions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full lg:w-[180px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="purchase">Purchase</SelectItem>
              <SelectItem value="refund">Refund</SelectItem>
              <SelectItem value="payout">Payout</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-full lg:w-[180px]">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Transactions Table */}
      <Card className="border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase">Transaction ID</th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase">Description</th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs text-[#6B7280] uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-[#6B7280]">
                    No transactions found
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((txn) => (
                  <motion.tr
                    key={txn.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="hover:bg-gray-50"
                  >
                    <td className="px-6 py-4">
                      <code className="text-xs text-[#6B7280]">{txn.id}</code>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-[#111827]">{txn.user}</p>
                        <p className="text-[#6B7280] text-sm">{txn.userId}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[#111827]">
                      {txn.description}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[#111827]">
                        ${txn.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-[#6B7280] text-sm">
                      {new Date(txn.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="default" className="bg-green-500">
                        {txn.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="outline">
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="outline">
                          <FileText className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      </div>
    </AdminPageLayout>
  );
}
