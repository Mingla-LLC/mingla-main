import React, { useState, useEffect } from 'react';
import { 
  MessageCircle, Search, Filter, CheckCircle, Clock, XCircle,
  AlertCircle, User, Calendar, Send, Plus
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner@2.0.3';
import AdminPageLayout from './AdminPageLayout';

export default function AdminSupport({ userData }: any) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [response, setResponse] = useState('');

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = () => {
    const supportTickets = JSON.parse(localStorage.getItem('supportTickets') || '[]');
    setTickets(supportTickets);
  };

  const filteredTickets = tickets.filter(ticket => {
    if (searchQuery && !ticket.title?.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !ticket.description?.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (statusFilter !== 'all' && ticket.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && ticket.priority !== priorityFilter) return false;
    return true;
  });

  const handleUpdateStatus = (ticketId: string, newStatus: string) => {
    const updated = tickets.map(t => 
      t.id === ticketId ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t
    );
    localStorage.setItem('supportTickets', JSON.stringify(updated));
    setTickets(updated);
    toast.success(`Ticket ${newStatus}`);
  };

  const handleSendResponse = () => {
    if (!response.trim()) {
      toast.error('Please enter a response');
      return;
    }

    const updated = tickets.map(t => {
      if (t.id === selectedTicket.id) {
        const replies = t.replies || [];
        return {
          ...t,
          replies: [...replies, {
            id: `reply-${Date.now()}`,
            message: response,
            sender: userData?.name || 'Admin',
            senderRole: 'admin',
            timestamp: new Date().toISOString()
          }],
          status: 'in-progress',
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    });

    localStorage.setItem('supportTickets', JSON.stringify(updated));
    setTickets(updated);
    setSelectedTicket(updated.find(t => t.id === selectedTicket.id));
    setResponse('');
    toast.success('Response sent');
  };

  const getStatusBadge = (status: string) => {
    const config: any = {
      open: { label: 'Open', className: 'bg-blue-100 text-blue-700' },
      'in-progress': { label: 'In Progress', className: 'bg-yellow-100 text-yellow-700' },
      resolved: { label: 'Resolved', className: 'bg-green-100 text-green-700' },
      closed: { label: 'Closed', className: 'bg-gray-100 text-gray-700' }
    };
    return config[status] || config.open;
  };

  const getPriorityBadge = (priority: string) => {
    const config: any = {
      low: { label: 'Low', className: 'bg-gray-100 text-gray-700' },
      medium: { label: 'Medium', className: 'bg-blue-100 text-blue-700' },
      high: { label: 'High', className: 'bg-orange-100 text-orange-700' },
      urgent: { label: 'Urgent', className: 'bg-red-100 text-red-700' }
    };
    return config[priority] || config.medium;
  };

  const stats = [
    { label: 'Total Tickets', value: tickets.length, color: 'text-blue-600' },
    { label: 'Open', value: tickets.filter(t => t.status === 'open').length, color: 'text-orange-600' },
    { label: 'In Progress', value: tickets.filter(t => t.status === 'in-progress').length, color: 'text-yellow-600' },
    { label: 'Resolved', value: tickets.filter(t => t.status === 'resolved').length, color: 'text-green-600' }
  ];

  return (
    <AdminPageLayout
      title="Support"
      description="Manage customer support tickets and inquiries"
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
                placeholder="Search tickets..."
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
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-full lg:w-[180px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Tickets List and Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tickets List */}
        <div className="lg:col-span-1 space-y-3">
          <AnimatePresence>
            {filteredTickets.length === 0 ? (
              <Card className="p-8 border border-gray-200 text-center">
                <p className="text-[#6B7280]">No tickets found</p>
              </Card>
            ) : (
              filteredTickets.map(ticket => {
                const statusBadge = getStatusBadge(ticket.status);
                const priorityBadge = getPriorityBadge(ticket.priority);
                
                return (
                  <motion.div
                    key={ticket.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <Card 
                      className={`p-4 border cursor-pointer transition-all ${
                        selectedTicket?.id === ticket.id
                          ? 'border-[#eb7825] bg-orange-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <Badge className={statusBadge.className}>
                          {statusBadge.label}
                        </Badge>
                        <Badge className={priorityBadge.className}>
                          {priorityBadge.label}
                        </Badge>
                      </div>
                      <h4 className="text-[#111827] line-clamp-2">{ticket.title}</h4>
                      <p className="text-[#6B7280] text-sm mt-2 line-clamp-2">{ticket.description}</p>
                      <div className="flex items-center gap-2 mt-3 text-xs text-[#6B7280]">
                        <User className="w-3 h-3" />
                        <span>{ticket.userName}</span>
                        <span>•</span>
                        <Calendar className="w-3 h-3" />
                        <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
                      </div>
                    </Card>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>

        {/* Ticket Detail */}
        <div className="lg:col-span-2">
          {!selectedTicket ? (
            <Card className="p-12 border border-gray-200 text-center h-full flex items-center justify-center">
              <div>
                <MessageCircle className="w-12 h-12 text-[#6B7280] mx-auto mb-4" />
                <p className="text-[#6B7280]">Select a ticket to view details</p>
              </div>
            </Card>
          ) : (
            <Card className="p-6 border border-gray-200">
              {/* Ticket Header */}
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-[#111827]">{selectedTicket.title}</h2>
                  <div className="flex items-center gap-3 mt-2">
                    <Badge className={getStatusBadge(selectedTicket.status).className}>
                      {getStatusBadge(selectedTicket.status).label}
                    </Badge>
                    <Badge className={getPriorityBadge(selectedTicket.priority).className}>
                      {getPriorityBadge(selectedTicket.priority).label}
                    </Badge>
                  </div>
                </div>
                <Select 
                  value={selectedTicket.status} 
                  onValueChange={(v) => handleUpdateStatus(selectedTicket.id, v)}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Ticket Info */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-[#6B7280]">User</p>
                    <p className="text-[#111827] mt-1">{selectedTicket.userName}</p>
                  </div>
                  <div>
                    <p className="text-[#6B7280]">Created</p>
                    <p className="text-[#111827] mt-1">
                      {new Date(selectedTicket.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#6B7280]">Category</p>
                    <p className="text-[#111827] mt-1">{selectedTicket.category}</p>
                  </div>
                  <div>
                    <p className="text-[#6B7280]">Ticket ID</p>
                    <p className="text-[#111827] mt-1 text-xs font-mono">{selectedTicket.id}</p>
                  </div>
                </div>
              </div>

              {/* Original Message */}
              <div className="mb-6">
                <h3 className="text-[#111827] mb-2">Original Message</h3>
                <p className="text-[#6B7280]">{selectedTicket.description}</p>
              </div>

              {/* Replies */}
              {selectedTicket.replies && selectedTicket.replies.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-[#111827] mb-3">Conversation</h3>
                  <div className="space-y-3">
                    {selectedTicket.replies.map((reply: any) => (
                      <div 
                        key={reply.id}
                        className={`p-4 rounded-lg ${
                          reply.senderRole === 'admin' 
                            ? 'bg-blue-50 ml-8' 
                            : 'bg-gray-50 mr-8'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[#111827]">{reply.sender}</p>
                          <p className="text-[#6B7280] text-xs">
                            {new Date(reply.timestamp).toLocaleString()}
                          </p>
                        </div>
                        <p className="text-[#6B7280] text-sm">{reply.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Response Form */}
              <div>
                <h3 className="text-[#111827] mb-3">Send Response</h3>
                <Textarea
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder="Type your response..."
                  rows={4}
                  className="mb-3"
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    onClick={handleSendResponse}
                    className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send Response
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
      </div>
    </AdminPageLayout>
  );
}
