import { useState, useEffect, useCallback, useRef } from "react";
import {
  Users, UserCheck, UserX, Shield, Activity, Trash2, Edit3, Eye,
  ChevronLeft, Save, Ban, X, AlertTriangle, Clock, Globe, Mail,
  Phone, Hash, Heart, LayoutDashboard, Zap, Bookmark, UserPlus,
  UserMinus, MessageSquare, Calendar, Star, MousePointerClick,
  Flag, MapPin, VolumeX, Link2, Download,
} from "lucide-react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabase";
import { StatCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Toggle } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Tabs } from "../components/ui/Tabs";
import { Avatar } from "../components/ui/Avatar";
import { Spinner } from "../components/ui/Spinner";
import { ListItemSkeleton, StatCardSkeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { timeAgo, formatDate, formatDateTime, truncate, escapeLike } from "../lib/formatters";
import { logAdminAction } from "../lib/auditLog";
import { exportCsv } from "../lib/exportCsv";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

// ─── Main Component ───────────────────────────────────────────────────────────

export function UserManagementPage() {
  const { addToast } = useToast();
  const { session } = useAuth();

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // View state
  const [view, setView] = useState("list"); // "list" | "detail" | "impersonate"
  const [selectedUserId, setSelectedUserId] = useState(null);

  // List state
  const [users, setUsers] = useState([]);
  const [userCount, setUserCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState({
    onboarding: "all",
    status: "all",
    country: "all",
    dateFrom: "",
    dateTo: "",
  });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  // Country options
  const [countries, setCountries] = useState([]);

  // Sort
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkActioning, setBulkActioning] = useState(false);
  const [betaTogglingIds, setBetaTogglingIds] = useState(new Set());

  // Stats state
  const [stats, setStats] = useState({ total: 0, active: 0, banned: 0, onboarded: 0, newThisWeek: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  // Detail state
  const [detailLoading, setDetailLoading] = useState(false);
  const [userDetail, setUserDetail] = useState(null);
  const [userPrefs, setUserPrefs] = useState(null);
  const [userFriends, setUserFriends] = useState([]);
  const [userBoards, setUserBoards] = useState([]);
  const [userActivity, setUserActivity] = useState([]);
  const [userSessions, setUserSessions] = useState([]);
  const [userSaves, setUserSaves] = useState({ experiences: [], cards: [] });
  const [userSavedPeople, setUserSavedPeople] = useState([]);
  const [userFriendRequests, setUserFriendRequests] = useState([]);
  const [userFriendLinks, setUserFriendLinks] = useState([]);
  const [userBlocked, setUserBlocked] = useState([]);
  const [userMuted, setUserMuted] = useState([]);
  const [userConversations, setUserConversations] = useState([]);
  const [userCalendar, setUserCalendar] = useState([]);
  const [userReviews, setUserReviews] = useState([]);
  const [userFeedback, setUserFeedback] = useState([]);
  const [userInteractions, setUserInteractions] = useState([]);
  const [userReports, setUserReports] = useState([]);
  const [userAppFeedback, setUserAppFeedback] = useState([]);
  const [userLocationHistory, setUserLocationHistory] = useState([]);
  const [userPrefHistory, setUserPrefHistory] = useState([]);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Action loading states
  const [banningId, setBanningId] = useState(null);
  const [banConfirmModal, setBanConfirmModal] = useState(null); // user object for ban modal

  // Delete confirmation
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteTargetUser, setDeleteTargetUser] = useState(null);

  // Impersonate state
  const [impersonateLoading, setImpersonateLoading] = useState(false);
  const [impersonateData, setImpersonateData] = useState({
    savedExperiences: [],
    savedCards: [],
    boards: [],
    preferences: null,
  });

  // Detail tab
  const [detailTab, setDetailTab] = useState("profile");

  // Refs for cleanup
  const searchTimerRef = useRef(null);

  // ─── URL hash param for cross-page navigation ──────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const targetUserId = params.get("userId");
    if (targetUserId) {
      setSelectedUserId(targetUserId);
      setView("detail");
    }
  }, []);

  // ─── Fetch distinct countries on mount ────────────────────────────────────

  useEffect(() => {
    async function fetchCountries() {
      try {
        const { data } = await supabase.from("profiles").select("country").or('account_type.neq.admin,account_type.is.null').limit(50000);
        if (!mountedRef.current) return;
        const unique = [...new Set((data || []).map(r => r.country).filter(Boolean))].sort();
        setCountries(unique);
      } catch { /* ignore */ }
    }
    fetchCountries();
  }, []);

  // ─── Search debounce ────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [search]);

  // ─── Stats Fetching ─────────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [totalRes, activeRes, bannedRes, onboardedRes] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }).or('account_type.neq.admin,account_type.is.null'),
        supabase.from("profiles").select("*", { count: "exact", head: true }).or('account_type.neq.admin,account_type.is.null').eq("active", true),
        supabase.from("profiles").select("*", { count: "exact", head: true }).or('account_type.neq.admin,account_type.is.null').eq("active", false),
        supabase.from("profiles").select("*", { count: "exact", head: true }).or('account_type.neq.admin,account_type.is.null').eq("has_completed_onboarding", true),
      ]);

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const newRes = await supabase.from("profiles").select("*", { count: "exact", head: true }).or('account_type.neq.admin,account_type.is.null').gte("created_at", weekAgo);

      if (!mountedRef.current) return;
      setStats({
        total: totalRes.count ?? 0,
        active: activeRes.count ?? 0,
        banned: bannedRes.count ?? 0,
        onboarded: onboardedRes.count ?? 0,
        newThisWeek: newRes.count ?? 0,
      });
    } catch (err) {
      addToast({ variant: "error", title: "Failed to load user stats", description: err.message });
    } finally {
      if (mountedRef.current) setStatsLoading(false);
    }
  }, [addToast]);

  // ─── User List Fetching ─────────────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const ascending = sortDir === "asc";
      let query = supabase
        .from("profiles")
        .select("id, display_name, username, email, phone, has_completed_onboarding, active, country, account_type, avatar_url, created_at, first_name, last_name, gender, birthday, visibility_mode, updated_at, is_beta_tester", { count: "exact" })
        .or('account_type.neq.admin,account_type.is.null')
        .order(sortKey || "created_at", { ascending })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (debouncedSearch) {
        const safe = escapeLike(debouncedSearch.trim());
        if (safe) {
          query = query.or(
            `display_name.ilike.%${safe}%,email.ilike.%${safe}%,username.ilike.%${safe}%,phone.ilike.%${safe}%`
          );
        }
      }
      if (filters.onboarding === "completed") query = query.eq("has_completed_onboarding", true);
      if (filters.onboarding === "incomplete") query = query.eq("has_completed_onboarding", false);
      if (filters.status === "active") query = query.eq("active", true);
      if (filters.status === "banned") query = query.eq("active", false);
      if (filters.country && filters.country !== "all") query = query.eq("country", filters.country);
      if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
      if (filters.dateTo) query = query.lte("created_at", filters.dateTo + "T23:59:59Z");

      const { data, count, error } = await query;
      if (error) throw error;
      if (!mountedRef.current) return;
      setUsers(data || []);
      setUserCount(count ?? 0);
    } catch (err) {
      if (!mountedRef.current) return;
      setListError(err.message);
      addToast({ variant: "error", title: "Failed to load users", description: err.message });
    } finally {
      if (mountedRef.current) setListLoading(false);
    }
  }, [page, debouncedSearch, filters, sortKey, sortDir, addToast]);

  // ─── User Detail Fetching ──────────────────────────────────────────────────

  const fetchUserDetail = useCallback(async (userId) => {
    setDetailLoading(true);
    try {
      const [profileRes, prefsRes, friendsRes, activityRes, sessionsRes, participationsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).single(),
        supabase.from("preferences").select("*").eq("profile_id", userId).maybeSingle(),
        supabase.from("friends").select("*, friend:profiles!friends_friend_user_id_fkey(display_name, email, avatar_url)").eq("user_id", userId).eq("status", "accepted"),
        supabase.from("user_activity").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
        supabase.from("user_sessions").select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(10),
        supabase.from("session_participants").select("*, session:collaboration_sessions(name, status, session_type, board_id)").eq("user_id", userId).limit(20),
      ]);

      if (profileRes.error) throw profileRes.error;

      const boardIds = (participationsRes.data || []).filter(p => p.session?.board_id).map(p => p.session.board_id);
      const uniqueBoardIds = [...new Set(boardIds)];
      const boardsRes = uniqueBoardIds.length > 0
        ? await supabase.from("boards").select("*").in("id", uniqueBoardIds)
        : { data: [] };

      if (!mountedRef.current) return;
      setUserDetail(profileRes.data);
      setUserPrefs(prefsRes.data);
      setUserFriends(friendsRes.data || []);
      setUserBoards(boardsRes.data || []);
      setUserActivity(activityRes.data || []);
      setUserSessions(sessionsRes.data || []);
      setEditForm(profileRes.data || {});

      // Batch 2: extended data
      const [
        savedExpRes, savedCardRes, savedPeopleRes,
        friendReqRes, friendLinksRes,
        blockedRes, mutedRes,
        convParticipantsRes, calendarRes,
        reviewsRes, feedbackRes,
        interactionsRes, reportsRes, appFeedbackRes,
        locationRes, prefHistRes,
      ] = await Promise.all([
        supabase.from("saved_experiences").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
        supabase.from("saved_card").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
        supabase.from("saved_people").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
        supabase.from("friend_requests").select("*, sender:profiles!friend_requests_sender_id_fkey(display_name, email, avatar_url), receiver:profiles!friend_requests_receiver_id_fkey(display_name, email, avatar_url)").or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).order("created_at", { ascending: false }).limit(50),
        supabase.from("friend_links").select("*, requester:profiles!friend_links_requester_id_fkey(display_name, email, avatar_url), addressee:profiles!friend_links_addressee_id_fkey(display_name, email, avatar_url)").or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).order("created_at", { ascending: false }).limit(50),
        supabase.from("blocked_users").select("*, blocked:profiles!blocked_users_blocked_user_id_fkey(display_name, email, avatar_url)").eq("user_id", userId).limit(50),
        supabase.from("muted_users").select("*, muted:profiles!muted_users_muted_user_id_fkey(display_name, email, avatar_url)").eq("user_id", userId).limit(50),
        supabase.from("conversation_participants").select("*, conversation:conversations(id, created_at, updated_at)").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
        supabase.from("calendar_entries").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
        supabase.from("place_reviews").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
        supabase.from("experience_feedback").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
        supabase.from("user_interactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
        supabase.from("user_reports").select("*").or(`reporter_id.eq.${userId},reported_user_id.eq.${userId}`).order("created_at", { ascending: false }).limit(30),
        supabase.from("app_feedback").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
        supabase.from("user_location_history").select("*").eq("user_id", userId).order("recorded_at", { ascending: false }).limit(30),
        supabase.from("preference_history").select("*").eq("profile_id", userId).order("changed_at", { ascending: false }).limit(30),
      ]);

      if (!mountedRef.current) return;
      setUserSaves({ experiences: savedExpRes.data || [], cards: savedCardRes.data || [] });
      setUserSavedPeople(savedPeopleRes.data || []);
      setUserFriendRequests(friendReqRes.data || []);
      setUserFriendLinks(friendLinksRes.data || []);
      setUserBlocked(blockedRes.data || []);
      setUserMuted(mutedRes.data || []);
      setUserConversations(convParticipantsRes.data || []);
      setUserCalendar(calendarRes.data || []);
      setUserReviews(reviewsRes.data || []);
      setUserFeedback(feedbackRes.data || []);
      setUserInteractions(interactionsRes.data || []);
      setUserReports(reportsRes.data || []);
      setUserAppFeedback(appFeedbackRes.data || []);
      setUserLocationHistory(locationRes.data || []);
      setUserPrefHistory(prefHistRes.data || []);
    } catch (err) {
      addToast({ variant: "error", title: "Failed to load user details", description: err.message });
    } finally {
      if (mountedRef.current) setDetailLoading(false);
    }
  }, [addToast]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleBan = useCallback(async (userId) => {
    setBanningId(userId);
    try {
      const { error } = await supabase.from("profiles").update({ active: false }).eq("id", userId);
      if (error) throw error;
      addToast({ variant: "success", title: "User banned" });
      logAdminAction("user.ban", "user", userId);
      setBanConfirmModal(null);
      fetchUsers();
      fetchStats();
      if (userDetail?.id === userId) fetchUserDetail(userId);
    } catch (err) {
      addToast({ variant: "error", title: "Failed to ban user", description: err.message });
    } finally {
      if (mountedRef.current) setBanningId(null);
    }
  }, [addToast, fetchUsers, fetchStats, fetchUserDetail, userDetail]);

  const handleUnban = useCallback(async (userId) => {
    setBanningId(userId);
    try {
      const { error } = await supabase.from("profiles").update({ active: true }).eq("id", userId);
      if (error) throw error;
      addToast({ variant: "success", title: "User unbanned" });
      logAdminAction("user.unban", "user", userId);
      fetchUsers();
      fetchStats();
      if (userDetail?.id === userId) fetchUserDetail(userId);
    } catch (err) {
      addToast({ variant: "error", title: "Failed to unban user", description: err.message });
    } finally {
      if (mountedRef.current) setBanningId(null);
    }
  }, [addToast, fetchUsers, fetchStats, fetchUserDetail, userDetail]);

  const handleFullDelete = useCallback(async (userId) => {
    if (!userId) return;
    setDeleting(true);
    const errors = [];

    // CRITICAL: Try edge function first
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      });

      if (res.ok) {
        // Edge function handled everything
        logAdminAction("user.delete", "user", userId);
        addToast({ variant: "success", title: "User fully deleted", description: "All data wiped via edge function." });
        setDeleteModal(false);
        setDeleteConfirmText("");
        setDeleteTargetUser(null);
        if (view === "detail") { setView("list"); setSelectedUserId(null); setUserDetail(null); }
        fetchUsers();
        fetchStats();
        setDeleting(false);
        return;
      }

      // Non-network error from edge function (e.g. 404 = not deployed) — fall through to cascade
      if (!res.ok && res.status !== 0) {
        console.warn("[Delete] Edge function returned", res.status, "— falling back to cascade delete");
      }
    } catch (networkErr) {
      // Network error — edge function not deployed, fall through
      console.warn("[Delete] Edge function network error — falling back to cascade delete:", networkErr.message);
    }

    // FALLBACK: Client-side cascade delete
    const tablesToDelete = [
      { table: "board_card_message_reads", column: "user_id" },
      { table: "board_message_reads", column: "user_id" },
      { table: "board_card_messages", column: "user_id" },
      { table: "board_messages", column: "user_id" },
      { table: "board_card_rsvps", column: "user_id" },
      { table: "board_votes", column: "user_id" },
      { table: "board_saved_cards", column: "user_id" },
      { table: "board_typing_indicators", column: "user_id" },
      { table: "board_user_swipe_states", column: "user_id" },
      { table: "board_participant_presence", column: "user_id" },
      { table: "board_session_preferences", column: "user_id" },
      { table: "board_threads", column: "user_id" },
      { table: "activity_history", column: "user_id" },
      { table: "collaboration_invites", column: "inviter_id" },
      { table: "collaboration_invites", column: "invitee_id" },
      { table: "session_participants", column: "user_id" },
      { table: "message_reads", column: "user_id" },
      { table: "messages", column: "sender_id" },
      { table: "conversation_participants", column: "user_id" },
      { table: "friend_requests", column: "sender_id" },
      { table: "friend_requests", column: "receiver_id" },
      { table: "friend_links", column: "requester_id" },
      { table: "friend_links", column: "addressee_id" },
      { table: "friends", column: "user_id" },
      { table: "friends", column: "friend_user_id" },
      { table: "blocked_users", column: "user_id" },
      { table: "blocked_users", column: "blocked_user_id" },
      { table: "muted_users", column: "user_id" },
      { table: "muted_users", column: "muted_user_id" },
      { table: "person_audio_clips", column: "user_id" },
      { table: "person_experiences", column: "user_id" },
      { table: "saved_people", column: "user_id" },
      { table: "saved_experiences", column: "user_id" },
      { table: "saved_card", column: "user_id" },
      { table: "saves", column: "user_id" },
      { table: "board_cards", column: "added_by" },
      { table: "user_card_impressions", column: "user_id" },
      { table: "user_interactions", column: "user_id" },
      { table: "user_preference_learning", column: "user_id" },
      { table: "calendar_entries", column: "user_id" },
      { table: "scheduled_activities", column: "user_id" },
      { table: "place_reviews", column: "user_id" },
      { table: "experience_feedback", column: "user_id" },
      { table: "user_sessions", column: "user_id" },
      { table: "user_activity", column: "user_id" },
      { table: "user_location_history", column: "user_id" },
      { table: "user_reports", column: "reporter_id" },
      { table: "user_reports", column: "reported_user_id" },
      { table: "app_feedback", column: "user_id" },
      { table: "undo_actions", column: "user_id" },
      { table: "discover_daily_cache", column: "user_id" },
      { table: "preference_history", column: "profile_id" },
      { table: "preferences", column: "profile_id" },
    ];

    for (let i = 0; i < tablesToDelete.length; i += 6) {
      const batch = tablesToDelete.slice(i, i + 6);
      const results = await Promise.allSettled(
        batch.map(({ table, column }) => supabase.from(table).delete().eq(column, userId))
      );
      results.forEach((r, idx) => {
        if (r.status === "rejected" || r.value?.error) {
          const msg = r.status === "rejected" ? r.reason?.message : r.value?.error?.message;
          if (msg && !msg.includes("does not exist") && !msg.includes("permission denied")) {
            errors.push(`${batch[idx].table}: ${msg}`);
          }
        }
      });
    }

    const { error: profileError } = await supabase.from("profiles").delete().eq("id", userId);
    if (profileError) errors.push(`profiles: ${profileError.message}`);

    try {
      const { error: fnError } = await supabase.functions.invoke("delete-user", { body: { user_id: userId } });
      if (fnError) errors.push(`auth (edge fn): ${fnError.message}`);
    } catch (fnErr) {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY },
        });
        if (!res.ok) errors.push(`auth (admin API): ${res.status} — may need service_role key`);
      } catch (adminErr) {
        errors.push(`auth: could not delete auth user — ${fnErr.message}`);
      }
    }

    logAdminAction("user.delete", "user", userId);

    if (errors.length === 0) {
      addToast({ variant: "success", title: "User fully deleted", description: "All data wiped from every table + auth removed." });
    } else {
      addToast({
        variant: "warning",
        title: "User mostly deleted",
        description: `Profile removed but ${errors.length} table(s) had issues: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "..." : ""}`,
      });
    }

    setDeleteModal(false);
    setDeleteConfirmText("");
    setDeleteTargetUser(null);
    if (view === "detail") { setView("list"); setSelectedUserId(null); setUserDetail(null); }
    fetchUsers();
    fetchStats();
    setDeleting(false);
  }, [addToast, fetchUsers, fetchStats, view, session]);

  const handleSaveEdit = useCallback(async () => {
    if (!userDetail) return;
    if (!editForm.email?.trim()) {
      addToast({ variant: "error", title: "Email cannot be empty" });
      return;
    }
    if (!editForm.display_name?.trim() && !editForm.username?.trim()) {
      addToast({ variant: "error", title: "User must have a display name or username" });
      return;
    }
    setSaving(true);
    try {
      const updates = {
        display_name: editForm.display_name,
        username: editForm.username,
        email: editForm.email,
        phone: editForm.phone,
        has_completed_onboarding: editForm.has_completed_onboarding,
        active: editForm.active,
        visibility_mode: editForm.visibility_mode,
        country: editForm.country,
        account_type: editForm.account_type,
        is_beta_tester: editForm.is_beta_tester,
      };
      const { error } = await supabase.from("profiles").update(updates).eq("id", userDetail.id);
      if (error) throw error;
      addToast({ variant: "success", title: "Profile updated" });
      logAdminAction("user.edit", "user", userDetail.id, { fields: Object.keys(updates) });
      setEditing(false);
      fetchUserDetail(userDetail.id);
      fetchUsers();
    } catch (err) {
      addToast({ variant: "error", title: "Failed to save changes", description: err.message });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [addToast, editForm, userDetail, fetchUserDetail, fetchUsers]);

  // ─── Impersonate → "Preview Profile" ──────────────────────────────────────

  const handlePreviewProfile = useCallback(async (userId) => {
    setImpersonateLoading(true);
    try {
      const [savedExpRes, savedCardsRes, prefsRes] = await Promise.all([
        supabase.from("saved_experiences").select("*").eq("user_id", userId).limit(50),
        supabase.from("saved_card").select("*").eq("user_id", userId).limit(50),
        supabase.from("preferences").select("*").eq("profile_id", userId).maybeSingle(),
      ]);

      const { data: participations } = await supabase
        .from("session_participants")
        .select("session:collaboration_sessions(board_id)")
        .eq("user_id", userId);
      const boardIds = [...new Set(
        (participations || []).filter(p => p.session?.board_id).map(p => p.session.board_id)
      )];
      const boardsRes = boardIds.length > 0
        ? await supabase.from("boards").select("*").in("id", boardIds)
        : { data: [] };

      if (!mountedRef.current) return;
      setImpersonateData({
        savedExperiences: savedExpRes.data || [],
        savedCards: savedCardsRes.data || [],
        boards: boardsRes.data || [],
        preferences: prefsRes.data,
      });
      setView("impersonate");
    } catch (err) {
      addToast({ variant: "error", title: "Failed to load profile preview", description: err.message });
    } finally {
      if (mountedRef.current) setImpersonateLoading(false);
    }
  }, [addToast]);

  // ─── Export ────────────────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const cols = [
      { key: "id", label: "ID" },
      { key: "display_name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "country", label: "Country" },
      { key: "active", label: "Active" },
      { key: "has_completed_onboarding", label: "Onboarded" },
      { key: "created_at", label: "Created" },
    ];
    const { exported, capped } = exportCsv(cols, users, "users");
    addToast({ variant: "success", title: `Exported ${exported} users${capped ? " (capped at 10k)" : ""}` });
  }, [users, addToast]);

  // ─── Bulk ban ──────────────────────────────────────────────────────────────

  const handleBulkBan = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkActioning(true);
    try {
      const ids = [...selectedIds];
      const { error } = await supabase.from("profiles").update({ active: false }).in("id", ids);
      if (error) throw error;
      addToast({ variant: "success", title: `${ids.length} user(s) banned` });
      ids.forEach(id => logAdminAction("user.ban", "user", id));
      setSelectedIds(new Set());
      fetchUsers();
      fetchStats();
    } catch (err) {
      addToast({ variant: "error", title: "Bulk ban failed", description: err.message });
    } finally {
      if (mountedRef.current) setBulkActioning(false);
    }
  }, [selectedIds, addToast, fetchUsers, fetchStats]);

  const handleBetaToggle = useCallback(async (userId, currentValue) => {
    const newValue = !currentValue;

    // Optimistic update
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_beta_tester: newValue } : u));
    setBetaTogglingIds(prev => { const next = new Set(prev); next.add(userId); return next; });

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ is_beta_tester: newValue })
        .eq("id", userId);
      if (error) throw error;
      logAdminAction("user.beta_toggle", "user", userId, { is_beta_tester: newValue });
    } catch (err) {
      // Revert on failure
      if (mountedRef.current) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_beta_tester: currentValue } : u));
      }
      addToast({ variant: "error", title: "Failed to update beta status", description: err.message });
    } finally {
      if (mountedRef.current) {
        setBetaTogglingIds(prev => { const next = new Set(prev); next.delete(userId); return next; });
      }
    }
  }, [addToast]);

  // ─── Navigation helpers ─────────────────────────────────────────────────────

  const openDetail = useCallback((userId) => {
    setSelectedUserId(userId);
    setView("detail");
    setEditing(false);
    setDetailTab("profile");
    fetchUserDetail(userId);
  }, [fetchUserDetail]);

  const backToList = useCallback(() => {
    setView("list");
    setSelectedUserId(null);
    setUserDetail(null);
    setEditing(false);
    // Clean URL hash
    if (window.location.hash.includes("userId")) {
      window.location.hash = "#/users";
    }
  }, []);

  const backToDetail = useCallback(() => {
    setView("detail");
  }, []);

  // ─── Sort handler ──────────────────────────────────────────────────────────

  const handleSort = useCallback((key, dir) => {
    setSortKey(key);
    setSortDir(dir || "desc");
    setPage(0);
  }, []);

  // ─── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // If URL had userId, trigger detail fetch
  useEffect(() => {
    if (view === "detail" && selectedUserId && !userDetail && !detailLoading) {
      fetchUserDetail(selectedUserId);
    }
  }, [view, selectedUserId, userDetail, detailLoading, fetchUserDetail]);

  // ─── Delete Modal (shared across views) ─────────────────────────────────────

  const deleteUser = deleteTargetUser;
  const confirmTarget = deleteUser?.username || deleteUser?.display_name || deleteUser?.email || "";

  const deleteModalJSX = (
    <Modal
      open={deleteModal}
      onClose={() => { setDeleteModal(false); setDeleteConfirmText(""); setDeleteTargetUser(null); }}
      title="Delete User Permanently"
      size="sm"
      destructive
    >
      <ModalBody>
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 p-3 bg-[var(--color-error-50)] rounded-lg">
            <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[#b91c1c]">All data for this user will be permanently deleted. This cannot be undone.</p>
            </div>
          </div>
          {confirmTarget ? (
            <Input
              label={`Type "${confirmTarget}" to confirm`}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type to confirm..."
            />
          ) : (
            <p className="text-sm text-[#b91c1c] font-medium">
              This user has no username, display name, or email — deletion is blocked for safety.
            </p>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={() => { setDeleteModal(false); setDeleteConfirmText(""); setDeleteTargetUser(null); }}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          loading={deleting}
          disabled={!confirmTarget || deleteConfirmText !== confirmTarget}
          onClick={() => handleFullDelete(deleteUser?.id)}
        >
          Delete Permanently
        </Button>
      </ModalFooter>
    </Modal>
  );

  // ─── Ban Confirmation Modal ─────────────────────────────────────────────────

  const banModalJSX = (
    <Modal
      open={!!banConfirmModal}
      onClose={() => setBanConfirmModal(null)}
      title="Ban User"
      size="sm"
      destructive
    >
      <ModalBody>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Are you sure you want to ban <strong>{banConfirmModal?.display_name || banConfirmModal?.email || "this user"}</strong>? They will be unable to use the app.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={() => setBanConfirmModal(null)}>Cancel</Button>
        <Button
          variant="danger"
          icon={Ban}
          loading={banningId === banConfirmModal?.id}
          onClick={() => handleBan(banConfirmModal?.id)}
        >
          Ban User
        </Button>
      </ModalFooter>
    </Modal>
  );

  // ─── Render: List View ──────────────────────────────────────────────────────

  if (view === "list") {
    const from = userCount > 0 ? page * PAGE_SIZE + 1 : 0;
    const to = Math.min((page + 1) * PAGE_SIZE, userCount);
    const onboardedPct = stats.total > 0 ? Math.round((stats.onboarded / stats.total) * 100) : 0;

    const columns = [
      {
        key: "_actions",
        label: "Actions",
        width: "220px",
        render: (_, row) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              className="text-[#ef4444] hover:text-[#dc2626] hover:bg-[#fef2f2]"
              onClick={() => {
                setDeleteTargetUser(row);
                setDeleteModal(true);
                setDeleteConfirmText("");
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" size="sm" icon={Eye} onClick={() => openDetail(row.id)}>
              View
            </Button>
            {row.active !== false ? (
              <Button variant="ghost" size="sm" icon={Ban} onClick={() => setBanConfirmModal(row)}>
                Ban
              </Button>
            ) : (
              <Button variant="ghost" size="sm" icon={UserCheck} loading={banningId === row.id} onClick={() => handleUnban(row.id)}>
                Unban
              </Button>
            )}
          </div>
        ),
      },
      {
        key: "avatar_url",
        label: "",
        width: "48px",
        render: (_, row) => (
          <Avatar src={row.avatar_url} name={row.display_name || row.username} size="sm" />
        ),
      },
      {
        key: "display_name",
        label: "Name",
        sortable: true,
        render: (val, row) => (
          <div className="min-w-0">
            <button
              onClick={() => openDetail(row.id)}
              className="text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-brand-500)] transition-colors cursor-pointer text-left truncate block max-w-full"
            >
              {val || "—"}
            </button>
            {row.username && (
              <span className="text-xs text-[var(--color-text-muted)] truncate block">@{row.username}</span>
            )}
          </div>
        ),
      },
      {
        key: "email",
        label: "Email",
        sortable: true,
      },
      {
        key: "phone",
        label: "Phone",
        render: (val) => val ? <span className="text-sm">{val}</span> : <span className="text-[var(--color-text-muted)]">—</span>,
      },
      {
        key: "gender",
        label: "Gender",
        width: "90px",
        render: (val) => val ? <span className="text-sm capitalize">{val}</span> : <span className="text-[var(--color-text-muted)]">—</span>,
      },
      {
        key: "birthday",
        label: "Birthday",
        width: "120px",
        render: (val) => val ? <span className="text-xs">{formatDate(val)}</span> : <span className="text-[var(--color-text-muted)]">—</span>,
      },
      {
        key: "country",
        label: "Country",
        sortable: true,
        width: "100px",
        render: (val) => val ? <Badge variant="outline">{val}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>,
      },
      {
        key: "account_type",
        label: "Type",
        width: "90px",
        render: (val) => val ? <Badge variant="info">{val}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>,
      },
      {
        key: "has_completed_onboarding",
        label: "Onboarding",
        width: "120px",
        render: (val) => (
          <Badge variant={val ? "success" : "warning"} dot>
            {val ? "Complete" : "Incomplete"}
          </Badge>
        ),
      },
      {
        key: "active",
        label: "Status",
        width: "100px",
        render: (val) => (
          <Badge variant={val !== false ? "success" : "error"} dot>
            {val !== false ? "Active" : "Banned"}
          </Badge>
        ),
      },
      {
        key: "is_beta_tester",
        label: "Beta",
        width: "80px",
        render: (val, row) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle
              checked={!!val}
              onChange={() => handleBetaToggle(row.id, val)}
              disabled={betaTogglingIds.has(row.id)}
            />
          </div>
        ),
      },
      {
        key: "created_at",
        label: "Joined",
        sortable: true,
        width: "100px",
        render: (val) => (
          <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(val)}</span>
        ),
      },
    ];

    return (
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Users</h1>
          </div>
          <Button variant="secondary" size="sm" icon={Download} onClick={handleExport}>Export</Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          {statsLoading ? (
            Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard icon={Users} label="Total Users" value={stats.total.toLocaleString()} />
              <StatCard icon={UserCheck} label="Active" value={stats.active.toLocaleString()} />
              <StatCard icon={UserX} label="Banned" value={stats.banned.toLocaleString()} />
              <StatCard icon={Shield} label="Onboarded" value={`${onboardedPct}%`} />
              <StatCard icon={Activity} label="New This Week" value={stats.newThisWeek.toLocaleString()} />
            </>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder="Search by name, email, username, or phone..."
            className="w-full sm:w-80"
          />
          <select
            value={filters.onboarding}
            onChange={(e) => { setFilters(f => ({ ...f, onboarding: e.target.value })); setPage(0); }}
            className="h-10 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg outline-none cursor-pointer focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] transition-all duration-150"
          >
            <option value="all">All Onboarding</option>
            <option value="completed">Completed</option>
            <option value="incomplete">Incomplete</option>
          </select>
          <select
            value={filters.status}
            onChange={(e) => { setFilters(f => ({ ...f, status: e.target.value })); setPage(0); }}
            className="h-10 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg outline-none cursor-pointer focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] transition-all duration-150"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
          </select>
          <select
            value={filters.country}
            onChange={(e) => { setFilters(f => ({ ...f, country: e.target.value })); setPage(0); }}
            className="h-10 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg outline-none cursor-pointer focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] transition-all duration-150"
          >
            <option value="all">All Countries</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => { setFilters(f => ({ ...f, dateFrom: e.target.value })); setPage(0); }}
            className="h-10 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg"
            placeholder="From"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => { setFilters(f => ({ ...f, dateTo: e.target.value })); setPage(0); }}
            className="h-10 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg"
            placeholder="To"
          />
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-[var(--color-brand-50,#fff7ed)] border border-[var(--color-brand-200)]">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">{selectedIds.size} selected</span>
            <Button variant="danger" size="sm" icon={Ban} loading={bulkActioning} onClick={handleBulkBan}>Ban Selected</Button>
            <Button variant="secondary" size="sm" icon={Download} onClick={() => {
              const selected = users.filter(u => selectedIds.has(u.id));
              const cols = [
                { key: "id", label: "ID" },
                { key: "display_name", label: "Name" },
                { key: "email", label: "Email" },
                { key: "country", label: "Country" },
                { key: "created_at", label: "Created" },
              ];
              exportCsv(cols, selected, "selected_users");
              addToast({ variant: "success", title: `Exported ${selected.length} users` });
            }}>Export</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        )}

        {/* Table */}
        <DataTable
          columns={columns}
          rows={users}
          loading={listLoading}
          emptyIcon={Users}
          emptyMessage={listError ? `Error: ${listError}` : debouncedSearch ? "No users match your search" : "No users found"}
          emptyAction={listError ? <Button variant="link" onClick={fetchUsers}>Retry</Button> : undefined}
          sortKey={sortKey}
          sortDirection={sortDir}
          onSort={handleSort}
          selectable
          selectedIds={selectedIds}
          onSelect={(id) => {
            setSelectedIds(prev => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            });
          }}
          onSelectAll={(allSelected) => {
            if (allSelected) setSelectedIds(new Set());
            else setSelectedIds(new Set(users.map(u => u.id)));
          }}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: userCount,
            from,
            to,
            onChange: setPage,
          }}
        />
        {deleteModalJSX}
        {banModalJSX}
      </div>
    );
  }

  // ─── Render: Detail View ────────────────────────────────────────────────────

  if (view === "detail") {
    if (detailLoading && !userDetail) {
      return (
        <div className="flex flex-col gap-6">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={backToList}>Back to Users</Button>
          <div className="flex items-center justify-center py-20">
            <Spinner size="lg" />
          </div>
        </div>
      );
    }

    if (!userDetail) {
      return (
        <div className="flex flex-col gap-6">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={backToList}>Back to Users</Button>
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <Users className="h-10 w-10 text-[var(--gray-300)]" />
            <p className="text-sm text-[var(--color-text-tertiary)]">User not found</p>
          </div>
        </div>
      );
    }

    const isBanned = userDetail.active === false;

    const DETAIL_TABS = [
      { id: "profile", label: "Profile" },
      { id: "preferences", label: "Preferences" },
      { id: "saves", label: `Saves (${userSaves.experiences.length + userSaves.cards.length})` },
      { id: "friends", label: `Friends (${userFriends.length})` },
      { id: "requests", label: `Requests (${userFriendRequests.length})` },
      { id: "links", label: `Links (${userFriendLinks.length})` },
      { id: "people", label: `People (${userSavedPeople.length})` },
      { id: "blocked", label: `Blocked (${userBlocked.length + userMuted.length})` },
      { id: "messages", label: `Messages (${userConversations.length})` },
      { id: "boards", label: `Boards (${userBoards.length})` },
      { id: "calendar", label: `Calendar (${userCalendar.length})` },
      { id: "reviews", label: `Reviews (${userReviews.length + userFeedback.length})` },
      { id: "interactions", label: `Interactions (${userInteractions.length})` },
      { id: "reports", label: `Reports (${userReports.length + userAppFeedback.length})` },
      { id: "activity", label: "Activity" },
      { id: "sessions", label: "Sessions" },
      { id: "location", label: `Location (${userLocationHistory.length})` },
      { id: "prefhistory", label: `Pref History (${userPrefHistory.length})` },
    ];

    return (
      <div className="flex flex-col gap-6">
        {/* Top bar */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={backToList}>Back to Users</Button>
          <div className="flex items-center gap-2">
            {!editing && (
              <Button variant="secondary" size="sm" icon={Edit3} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {isBanned ? (
              <Button variant="secondary" size="sm" icon={UserCheck} loading={banningId === userDetail.id} onClick={() => handleUnban(userDetail.id)}>
                Unban
              </Button>
            ) : (
              <Button variant="secondary" size="sm" icon={Ban} onClick={() => setBanConfirmModal(userDetail)}>
                Ban
              </Button>
            )}
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => { setDeleteTargetUser(userDetail); setDeleteModal(true); setDeleteConfirmText(""); }}>
              Delete
            </Button>
          </div>
        </div>

        {/* User header card */}
        <SectionCard>
          <div className="flex items-start gap-4">
            <Avatar src={userDetail.avatar_url} name={userDetail.display_name || userDetail.username} size="lg" />
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                {userDetail.display_name || "Unnamed User"}
              </h2>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {userDetail.username && (
                  <span className="text-sm text-[var(--color-text-secondary)]">@{userDetail.username}</span>
                )}
                {userDetail.email && (
                  <>
                    <span className="text-[var(--color-text-muted)]">&middot;</span>
                    <span className="text-sm text-[var(--color-text-secondary)]">{userDetail.email}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap mt-2 text-xs text-[var(--color-text-tertiary)]">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Joined {formatDate(userDetail.created_at)}
                </span>
                {userDetail.country && (
                  <span className="flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" /> {userDetail.country}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Badge variant={isBanned ? "error" : "success"} dot>
                  {isBanned ? "Banned" : "Active"}
                </Badge>
                <Badge variant={userDetail.has_completed_onboarding ? "success" : "warning"} dot>
                  {userDetail.has_completed_onboarding ? "Onboarded" : "Incomplete Onboarding"}
                </Badge>
                {userDetail.account_type && (
                  <Badge variant="info">{userDetail.account_type}</Badge>
                )}
                {userDetail.is_beta_tester && (
                  <Badge variant="brand">Beta Tester</Badge>
                )}
              </div>
            </div>
            <Button variant="secondary" size="sm" icon={Eye} loading={impersonateLoading} onClick={() => handlePreviewProfile(userDetail.id)}>
              Preview Profile
            </Button>
          </div>
        </SectionCard>

        {/* Edit bar */}
        {editing && (
          <div className="flex items-center gap-2 p-3 bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] rounded-lg">
            <Edit3 className="w-4 h-4 text-[var(--color-brand-500)] shrink-0" />
            <span className="text-sm text-[var(--color-brand-500)] font-medium flex-1">Editing profile — changes will be saved to the database</span>
            <Button variant="primary" size="sm" icon={Save} loading={saving} onClick={handleSaveEdit}>
              Save Changes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setEditForm(userDetail); }}>
              Cancel
            </Button>
          </div>
        )}

        {/* Tabs */}
        <Tabs tabs={DETAIL_TABS} activeTab={detailTab} onChange={setDetailTab} />

        {/* Tab panels */}
        {detailTab === "profile" && (
          <SectionCard title="Profile Fields">
            {editing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Display Name" value={editForm.display_name || ""} onChange={(e) => setEditForm(f => ({ ...f, display_name: e.target.value }))} />
                <Input label="Username" value={editForm.username || ""} onChange={(e) => setEditForm(f => ({ ...f, username: e.target.value }))} />
                <Input label="Email" type="email" value={editForm.email || ""} onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))} />
                <Input label="Phone" value={editForm.phone || ""} onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                <Input label="Country" value={editForm.country || ""} onChange={(e) => setEditForm(f => ({ ...f, country: e.target.value }))} />
                <Input label="Account Type" value={editForm.account_type || ""} onChange={(e) => setEditForm(f => ({ ...f, account_type: e.target.value }))} />
                <Input label="Visibility Mode" value={editForm.visibility_mode || ""} onChange={(e) => setEditForm(f => ({ ...f, visibility_mode: e.target.value }))} />
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editForm.has_completed_onboarding ?? false} onChange={(e) => setEditForm(f => ({ ...f, has_completed_onboarding: e.target.checked }))} className="w-4 h-4 accent-[var(--color-brand-500)] cursor-pointer" />
                    <span className="text-sm text-[var(--color-text-primary)]">Has Completed Onboarding</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editForm.active ?? true} onChange={(e) => setEditForm(f => ({ ...f, active: e.target.checked }))} className="w-4 h-4 accent-[var(--color-brand-500)] cursor-pointer" />
                    <span className="text-sm text-[var(--color-text-primary)]">Active (uncheck to ban)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editForm.is_beta_tester ?? false} onChange={(e) => setEditForm(f => ({ ...f, is_beta_tester: e.target.checked }))} className="w-4 h-4 accent-[var(--color-brand-500)] cursor-pointer" />
                    <span className="text-sm text-[var(--color-text-primary)]">Beta Tester</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
                <ProfileField icon={Hash} label="ID" value={userDetail.id} mono />
                <ProfileField icon={Mail} label="Email" value={userDetail.email} />
                <ProfileField icon={Users} label="Display Name" value={userDetail.display_name} />
                <ProfileField icon={Hash} label="Username" value={userDetail.username ? `@${userDetail.username}` : null} />
                <ProfileField icon={Phone} label="Phone" value={userDetail.phone} />
                <ProfileField icon={Globe} label="Country" value={userDetail.country} />
                <ProfileField icon={Shield} label="Account Type" value={userDetail.account_type} />
                <ProfileField icon={Eye} label="Visibility Mode" value={userDetail.visibility_mode} />
                <ProfileField icon={Users} label="First Name" value={userDetail.first_name} />
                <ProfileField icon={Users} label="Last Name" value={userDetail.last_name} />
                <ProfileField icon={Users} label="Gender" value={userDetail.gender} />
                <ProfileField icon={Heart} label="Birthday" value={userDetail.birthday} />
                <ProfileField icon={Zap} label="Beta Tester" value={userDetail.is_beta_tester ? "Yes" : "No"} />
                <ProfileField icon={Clock} label="Created" value={formatDateTime(userDetail.created_at)} />
                <ProfileField icon={Clock} label="Updated" value={formatDateTime(userDetail.updated_at)} />
              </div>
            )}
          </SectionCard>
        )}

        {detailTab === "preferences" && (
          <SectionCard title="Preferences">
            {userPrefs ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
                <ProfileField icon={Zap} label="Mode" value={userPrefs.mode} />
                <ProfileField icon={Activity} label="Budget Min" value={userPrefs.budget_min} />
                <ProfileField icon={Activity} label="Budget Max" value={userPrefs.budget_max} />
                <ProfileField icon={Globe} label="Travel Mode" value={userPrefs.travel_mode} />
                <ProfileField icon={Clock} label="Time Slot" value={userPrefs.time_slot} />
                <ProfileField icon={Globe} label="Max Distance (km)" value={userPrefs.max_distance_km} />
                {userPrefs.categories && (
                  <div className="md:col-span-2">
                    <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">Categories</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(Array.isArray(userPrefs.categories) ? userPrefs.categories : []).map((cat, i) => (
                        <Badge key={i} variant="brand">{cat}</Badge>
                      ))}
                      {(!userPrefs.categories || (Array.isArray(userPrefs.categories) && userPrefs.categories.length === 0)) && (
                        <span className="text-sm text-[var(--color-text-muted)]">None set</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState icon={Zap} message="No preferences set" />
            )}
          </SectionCard>
        )}

        {detailTab === "saves" && (
          <div className="flex flex-col gap-4">
            <SectionCard title={`Saved Experiences (${userSaves.experiences.length})`}>
              {userSaves.experiences.length > 0 ? (
                <DataTable columns={[
                  { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                  { key: "title", label: "Title", render: (v) => v || "—" },
                  { key: "category", label: "Category", render: (v) => v ? <Badge variant="brand">{v}</Badge> : "—" },
                  { key: "place_name", label: "Place", render: (v) => v || "—" },
                  { key: "created_at", label: "Saved", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                ]} rows={userSaves.experiences} emptyMessage="No saved experiences" />
              ) : (
                <EmptyState icon={Bookmark} message="No saved experiences" />
              )}
            </SectionCard>
            <SectionCard title={`Saved Cards (${userSaves.cards.length})`}>
              {userSaves.cards.length > 0 ? (
                <DataTable columns={[
                  { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                  { key: "card_pool_id", label: "Card Pool ID", render: (v) => v ? <span className="font-mono text-xs">{v.slice(0, 8)}...</span> : "—" },
                  { key: "title", label: "Title", render: (v) => v || "—" },
                  { key: "created_at", label: "Saved", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                ]} rows={userSaves.cards} emptyMessage="No saved cards" />
              ) : (
                <EmptyState icon={Heart} message="No saved cards" />
              )}
            </SectionCard>
          </div>
        )}

        {detailTab === "requests" && <DetailListSection title={`Friend Requests (${userFriendRequests.length})`} items={userFriendRequests} emptyIcon={UserPlus} emptyMsg="No friend requests" renderItem={(r) => { const isSender = r.sender_id === userDetail.id; const other = isSender ? r.receiver : r.sender; return <SimpleListItem key={r.id} avatar={other} label={`${isSender ? "Sent to" : "Received from"} ${other?.display_name || "Unknown"}`} sub={`${other?.email || "—"} · ${formatDateTime(r.created_at)}`} badge={<Badge variant={r.status === "accepted" ? "success" : r.status === "pending" ? "warning" : "default"}>{r.status || "unknown"}</Badge>} />; }} />}

        {detailTab === "links" && <DetailListSection title={`Friend Links (${userFriendLinks.length})`} items={userFriendLinks} emptyIcon={Link2} emptyMsg="No friend links" renderItem={(l) => { const isReq = l.requester_id === userDetail.id; const other = isReq ? l.addressee : l.requester; return <SimpleListItem key={l.id} avatar={other} label={`${isReq ? "Linked to" : "Linked from"} ${other?.display_name || "Unknown"}`} sub={`${other?.email || "—"} · ${formatDateTime(l.created_at)}`} badge={<Badge variant={l.status === "accepted" ? "success" : l.status === "pending" ? "warning" : "error"}>{l.status || "unknown"}</Badge>} />; }} />}

        {detailTab === "people" && (
          <SectionCard title={`Saved People (${userSavedPeople.length})`}>
            {userSavedPeople.length > 0 ? (
              <DataTable columns={[
                { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                { key: "name", label: "Name", render: (v) => v || "—" },
                { key: "relationship", label: "Relationship", render: (v) => v ? <Badge variant="brand">{v}</Badge> : "—" },
                { key: "linked_user_id", label: "Linked", render: (v) => v ? <Badge variant="success" dot>Yes</Badge> : <span className="text-[var(--color-text-muted)]">No</span> },
                { key: "created_at", label: "Added", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
              ]} rows={userSavedPeople} emptyMessage="No saved people" />
            ) : (
              <EmptyState icon={Users} message="No saved people" />
            )}
          </SectionCard>
        )}

        {detailTab === "blocked" && (
          <div className="flex flex-col gap-4">
            <DetailListSection title={`Blocked Users (${userBlocked.length})`} items={userBlocked} emptyIcon={UserMinus} emptyMsg="No blocked users" renderItem={(b) => <SimpleListItem key={b.id} avatar={b.blocked} label={b.blocked?.display_name || "Unknown"} sub={b.blocked?.email || "—"} badge={<Badge variant="error">Blocked</Badge>} />} />
            <DetailListSection title={`Muted Users (${userMuted.length})`} items={userMuted} emptyIcon={VolumeX} emptyMsg="No muted users" renderItem={(m) => <SimpleListItem key={m.id} avatar={m.muted} label={m.muted?.display_name || "Unknown"} sub={m.muted?.email || "—"} badge={<Badge variant="warning">Muted</Badge>} />} />
          </div>
        )}

        {detailTab === "messages" && <DetailListSection title={`Conversations (${userConversations.length})`} items={userConversations} emptyIcon={MessageSquare} emptyMsg="No conversations" renderItem={(c) => <SimpleListItem key={c.id} iconComp={MessageSquare} label={`${c.conversation?.id?.slice(0, 8) || c.conversation_id?.slice(0, 8) || "—"}...`} sub={`Created ${formatDateTime(c.conversation?.created_at || c.created_at)}${c.conversation?.updated_at ? ` · Updated ${timeAgo(c.conversation.updated_at)}` : ""}`} mono />} />}

        {detailTab === "friends" && <DetailListSection title={`Friends (${userFriends.length})`} items={userFriends} emptyIcon={Users} emptyMsg="No friends yet" renderItem={(f) => <SimpleListItem key={f.id} avatar={f.friend} label={f.friend?.display_name || "Unknown"} sub={f.friend?.email || "—"} />} />}

        {detailTab === "boards" && <DetailListSection title={`Boards (${userBoards.length})`} items={userBoards} emptyIcon={LayoutDashboard} emptyMsg="Not part of any boards" renderItem={(b) => <SimpleListItem key={b.id} iconComp={LayoutDashboard} label={b.name || "Unnamed Board"} sub={`Created ${timeAgo(b.created_at)}`} />} />}

        {detailTab === "activity" && <DetailListSection title="Recent Activity" items={userActivity} emptyIcon={Activity} emptyMsg="No recent activity" renderItem={(a) => <SimpleListItem key={a.id} iconComp={Activity} label={a.title || a.description || "Activity"} sub={formatDateTime(a.created_at)} badge={a.activity_type ? <Badge variant="default">{a.activity_type}</Badge> : null} />} />}

        {detailTab === "sessions" && <DetailListSection title="Session History" items={userSessions} emptyIcon={Clock} emptyMsg="No session history" renderItem={(s) => <SimpleListItem key={s.id} iconComp={Clock} label={s.session_type || "Session"} sub={`Started ${formatDateTime(s.started_at)}${s.ended_at ? ` · Ended ${formatDateTime(s.ended_at)}` : ""}${s.interaction_count != null ? ` · ${s.interaction_count} interactions` : ""}`} />} />}

        {detailTab === "calendar" && (
          <SectionCard title={`Calendar Entries (${userCalendar.length})`}>
            {userCalendar.length > 0 ? (
              <DataTable columns={[
                { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                { key: "title", label: "Title", render: (v) => v || "—" },
                { key: "scheduled_date", label: "Date", render: (v) => v ? formatDate(v) : "—" },
                { key: "status", label: "Status", render: (v) => v ? <Badge variant={v === "completed" ? "success" : v === "cancelled" ? "error" : "warning"}>{v}</Badge> : "—" },
                { key: "created_at", label: "Created", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
              ]} rows={userCalendar} emptyMessage="No calendar entries" />
            ) : (
              <EmptyState icon={Calendar} message="No calendar entries" />
            )}
          </SectionCard>
        )}

        {detailTab === "reviews" && (
          <div className="flex flex-col gap-4">
            <SectionCard title={`Place Reviews (${userReviews.length})`}>
              {userReviews.length > 0 ? (
                <DataTable columns={[
                  { key: "place_name", label: "Place", render: (v) => v || "—" },
                  { key: "rating", label: "Rating", render: (v) => v != null ? `${v}/5` : "—" },
                  { key: "created_at", label: "Date", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                ]} rows={userReviews} emptyMessage="No reviews" />
              ) : (
                <EmptyState icon={Star} message="No place reviews" />
              )}
            </SectionCard>
            <SectionCard title={`Experience Feedback (${userFeedback.length})`}>
              {userFeedback.length > 0 ? (
                <DataTable columns={[
                  { key: "rating", label: "Rating", render: (v) => v != null ? `${v}/5` : "—" },
                  { key: "message", label: "Message", render: (v) => v ? <span className="truncate block max-w-[300px]">{v}</span> : "—" },
                  { key: "created_at", label: "Date", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                ]} rows={userFeedback} emptyMessage="No feedback" />
              ) : (
                <EmptyState icon={Star} message="No experience feedback" />
              )}
            </SectionCard>
          </div>
        )}

        {detailTab === "interactions" && (
          <SectionCard title={`User Interactions (${userInteractions.length})`}>
            {userInteractions.length > 0 ? (
              <DataTable columns={[
                { key: "interaction_type", label: "Type", render: (v) => v ? <Badge variant="default">{v}</Badge> : "—" },
                { key: "card_pool_id", label: "Card", render: (v) => v ? <span className="font-mono text-xs">{v.slice(0, 8)}...</span> : "—" },
                { key: "category", label: "Category", render: (v) => v ? <Badge variant="brand">{v}</Badge> : "—" },
                { key: "created_at", label: "When", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
              ]} rows={userInteractions} emptyMessage="No interactions" />
            ) : (
              <EmptyState icon={MousePointerClick} message="No interactions recorded" />
            )}
          </SectionCard>
        )}

        {detailTab === "reports" && (
          <div className="flex flex-col gap-4">
            <SectionCard title={`User Reports (${userReports.length})`}>
              {userReports.length > 0 ? (
                <DataTable columns={[
                  { key: "reporter_id", label: "Direction", render: (v) => v === userDetail.id ? <Badge variant="warning">Reported by user</Badge> : <Badge variant="error">User was reported</Badge> },
                  { key: "reason", label: "Reason", render: (v) => v || "—" },
                  { key: "status", label: "Status", render: (v) => v ? <Badge variant={v === "resolved" ? "success" : v === "dismissed" ? "default" : "warning"}>{v}</Badge> : "—" },
                  { key: "created_at", label: "Date", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                ]} rows={userReports} emptyMessage="No reports" />
              ) : (
                <EmptyState icon={Flag} message="No reports" />
              )}
            </SectionCard>
            <SectionCard title={`App Feedback (${userAppFeedback.length})`}>
              {userAppFeedback.length > 0 ? (
                <DataTable columns={[
                  { key: "rating", label: "Rating", render: (v) => v != null ? `${v}/5` : "—" },
                  { key: "message", label: "Message", render: (v) => v ? <span className="truncate block max-w-[300px]">{v}</span> : "—" },
                  { key: "created_at", label: "Date", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                ]} rows={userAppFeedback} emptyMessage="No app feedback" />
              ) : (
                <EmptyState icon={Star} message="No app feedback" />
              )}
            </SectionCard>
          </div>
        )}

        {detailTab === "location" && (
          <SectionCard title={`Location History (${userLocationHistory.length})`}>
            {userLocationHistory.length > 0 ? (
              <DataTable columns={[
                { key: "latitude", label: "Lat", render: (v) => v != null ? Number(v).toFixed(4) : "—" },
                { key: "longitude", label: "Lng", render: (v) => v != null ? Number(v).toFixed(4) : "—" },
                { key: "city", label: "City", render: (v) => v || "—" },
                { key: "country", label: "Country", render: (v) => v || "—" },
                { key: "recorded_at", label: "Recorded", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(v)}</span> },
              ]} rows={userLocationHistory} emptyMessage="No location history" />
            ) : (
              <EmptyState icon={MapPin} message="No location history" />
            )}
          </SectionCard>
        )}

        {detailTab === "prefhistory" && (
          <SectionCard title={`Preference History (${userPrefHistory.length})`}>
            {userPrefHistory.length > 0 ? (
              <DataTable columns={[
                { key: "field_changed", label: "Field", render: (v) => v || "—" },
                { key: "old_value", label: "Old Value", render: (v) => v != null ? <span className="truncate block max-w-[150px]">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span> : "—" },
                { key: "new_value", label: "New Value", render: (v) => v != null ? <span className="truncate block max-w-[150px]">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span> : "—" },
                { key: "changed_at", label: "Changed", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(v)}</span> },
              ]} rows={userPrefHistory} emptyMessage="No preference history" />
            ) : (
              <EmptyState icon={Clock} message="No preference change history" />
            )}
          </SectionCard>
        )}

        {deleteModalJSX}
        {banModalJSX}
      </div>
    );
  }

  // ─── Render: Preview Profile View ──────────────────────────────────────────

  if (view === "impersonate") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={backToDetail}>Back to User Detail</Button>
        </div>

        <div className="flex items-center gap-3 p-4 bg-[var(--color-info-50)] border border-[var(--color-info-200)] rounded-lg">
          <Eye className="w-5 h-5 text-[#3b82f6] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#1d4ed8]">
              Previewing: {userDetail?.display_name || "Unknown"}
              {userDetail?.username && <span className="font-normal"> (@{userDetail.username})</span>}
            </p>
            <p className="text-xs text-[#1d4ed8] mt-0.5">All data below is read-only and shows what this user would see</p>
          </div>
        </div>

        <SectionCard title="Their Preferences">
          {impersonateData.preferences ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
              <ProfileField icon={Zap} label="Mode" value={impersonateData.preferences.mode} />
              <ProfileField icon={Activity} label="Budget" value={
                impersonateData.preferences.budget_min != null && impersonateData.preferences.budget_max != null
                  ? `${impersonateData.preferences.budget_min} – ${impersonateData.preferences.budget_max}`
                  : null
              } />
              <ProfileField icon={Globe} label="Travel Mode" value={impersonateData.preferences.travel_mode} />
              <ProfileField icon={Clock} label="Time Slot" value={impersonateData.preferences.time_slot} />
              {impersonateData.preferences.categories && (
                <div className="md:col-span-2">
                  <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">Categories</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(Array.isArray(impersonateData.preferences.categories) ? impersonateData.preferences.categories : []).map((cat, i) => (
                      <Badge key={i} variant="brand">{cat}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon={Zap} message="No preferences set" />
          )}
        </SectionCard>

        <SectionCard title={`Their Saved Experiences (${impersonateData.savedExperiences.length})`}>
          {impersonateData.savedExperiences.length > 0 ? (
            <DataTable columns={[
              { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
              { key: "title", label: "Title", render: (v) => v || "—" },
              { key: "category", label: "Category", render: (v) => v ? <Badge variant="brand">{v}</Badge> : "—" },
              { key: "created_at", label: "Saved", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
            ]} rows={impersonateData.savedExperiences} emptyMessage="No saved experiences" />
          ) : (
            <EmptyState icon={Heart} message="No saved experiences" />
          )}
        </SectionCard>

        <SectionCard title={`Their Saved Cards (${impersonateData.savedCards.length})`}>
          {impersonateData.savedCards.length > 0 ? (
            <DataTable columns={[
              { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
              { key: "card_pool_id", label: "Card Pool ID", render: (v) => v ? <span className="font-mono text-xs">{v.slice(0, 8)}...</span> : "—" },
              { key: "created_at", label: "Saved", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
            ]} rows={impersonateData.savedCards} emptyMessage="No saved cards" />
          ) : (
            <EmptyState icon={Heart} message="No saved cards" />
          )}
        </SectionCard>

        <SectionCard title={`Their Boards (${impersonateData.boards.length})`}>
          {impersonateData.boards.length > 0 ? (
            <div className="divide-y divide-[var(--gray-200)]">
              {impersonateData.boards.map((b, i) => (
                <div key={b.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="w-8 h-8 rounded-lg bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
                    <LayoutDashboard className="w-4 h-4 text-[var(--color-brand-500)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{b.name || "Unnamed Board"}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">Created {timeAgo(b.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={LayoutDashboard} message="Not part of any boards" />
          )}
        </SectionCard>
      </div>
    );
  }

  return null;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ProfileField({ icon: Icon, label, value, mono = false }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-[var(--gray-50)] flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-[var(--color-text-tertiary)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">{label}</p>
        <p className={`text-sm text-[var(--color-text-primary)] truncate mt-0.5 ${mono ? "font-mono text-xs" : ""}`}>
          {value ?? <span className="text-[var(--color-text-muted)]">—</span>}
        </p>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      <Icon className="h-8 w-8 text-[var(--gray-300)]" />
      <p className="text-sm text-[var(--color-text-tertiary)]">{message}</p>
    </div>
  );
}

function DetailListSection({ title, items, emptyIcon: EmptyIcon, emptyMsg, renderItem }) {
  return (
    <SectionCard title={title}>
      {items.length > 0 ? (
        <div className="divide-y divide-[var(--gray-200)]">
          {items.map((item, i) => renderItem(item, i))}
        </div>
      ) : (
        <EmptyState icon={EmptyIcon} message={emptyMsg} />
      )}
    </SectionCard>
  );
}

function SimpleListItem({ avatar, iconComp: IconComp, label, sub, badge, mono }) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      {avatar ? (
        <Avatar src={avatar?.avatar_url} name={avatar?.display_name} size="sm" />
      ) : IconComp ? (
        <div className="w-8 h-8 rounded-full bg-[var(--gray-100)] flex items-center justify-center shrink-0">
          <IconComp className="w-4 h-4 text-[var(--color-text-tertiary)]" />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium text-[var(--color-text-primary)] truncate ${mono ? "font-mono" : ""}`}>{label}</p>
        {sub && <p className="text-xs text-[var(--color-text-muted)] truncate">{sub}</p>}
      </div>
      {badge}
    </div>
  );
}
