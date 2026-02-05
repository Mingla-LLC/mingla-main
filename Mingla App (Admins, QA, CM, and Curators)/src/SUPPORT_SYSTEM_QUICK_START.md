# Support Ticket System - Quick Start Guide

## Test the System in 5 Minutes

### Step 1: Submit a Ticket as Curator

1. **Sign in as a Curator**
   - Go to Sign In page
   - Select "Curator" user type
   - Sign in with any credentials

2. **Navigate to Help Section**
   - Click on the Help tab in the Curator Dashboard
   - Scroll down to "Contact Support" section

3. **Submit a Bug Report**
   - Click "Report a Bug"
   - Select the Bug type (already pre-selected)
   - Click "Continue"
   - Fill in the form:
     - **Title**: "Test bug report with file attachment"
     - **Description**: "This is a test submission to verify the file upload system works correctly."
     - **Priority**: Select "High"
   - Click the upload area to add a screenshot
   - Add any PNG, JPG, or PDF file (under 10MB)
   - Review the file preview
   - Click "Submit Ticket"
   - Note the Ticket ID shown (e.g., #ABC123XY)

### Step 2: Review the Ticket as QA Manager

1. **Sign Out and Sign In as QA Manager**
   - Sign out from Curator Dashboard
   - Return to Sign In page
   - Select "QA Manager" user type
   - Sign in with any credentials

2. **Access Support Tickets**
   - You'll see a badge on the "Support Tickets" tab showing new ticket count
   - Click on "Support Tickets" tab

3. **View Your Submitted Ticket**
   - You should see your ticket in the list
   - Notice the "New" status badge and "High" priority badge
   - See the paperclip icon showing 1 file attachment

4. **Review Ticket Details**
   - Click "View Details" button
   - Review all ticket information
   - Click on the attachment to download the file you uploaded
   - Add an internal note (optional)
   - Click "Start Working" to change status to "In Progress"
   - Close the modal

5. **Manage Ticket Status**
   - The ticket now shows "In Progress" status
   - Click "Mark Resolved" to complete the ticket
   - The ticket will update to "Resolved" status

### Step 3: Test Filtering and Search

1. **Try Different Filters**
   - Use the status dropdown to filter tickets
   - Use the type dropdown to filter by Bug/Issue/Feature
   - Use the search box to search by title or description

2. **View Demo Tickets**
   - The system includes 5 demo tickets automatically
   - Try different filter combinations to see various tickets
   - Notice different priority levels and ticket types

## Key Features to Test

### File Upload Testing
✓ Upload a PNG screenshot  
✓ Upload a JPG image  
✓ Upload a PDF document  
✓ Upload multiple files (2-3 files)  
✓ Remove a file before submitting  
✓ Try uploading a file > 10MB (should fail gracefully)  
✓ Try uploading an unsupported file type like .docx (should fail)  

### Ticket Submission Testing
✓ Submit a Bug report with High priority  
✓ Submit an Issue report with Medium priority  
✓ Submit a Feature request (no priority)  
✓ Test form validation (try submitting empty fields)  
✓ Verify ticket ID generation  

### QA Manager Testing
✓ View ticket list with all tickets  
✓ Filter by status (New, In Progress, Resolved)  
✓ Filter by type (Bug, Issue, Feature)  
✓ Search tickets by keyword  
✓ Update ticket status (New → In Progress → Resolved)  
✓ View ticket details modal  
✓ Download file attachments  
✓ Add internal QA notes  

## Demo Tickets Overview

The system includes 5 pre-loaded demo tickets:

1. **TKT001A** - Bug (High Priority, New)
   - Cards not loading on dashboard
   - No attachments
   - Submitted 2 hours ago

2. **TKT002B** - Issue (Medium Priority, In Progress)
   - Unable to upload business logo
   - No attachments
   - Submitted 1 day ago

3. **TKT003C** - Feature (Low Priority, New)
   - Add bulk edit feature for cards
   - No attachments
   - Submitted 6 hours ago

4. **TKT004D** - Bug (Critical Priority, New)
   - Commission calculator showing incorrect percentages
   - No attachments
   - Submitted 30 minutes ago

5. **TKT005E** - Issue (High Priority, Resolved)
   - QR code validation not working
   - No attachments
   - Submitted 3 days ago, resolved 2 days ago

## Common Testing Scenarios

### Scenario 1: Urgent Bug Report
```
Type: Bug
Title: Dashboard crashes when clicking profile
Priority: Critical
Description: Steps to reproduce...
Attachments: error-screenshot.png, console-log.pdf
```

### Scenario 2: Feature Request
```
Type: Feature
Title: Dark mode support
Priority: N/A (features don't have priority)
Description: User preference for dark theme...
Attachments: mockup.png, reference-design.jpg
```

### Scenario 3: General Issue
```
Type: Issue  
Title: Email notifications not being received
Priority: Medium
Description: Haven't received any email notifications...
Attachments: email-settings-screenshot.png
```

## Keyboard Shortcuts & Tips

- **Search**: Start typing in the search box to filter instantly
- **ESC**: Close any modal
- **Click outside modal**: Also closes the modal
- **Real-time updates**: New tickets appear automatically (5-second polling)

## Data Persistence

- All tickets are stored in localStorage (for demo)
- Tickets persist across page refreshes
- Data is shared between Curator and QA Manager views
- To reset all tickets, open browser console and run:
  ```javascript
  localStorage.removeItem('supportTickets');
  ```

## Visual Indicators

- **🔴 Red badge**: New tickets count on Support Tickets tab
- **🔵 Blue badge**: "New" status on tickets
- **🟡 Yellow badge**: "In Progress" status
- **🟢 Green badge**: "Resolved" status
- **📎 Paperclip icon**: Indicates file attachments
- **Priority badges**: Critical (red), High (orange), Medium (yellow), Low (gray)

## Next Steps

After testing the demo:

1. **Review the documentation**:
   - This Quick Start Guide (complete system overview)
   - `/components/SupportTicketsSection.tsx` - Component implementation
   - Supabase integration guide
   - Database schema
   - Production deployment steps

2. **Customize the system**:
   - Adjust file size limits
   - Add more ticket types
   - Customize priority levels
   - Add assignment feature
   - Add email notifications

3. **Integrate with Supabase**:
   - See `DATABASE_COMPLETE_SCHEMA.md` for database tables
   - Set up `support_tickets` table
   - Configure storage bucket for attachments
   - Update code for real database calls

## Troubleshooting

**Tickets not appearing?**
- Check browser console for errors
- Verify localStorage is enabled
- Try refreshing the page
- Clear localStorage and re-seed demo tickets

**Files not uploading?**
- Check file size (must be < 10MB)
- Verify file type (PNG, JPG, PDF only)
- Check browser console for validation errors

**QA Manager not showing tickets?**
- Wait 5 seconds for polling to refresh
- Manually refresh the page
- Check if tickets exist in localStorage:
  ```javascript
  console.log(localStorage.getItem('supportTickets'));
  ```

## Support

For questions or issues with the support ticket system:
- Review this Quick Start Guide
- Check `ARCHITECTURE.md` for support system overview
- Review component files for inline comments
- Test with the demo tickets first
- Verify localStorage functionality in your browser

---

**System Status**: ✅ Production Ready (with localStorage)  
**Supabase Integration**: 📋 Migration guide available  
**Last Updated**: October 19, 2025
