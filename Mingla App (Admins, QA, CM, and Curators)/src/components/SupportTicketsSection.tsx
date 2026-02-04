import React, { useState } from 'react';
import { Search, CheckCircle, Eye, MessageSquare, Bug, Lightbulb, AlertTriangle, User, Calendar, Paperclip, FileText, X, Download, Image as ImageIcon } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { motion, AnimatePresence } from 'motion/react';

interface SupportTicketsSectionProps {
  supportTickets?: any[];
  onUpdateTicketStatus?: (ticketId: string, newStatus: string) => void;
  isQAView?: boolean;
}

export default function SupportTicketsSection({ supportTickets: propTickets, onUpdateTicketStatus, isQAView = false }: SupportTicketsSectionProps) {
  // If in QA view, load tickets from localStorage
  const supportTickets = isQAView 
    ? JSON.parse(localStorage.getItem('supportTickets') || '[]')
    : (propTickets || []);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [showTicketDetailModal, setShowTicketDetailModal] = useState(false);
  const [ticketFilter, setTicketFilter] = useState<'all' | 'new' | 'in-progress' | 'resolved'>('all');
  const [ticketTypeFilter, setTicketTypeFilter] = useState<'all' | 'bug' | 'issue' | 'feature'>('all');
  const [ticketSearchQuery, setTicketSearchQuery] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const filteredTickets = supportTickets.filter(ticket => {
    const matchesSearch = 
      ticket.title.toLowerCase().includes(ticketSearchQuery.toLowerCase()) ||
      ticket.description.toLowerCase().includes(ticketSearchQuery.toLowerCase()) ||
      ticket.submittedBy.name.toLowerCase().includes(ticketSearchQuery.toLowerCase());
    const matchesStatusFilter = ticketFilter === 'all' || ticket.status === ticketFilter;
    const matchesTypeFilter = ticketTypeFilter === 'all' || ticket.type === ticketTypeFilter;
    return matchesSearch && matchesStatusFilter && matchesTypeFilter;
  });

  const getTicketTypeInfo = (type: string) => {
    switch (type) {
      case 'bug':
        return { icon: Bug, color: 'text-red-600', bg: 'bg-red-100', label: 'Bug', borderColor: 'border-red-200' };
      case 'issue':
        return { icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-100', label: 'Issue', borderColor: 'border-orange-200' };
      case 'feature':
        return { icon: Lightbulb, color: 'text-blue-600', bg: 'bg-blue-100', label: 'Feature', borderColor: 'border-blue-200' };
      default:
        return { icon: FileText, color: 'text-gray-600', bg: 'bg-gray-100', label: 'Unknown', borderColor: 'border-gray-200' };
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
        return { label: 'New', color: 'bg-blue-100 text-blue-700 border-blue-200' };
      case 'in-progress':
        return { label: 'In Progress', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
      case 'resolved':
        return { label: 'Resolved', color: 'bg-green-100 text-green-700 border-green-200' };
      default:
        return { label: status, color: 'bg-gray-100 text-gray-700 border-gray-200' };
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'critical':
        return { label: 'Critical', color: 'bg-red-100 text-red-700' };
      case 'high':
        return { label: 'High', color: 'bg-orange-100 text-orange-700' };
      case 'medium':
        return { label: 'Medium', color: 'bg-yellow-100 text-yellow-700' };
      case 'low':
        return { label: 'Low', color: 'bg-gray-100 text-gray-700' };
      default:
        return { label: priority, color: 'bg-gray-100 text-gray-700' };
    }
  };

  const handleViewTicketDetails = (ticket: any) => {
    setSelectedTicket(ticket);
    setShowTicketDetailModal(true);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-gray-900 mb-2">Support Tickets</h2>
              <p className="text-gray-500">Review and manage curator support requests</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Total:</span>
                <span className="px-3 py-1 bg-gray-100 text-gray-900 rounded-lg text-sm">
                  {supportTickets.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">New:</span>
                <span className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-sm">
                  {supportTickets.filter(t => t.status === 'new').length}
                </span>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={ticketSearchQuery}
                onChange={(e) => setTicketSearchQuery(e.target.value)}
                placeholder="Search tickets by title, description, or curator..."
                className="pl-10 rounded-xl"
              />
            </div>
            <select
              value={ticketFilter}
              onChange={(e) => setTicketFilter(e.target.value as any)}
              className="px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="new">New</option>
              <option value="in-progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </select>
            <select
              value={ticketTypeFilter}
              onChange={(e) => setTicketTypeFilter(e.target.value as any)}
              className="px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
            >
              <option value="all">All Types</option>
              <option value="bug">Bugs</option>
              <option value="issue">Issues</option>
              <option value="feature">Features</option>
            </select>
          </div>
        </div>

        {/* Tickets List */}
        {filteredTickets.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-gray-900 mb-2">No Support Tickets</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              {ticketSearchQuery || ticketFilter !== 'all' || ticketTypeFilter !== 'all'
                ? 'No tickets match your filters. Try adjusting your search criteria.'
                : 'No support tickets have been submitted yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTickets.map((ticket) => {
              const typeInfo = getTicketTypeInfo(ticket.type);
              const statusBadge = getStatusBadge(ticket.status);
              const priorityBadge = ticket.priority ? getPriorityBadge(ticket.priority) : null;
              const TypeIcon = typeInfo.icon;

              return (
                <motion.div
                  key={ticket.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-4">
                    {/* Type Icon */}
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${typeInfo.bg} flex-shrink-0`}>
                      <TypeIcon className={`w-6 h-6 ${typeInfo.color}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <h3 className="text-gray-900">{ticket.title}</h3>
                            <span className={`px-2 py-0.5 rounded-full text-xs border ${statusBadge.color}`}>
                              {statusBadge.label}
                            </span>
                            {priorityBadge && (
                              <span className={`px-2 py-0.5 rounded-full text-xs ${priorityBadge.color}`}>
                                {priorityBadge.label}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 line-clamp-2 mb-3">{ticket.description}</p>
                          <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                            <div className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {ticket.submittedBy.name}
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(ticket.createdAt).toLocaleDateString()}
                            </div>
                            <div className="flex items-center gap-1">
                              <span className={`w-2 h-2 rounded-full ${typeInfo.bg}`}></span>
                              {typeInfo.label}
                            </div>
                            {ticket.attachments && ticket.attachments.length > 0 && (
                              <div className="flex items-center gap-1">
                                <Paperclip className="w-3 h-3" />
                                {ticket.attachments.length} file{ticket.attachments.length > 1 ? 's' : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewTicketDetails(ticket)}
                          className="text-xs"
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          View Details
                        </Button>
                        {ticket.status === 'new' && (
                          <Button
                            size="sm"
                            onClick={() => onUpdateTicketStatus(ticket.id, 'in-progress')}
                            className="text-xs bg-gradient-to-r from-[#eb7825] to-[#d6691f]"
                          >
                            Start Working
                          </Button>
                        )}
                        {ticket.status === 'in-progress' && (
                          <Button
                            size="sm"
                            onClick={() => onUpdateTicketStatus(ticket.id, 'resolved')}
                            className="text-xs bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Mark Resolved
                          </Button>
                        )}
                        {ticket.status === 'resolved' && (
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Resolved
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ticket Detail Modal */}
      <AnimatePresence>
        {showTicketDetailModal && selectedTicket && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-white to-orange-50">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${getTicketTypeInfo(selectedTicket.type).bg}`}>
                      {React.createElement(getTicketTypeInfo(selectedTicket.type).icon, { 
                        className: `w-5 h-5 ${getTicketTypeInfo(selectedTicket.type).color}` 
                      })}
                    </div>
                    <h3 className="text-gray-900">Ticket #{selectedTicket.id}</h3>
                  </div>
                  <p className="text-sm text-gray-500">Submitted by {selectedTicket.submittedBy.name}</p>
                </div>
                <button
                  onClick={() => setShowTicketDetailModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="overflow-y-auto max-h-[calc(90vh-180px)] p-6 space-y-6">
                {/* Status & Priority */}
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`px-3 py-1.5 rounded-lg text-sm border ${getStatusBadge(selectedTicket.status).color}`}>
                    {getStatusBadge(selectedTicket.status).label}
                  </span>
                  {selectedTicket.priority && (
                    <span className={`px-3 py-1.5 rounded-lg text-sm ${getPriorityBadge(selectedTicket.priority).color}`}>
                      Priority: {getPriorityBadge(selectedTicket.priority).label}
                    </span>
                  )}
                  <span className={`px-3 py-1.5 rounded-lg text-sm border ${getTicketTypeInfo(selectedTicket.type).borderColor} ${getTicketTypeInfo(selectedTicket.type).bg} ${getTicketTypeInfo(selectedTicket.type).color}`}>
                    {getTicketTypeInfo(selectedTicket.type).label}
                  </span>
                </div>

                {/* Title */}
                <div>
                  <label className="text-sm text-gray-600 mb-2 block">Title</label>
                  <h4 className="text-gray-900">{selectedTicket.title}</h4>
                </div>

                {/* Description */}
                <div>
                  <label className="text-sm text-gray-600 mb-2 block">Description</label>
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <p className="text-gray-900 whitespace-pre-wrap">{selectedTicket.description}</p>
                  </div>
                </div>

                {/* Submitter Info */}
                <div>
                  <label className="text-sm text-gray-600 mb-2 block">Submitter Information</label>
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-2">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-900">{selectedTicket.submittedBy.name}</span>
                    </div>
                    <div className="text-sm text-gray-600">{selectedTicket.submittedBy.email}</div>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Calendar className="w-4 h-4" />
                      Submitted on {new Date(selectedTicket.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Attachments */}
                {selectedTicket.attachments && selectedTicket.attachments.length > 0 && (
                  <div>
                    <label className="text-sm text-gray-600 mb-2 block">Attachments ({selectedTicket.attachments.length})</label>
                    <div className="space-y-2">
                      {selectedTicket.attachments.map((attachment: any, index: number) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                        >
                          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center border border-gray-200">
                            {attachment.type.startsWith('image/') ? (
                              <ImageIcon className="w-5 h-5 text-blue-600" />
                            ) : (
                              <FileText className="w-5 h-5 text-gray-600" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900 truncate">{attachment.name}</p>
                            <p className="text-xs text-gray-500">{(attachment.size / 1024).toFixed(1)} KB</p>
                          </div>
                          <a
                            href={attachment.url}
                            download={attachment.name}
                            className="p-2 text-[#eb7825] hover:bg-orange-50 rounded-lg transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Internal Notes */}
                <div>
                  <label className="text-sm text-gray-600 mb-2 block">Internal Notes (QA Team Only)</label>
                  <Textarea
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    placeholder="Add notes about this ticket for the team..."
                    rows={4}
                    className="rounded-xl resize-none"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setShowTicketDetailModal(false)}
                >
                  Close
                </Button>
                {selectedTicket.status === 'new' && (
                  <Button
                    onClick={() => {
                      onUpdateTicketStatus(selectedTicket.id, 'in-progress');
                      setShowTicketDetailModal(false);
                    }}
                    className="bg-gradient-to-r from-[#eb7825] to-[#d6691f]"
                  >
                    Start Working
                  </Button>
                )}
                {selectedTicket.status === 'in-progress' && (
                  <Button
                    onClick={() => {
                      onUpdateTicketStatus(selectedTicket.id, 'resolved');
                      setShowTicketDetailModal(false);
                    }}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Mark as Resolved
                  </Button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
