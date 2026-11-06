import React, { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  LineChart,
  Line
} from 'recharts';
import {
  Search,
  ShieldCheck,
  Menu,
  Target,
  Bell,
  User,
  TrendingUp,
  Calendar,
  DollarSign,
  Globe,
  Building,
  Award,
  LayoutGrid,
  List,
  Columns,
  Terminal,
  SlidersHorizontal,
  Filter,
  CheckCircle,
  AlertCircle,
  Briefcase,
  GraduationCap,
  BookOpen,
  Sparkles,
  Plus,
  Trash,
  Settings,
  Check,
  Loader2,
  Activity,
  FileText,
  Layers,
  HelpCircle,
  ArrowRight,
  ExternalLink,
  Users,
  MessageSquare,
  Share2,
  Lock,
  Unlock,
  Send,
  UserPlus,
  Archive,
  ArchiveRestore,
  CalendarX,
  History as HistoryIcon,
  Repeat
} from 'lucide-react';

import { 
  UserRole, 
  UserProfile, 
  Funder, 
  Grant, 
  GrantLifecycle,
  GrantMatch, 
  Notification, 
  ApplicationTracker, 
  ScraperLog, 
  DashboardStats,
  ScraperSchedule,
  ApplicationContext,
  AssistantMode,
  Consortium,
  TeamMessage,
  TeamSharedGrant,
  StatusTransition
} from './types';
import { CallHistory } from './components/CallHistory';
import { ARCHIVE_AFTER_DAYS, CRITICAL_DEADLINE_DAYS, daysUntilArchive } from '../shared/grantLifecycle';
import { api, ApiError, onSessionExpired } from './api';
import ResearchOffice from './components/ResearchOffice';
import SmartProfile from './components/SmartProfile';
import AuthLanding from './components/AuthLanding';
import ApplicationReadiness from './components/ApplicationReadiness';
import AccountMenu from './components/AccountMenu';
import GeneralSettings from './components/GeneralSettings';
import { grantMatchesRegionFilter, REGION_FILTERS } from '../shared/regions';

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
function timeAgo(when: string | number, now: number): string {
  const secs = Math.max(0, Math.round((now - new Date(when).getTime()) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

// --- Funding seasonality: real calls by deadline month ---
// Six months back, this month and five ahead, from every call the agents
// have found (expired and archived ones included, so past months are real).
type TrendPoint = { month: string; funding: number; activeGrants: number; Tech: number; Health: number; Energy: number; Education: number; SocialSciences: number };
const TREND_CATEGORY: Record<string, keyof TrendPoint> = {
  technology: 'Tech',
  tech: 'Tech',
  health: 'Health',
  energy: 'Energy',
  education: 'Education',
  'social sciences': 'SocialSciences',
};
function buildFundingTrends(grants: Grant[], now: number): TrendPoint[] {
  const today = new Date(now);
  const months: TrendPoint[] = [];
  const index = new Map<string, TrendPoint>();
  for (let i = -6; i <= 5; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const point: TrendPoint = {
      month: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      funding: 0, activeGrants: 0, Tech: 0, Health: 0, Energy: 0, Education: 0, SocialSciences: 0,
    };
    months.push(point);
    index.set(key, point);
  }
  for (const g of grants) {
    const point = g.deadline ? index.get(g.deadline.slice(0, 7)) : undefined;
    if (!point) continue;
    const amount = g.fundingAmount > 0 ? g.fundingAmount : 0;
    point.activeGrants += 1;
    point.funding += amount;
    const cat = TREND_CATEGORY[g.category.toLowerCase()];
    if (cat) (point[cat] as number) += amount;
  }
  return months;
}

// --- Helper Markdown Renderer ---
function renderInlineBold(text: string): React.ReactNode[] {
  const parts = text.split('**');
  return parts.map((part, idx) => {
    if (idx % 2 === 1) {
      return <strong key={idx} className="font-bold text-gray-900">{part}</strong>;
    }
    const italicParts = part.split('*');
    return italicParts.map((ipart, iidx) => {
      if (iidx % 2 === 1) {
        return <em key={`${idx}-${iidx}`} className="italic text-gray-800">{ipart}</em>;
      }
      return ipart;
    }) as any;
  }) as any;
}

/** A Markdown table (consecutive "| a | b |" lines; the --- separator row is dropped). */
function renderTable(rows: string[], key: number) {
  const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const [head, ...body] = rows.filter((r) => !/^\|?\s*:?-{3,}/.test(r.trim())).map(cells);
  return (
    <div key={key} className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-[11px]">
        <thead>
          <tr>{head!.map((c, j) => <th key={j} className="border-b border-gray-200 px-2 py-1.5 font-bold text-gray-800">{renderInlineBold(c)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, k) => (
            <tr key={k} className="border-b border-gray-100 align-top">
              {r.map((c, j) => <td key={j} className="px-2 py-1.5 text-gray-600">{renderInlineBold(c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderMarkdown(md: string) {
  if (!md) return null;
  // Table lines are gathered into one block; everything else renders line by line.
  const blocks: (string | string[])[] = [];
  for (const line of md.split('\n')) {
    const isRow = line.trim().startsWith('|');
    const last = blocks[blocks.length - 1];
    if (isRow && Array.isArray(last)) last.push(line);
    else blocks.push(isRow ? [line] : line);
  }
  return (
    <div className="space-y-4 text-xs text-gray-700 leading-relaxed">
      {blocks.map((block, i) => {
        if (Array.isArray(block)) return renderTable(block, i);
        const line = block;
        const trimmed = line.trim();
        if (trimmed.startsWith('### ')) {
          return <h3 key={i} className="text-sm font-black text-blue-800 mt-4 border-b border-gray-100 pb-1">{trimmed.replace('### ', '')}</h3>;
        }
        if (trimmed.startsWith('#### ')) {
          return <h4 key={i} className="text-xs font-extrabold text-indigo-700 mt-3">{trimmed.replace('#### ', '')}</h4>;
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={i} className="text-base font-black text-gray-900 mt-6 border-b border-gray-200 pb-2">{trimmed.replace('## ', '')}</h2>;
        }
        if (trimmed.startsWith('# ')) {
          return <h1 key={i} className="text-lg font-black text-gray-900 mt-8 mb-4">{trimmed.replace('# ', '')}</h1>;
        }
        if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
          const content = trimmed.substring(2);
          return (
            <li key={i} className="ml-4 list-disc pl-1 text-gray-600">
              {renderInlineBold(content)}
            </li>
          );
        }
        if (/^\d+\.\s/.test(trimmed)) {
          const content = trimmed.replace(/^\d+\.\s/, '');
          return (
            <li key={i} className="ml-4 list-decimal pl-1 text-gray-600">
              {renderInlineBold(content)}
            </li>
          );
        }
        if (!trimmed) {
          return <div key={i} className="h-2" />;
        }
        return <p key={i} className="my-1">{renderInlineBold(line)}</p>;
      })}
    </div>
  );
}

export default function App() {
  // --- Auth State ---
  const [user, setUser] = useState<UserProfile | null>(null);
  // Signed in. The access token itself lives only inside src/api.ts.
  const [authed, setAuthed] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);

  // --- Active Tab State ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'smart' | 'explorer' | 'tracker' | 'office' | 'scraper' | 'notifications' | 'profile' | 'assistant' | 'collaboration' | 'settings'>('dashboard');
  // Phones: the sidebar slides over the page and closes after a choice.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [activeTab]);

  // --- AI Proposal Assistant States ---
  const [assistantGrantId, setAssistantGrantId] = useState<string>('');
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('outline');
  // The in-app application for the selected call (from its readiness panel), and a counter to reload it.
  const [assistantApp, setAssistantApp] = useState<ApplicationContext | null>(null);
  const [assistantRefresh, setAssistantRefresh] = useState(0);
  const [assistantPastProjects, setAssistantPastProjects] = useState('');
  const [assistantTeamMembers, setAssistantTeamMembers] = useState('');
  const [assistantResearchArea, setAssistantResearchArea] = useState('');
  const [assistantDraftText, setAssistantDraftText] = useState('');
  const [assistantResponse, setAssistantResponse] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);

  // --- Master Data State ---
  const [grants, setGrants] = useState<Grant[]>([]);
  const [funders, setFunders] = useState<Funder[]>([]);
  const [matches, setMatches] = useState<(GrantMatch & { grant: Grant })[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [applications, setApplications] = useState<ApplicationTracker[]>([]);
  const [scraperLogs, setScraperLogs] = useState<ScraperLog[]>([]);
  const [analytics, setAnalytics] = useState<DashboardStats | null>(null);
  const [loadingGrants, setLoadingGrants] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // --- Search & Filters State ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedFunder, setSelectedFunder] = useState('all');
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [selectedOrgType, setSelectedOrgType] = useState('all');
  const [matchFilterMode, setMatchFilterMode] = useState<'all' | 'high'>('all');
  // List by default; the viewer's last choice is remembered on this device.
  const [grantViewMode, setGrantViewModeState] = useState<'list' | 'tiles' | 'details'>(() => {
    try {
      const saved = localStorage.getItem('gs.explorerView');
      if (saved === 'list' || saved === 'tiles' || saved === 'details') return saved;
    } catch {
      /* storage blocked */
    }
    return 'list';
  });
  const setGrantViewMode = (mode: 'list' | 'tiles' | 'details') => {
    setGrantViewModeState(mode);
    try {
      localStorage.setItem('gs.explorerView', mode);
    } catch {
      /* storage blocked */
    }
  };
  // Active calls by default; expired and archived calls are kept apart.
  const [grantLifecycleView, setGrantLifecycleView] = useState<GrantLifecycle>('active');
  const [archivingGrantId, setArchivingGrantId] = useState<string | null>(null);
  const [bulkArchiving, setBulkArchiving] = useState(false);
  const [explorerSelectedGrantId, setExplorerSelectedGrantId] = useState<string | null>(null);
  const [detailsMatch, setDetailsMatch] = useState<GrantMatch | null>(null);
  const [loadingDetailsMatch, setLoadingDetailsMatch] = useState(false);

  // --- Detail view Modal / Drawer State ---
  const [selectedGrant, setSelectedGrant] = useState<Grant | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<GrantMatch | null>(null);
  const [loadingDetailMatch, setLoadingDetailMatch] = useState(false);

  // --- Application Trackers Form State ---
  const [trackingNotes, setTrackingNotes] = useState('');
  const [trackingStatus, setTrackingStatus] = useState<'draft' | 'submitted' | 'awarded' | 'rejected'>('draft');

  // --- Drag and Drop State ---
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null);
  const [activeDragOverColumn, setActiveDragOverColumn] = useState<'draft' | 'submitted' | 'awarded' | 'rejected' | null>(null);

  // --- Application Timeline State ---
  const [selectedTimelineAppId, setSelectedTimelineAppId] = useState<string | null>(null);
  const [customTimelineEventStatus, setCustomTimelineEventStatus] = useState<'draft' | 'submitted' | 'awarded' | 'rejected' | ''>('');
  const [customTimelineEventNotes, setCustomTimelineEventNotes] = useState('');
  const [isAddingTimelineEvent, setIsAddingTimelineEvent] = useState(false);

  // --- Scraper Panel Form State ---
  // '' = all sources
  const [customScrapeSource, setCustomScrapeSource] = useState('');
  const [scraperSources, setScraperSources] = useState<{ id: string; label: string; adapter: string }[]>([]);
  const [scraperSchedule, setScraperSchedule] = useState<ScraperSchedule | null>(null);
  const [runningScrape, setRunningScrape] = useState(false);
  const [scrapeSuccess, setScrapeSuccess] = useState<string | null>(null);

  // --- Funding Trends Chart States ---
  const [trendCategory, setTrendCategory] = useState<'all' | 'Tech' | 'Health' | 'Energy' | 'activeGrants'>('all');
  const [trendChartType, setTrendChartType] = useState<'area' | 'bar' | 'line'>('area');
  const [dashboardLayout, setDashboardLayout] = useState<'compact' | 'detailed'>('detailed');

  // --- Collaboration Hub States ---
  const [colabUsers, setColabUsers] = useState<UserProfile[]>([]);
  const [teams, setTeams] = useState<Consortium[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Consortium | null>(null);
  const [teamMembers, setTeamMembers] = useState<UserProfile[]>([]);
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const [teamGrants, setTeamGrants] = useState<(TeamSharedGrant & { grant?: Grant })[]>([]);
  const [newMessageText, setNewMessageText] = useState('');
  const [searchColabQuery, setSearchColabQuery] = useState('');
  const [searchColabExpertise, setSearchColabExpertise] = useState('');
  const [searchColabInstitution, setSearchColabInstitution] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [newTeamPrivate, setNewTeamPrivate] = useState(false);
  const [loadingColab, setLoadingColab] = useState(false);
  const [sharingGrantId, setSharingGrantId] = useState<string | null>(null);
  const [shareNotes, setShareNotes] = useState('');
  const [colabViewMode, setColabViewMode] = useState<'consortia' | 'discover'>('consortia');
  const [colabSubTab, setColabSubTab] = useState<'chat' | 'shared_grants' | 'members'>('chat');

  // --- Toast state for quick user alerts ---
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Auto dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const triggerToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
  };

  // --- Restore the session from the refresh cookie on start ---
  useEffect(() => {
    onSessionExpired(() => {
      setUser(null);
      setAuthed(false);
      triggerToast('Your session has ended. Please sign in again.', 'info');
    });
    // Pasted into an open tab, a reset link only changes the hash: reload so
    // it takes the path below.
    window.addEventListener('hashchange', () => {
      if (window.location.hash.startsWith('#reset-password=')) window.location.reload();
    });
    // A password reset link opens the reset form even in a signed-in browser;
    // completing the reset signs every session out anyway.
    if (window.location.hash.startsWith('#reset-password=')) {
      setRestoringSession(false);
      return;
    }
    api
      .restoreSession()
      .then((restored) => {
        if (restored) {
          setUser(restored);
          setAuthed(true);
        }
      })
      .finally(() => setRestoringSession(false));
  }, []);

  // Load everything once a session exists
  useEffect(() => {
    if (authed) {
      fetchAllData();
    }
  }, [authed]);

  // Fetch detailed match evaluation when exploring in Details view
  useEffect(() => {
    if (!authed || !explorerSelectedGrantId || grantViewMode !== 'details') {
      setDetailsMatch(null);
      return;
    }

    let isMounted = true;
    setLoadingDetailsMatch(true);
    api
      .match(explorerSelectedGrantId)
      .then((m) => {
        if (isMounted) setDetailsMatch(m);
      })
      .catch((e) => console.error(e))
      .finally(() => {
        if (isMounted) setLoadingDetailsMatch(false);
      });
    return () => {
      isMounted = false;
    };
  }, [authed, explorerSelectedGrantId, grantViewMode]);

  const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
  const isSuperAdmin = user?.accessRole === 'super_admin';
  // The research office: grant officers and institution admins of an organization.
  const canUseOffice = !!user?.organizationId && (user.accessRole === 'grant_officer' || user.accessRole === 'institution_admin');

  // --- Collaboration Hub ---
  const fetchColabUsers = async (search = searchColabQuery, expertise = searchColabExpertise, institution = searchColabInstitution) => {
    if (!authed) return;
    setLoadingColab(true);
    try {
      setColabUsers(await api.collaborators({ search, expertise, institution }));
    } catch (err) {
      triggerToast(errorMessage(err, 'Could not load collaborators'), 'error');
    } finally {
      setLoadingColab(false);
    }
  };

  const fetchTeams = async () => {
    if (!authed) return;
    try {
      setTeams(await api.teams());
    } catch (err) {
      console.error('Error fetching teams', err);
    }
  };

  const fetchTeamDetails = async (teamId: string) => {
    if (!authed) return;
    const [members, messages, shared] = await Promise.allSettled([
      api.teamMembers(teamId),
      api.teamMessages(teamId),
      api.teamGrants(teamId),
    ]);
    if (members.status === 'fulfilled') setTeamMembers(members.value);
    if (messages.status === 'fulfilled') setTeamMessages(messages.value);
    if (shared.status === 'fulfilled') setTeamGrants(shared.value);
  };

  const createTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authed || !newTeamName.trim()) return;
    try {
      const team = await api.createTeam(newTeamName, newTeamDesc, newTeamPrivate);
      triggerToast(`Team "${team.name}" created successfully!`);
      setNewTeamName('');
      setNewTeamDesc('');
      setNewTeamPrivate(false);
      fetchTeams();
      setSelectedTeam(team);
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to create team'), 'error');
    }
  };

  const joinTeam = async (teamId: string) => {
    if (!authed) return;
    try {
      const team = await api.joinTeam(teamId);
      triggerToast(`Joined team "${team.name}"!`);
      fetchTeams();
      setSelectedTeam(team);
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to join team'), 'error');
    }
  };

  const leaveTeam = async (teamId: string) => {
    if (!authed) return;
    if (!confirm("Are you sure you want to leave this team?")) return;
    try {
      const res = await api.leaveTeam(teamId);
      triggerToast(res.message);
      fetchTeams();
      if (selectedTeam?.id === teamId) setSelectedTeam(null);
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to leave team'), 'error');
    }
  };

  const inviteMember = async (teamId: string, memberId: string) => {
    if (!authed) return;
    try {
      await api.addTeamMember(teamId, memberId);
      triggerToast("Collaborator added to team successfully!");
      fetchTeamDetails(teamId);
      fetchTeams();
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to add member'), 'error');
    }
  };

  const sendTeamMessage = async () => {
    if (!authed || !selectedTeam || !newMessageText.trim()) return;
    try {
      await api.sendTeamMessage(selectedTeam.id, newMessageText);
      setNewMessageText('');
      setTeamMessages(await api.teamMessages(selectedTeam.id));
    } catch (err) {
      triggerToast(errorMessage(err, 'Message not sent'), 'error');
    }
  };

  const shareGrantWithTeam = async (teamId: string, grantId: string, notesText: string) => {
    if (!authed) return;
    try {
      await api.shareGrant(teamId, grantId, notesText);
      triggerToast("Opportunity shared with team!");
      setSharingGrantId(null);
      setShareNotes('');
      if (selectedTeam?.id === teamId) fetchTeamDetails(teamId);
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to share opportunity'), 'error');
    }
  };

  const updateTeamGrantStatus = async (teamId: string, grantId: string, status: string) => {
    if (!authed) return;
    try {
      await api.setSharedGrantStatus(teamId, grantId, status);
      triggerToast("Application status updated!");
      fetchTeamDetails(teamId);
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to update status'), 'error');
    }
  };

  // Load the directory and teams when the hub opens (teams are also needed
  // by the "share with team" menus elsewhere, so load them once on sign-in).
  useEffect(() => {
    if (authed) fetchTeams();
  }, [authed]);
  useEffect(() => {
    if (authed && activeTab === 'collaboration') {
      fetchColabUsers();
      fetchTeams();
    }
  }, [authed, activeTab]);

  // Team chat: load everything when a team opens, then poll only for new
  // messages every 5 s, and not at all while the browser tab is hidden.
  const teamMessagesRef = React.useRef(teamMessages);
  useEffect(() => {
    teamMessagesRef.current = teamMessages;
  }, [teamMessages]);

  useEffect(() => {
    if (!authed || !selectedTeam) return;
    const teamId = selectedTeam.id;
    let cancelled = false;
    fetchTeamDetails(teamId);

    const poll = async () => {
      if (document.hidden) return;
      const last = teamMessagesRef.current[teamMessagesRef.current.length - 1]?.timestamp;
      try {
        const fresh = await api.teamMessages(teamId, last ? new Date(last).toISOString() : undefined);
        if (!cancelled && fresh.length > 0) {
          setTeamMessages(cur => {
            const seen = new Set(cur.map(m => m.id));
            return [...cur, ...fresh.filter(m => !seen.has(m.id))];
          });
        }
      } catch {
        /* transient; the next tick retries */
      }
    };
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authed, selectedTeam?.id]);

  const refreshApplications = async () => {
    const [apps, stats] = await Promise.allSettled([api.applications(), api.stats()]);
    if (apps.status === 'fulfilled') setApplications(apps.value);
    if (stats.status === 'fulfilled') setAnalytics(stats.value);
  };

  const fetchAllData = async () => {
    if (!authed) return;
    setLoadingGrants(true);
    setLoadingMatches(true);
    setLoadingAnalytics(true);

    const results = await Promise.allSettled([
      api.allGrants().then(setGrants),
      api.funders().then(setFunders),
      api.matches().then(setMatches),
      api.notifications().then(setNotifications),
      api.applications().then(setApplications),
      api.stats().then(setAnalytics),
      // Scraper runs are platform-admin data.
      isSuperAdmin ? api.scraperRuns().then(setScraperLogs) : Promise.resolve(setScraperLogs([])),
      isSuperAdmin ? api.scraperSources().then(setScraperSources) : Promise.resolve(setScraperSources([])),
      isSuperAdmin ? api.scraperSchedule().then(setScraperSchedule) : Promise.resolve(setScraperSchedule(null)),
    ]);
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) {
      console.error('Error loading application data', failure.reason);
      triggerToast(errorMessage(failure.reason, 'Some data could not be loaded.'), 'error');
    }

    setLoadingGrants(false);
    setLoadingMatches(false);
    setLoadingAnalytics(false);
  };

  // The toast lives in the signed-in layout, so the auth screen shows its
  // errors inline.
  const handleSignedIn = (signedIn: UserProfile, { created }: { created: boolean }) => {
    setUser(signedIn);
    setAuthed(true);
    if (created) {
      // Onboarding: documents first, so the first matches rest on evidence.
      setActiveTab('smart');
      triggerToast('Account created. Upload your CV or organisation profile to sharpen your matches.');
    } else {
      setActiveTab('dashboard');
      triggerToast(`Welcome back, ${signedIn.name}!`);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setAuthed(false);
    // Nothing from this account should linger for the next one.
    setGrants([]);
    setMatches([]);
    setNotifications([]);
    setApplications([]);
    setScraperLogs([]);
    setAnalytics(null);
    triggerToast("Logged out successfully.", "info");
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authed || !user) return;
    try {
      const updated = await api.updateProfile({
        ...user,
        researchInterests: Array.isArray(user.researchInterests) ? user.researchInterests : [],
      });
      setUser(updated);
      triggerToast("Scouting profile and match criteria updated!");
      // Refresh matching feed instantly with new weights
      fetchAllData();
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to update profile'), 'error');
    }
  };

  // --- Synchronization Effect for AI Assistant Prefills ---
  useEffect(() => {
    if (user) {
      if (!assistantPastProjects) setAssistantPastProjects(user.pastProjects || '');
      if (!assistantTeamMembers) setAssistantTeamMembers(user.teamMembers || '');
      if (!assistantResearchArea) setAssistantResearchArea(user.researchInterests.join(', ') || '');
    }
  }, [user]);

  // --- Run AI proposal assistant ---
  const handleRunAssistant = async (mode: AssistantMode = assistantMode) => {
    if (!assistantGrantId) {
      triggerToast("Please select a grant opportunity first.", "error");
      return;
    }
    setAssistantLoading(true);
    setAssistantResponse('');
    try {
      const res = await api.generate({
        grantId: assistantGrantId,
        mode,
        pastProjects: assistantPastProjects || undefined,
        teamMembers: assistantTeamMembers || undefined,
        researchArea: assistantResearchArea || undefined,
        draftText: assistantDraftText || undefined,
        // Runs are saved into the application once it is started.
        proposalId: assistantApp?.grant.id === assistantGrantId ? assistantApp.proposal?.id : undefined,
      });
      setAssistantResponse(res.text);
      if (res.savedTo) setAssistantRefresh((n) => n + 1);
      triggerToast(
        (res.isSimulated ? 'Template generated (AI model not configured on this server).' : 'AI Proposal assistant run completed!') +
          (res.savedTo ? ' Saved to your application.' : ''),
      );
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to generate assistance'), 'error');
    } finally {
      setAssistantLoading(false);
    }
  };

  // --- Apply: open the call in the AI Proposal Assistant, starting with its eligibility ---
  const handleOpenInAssistant = (grant: Grant) => {
    // Matches can include calls outside the loaded catalogue page.
    setGrants((prev) => (prev.some((g) => g.id === grant.id) ? prev : [grant, ...prev]));
    setAssistantGrantId(grant.id);
    setAssistantMode('eligibility');
    setAssistantApp(null);
    setAssistantDraftText('');
    setAssistantResponse('');

    if (user) {
      setAssistantPastProjects(user.pastProjects || '');
      setAssistantTeamMembers(user.teamMembers || '');
      setAssistantResearchArea(user.researchInterests.join(', ') || '');
    }

    setActiveTab('assistant');
    setSelectedGrant(null); // Close detail modal
    triggerToast(`Applying for "${grant.title}": check your eligibility, then start the application.`);
  };

  /** A step from the readiness panel: pick the mode and, except for the draft review, run it. */
  const handleAssistantStep = (mode: AssistantMode) => {
    setAssistantMode(mode);
    const saved = assistantApp?.proposal?.body?.drafts?.[mode];
    if (mode === 'feedback') {
      // Review the outline already drafted for this application, if any.
      const outline = assistantApp?.proposal?.body?.drafts?.outline?.text;
      if (outline && !assistantDraftText) setAssistantDraftText(outline);
      setAssistantResponse(saved?.text ?? '');
      document.getElementById('assistant-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (saved) {
      setAssistantResponse(saved.text);
      triggerToast('Showing your saved draft. Run it again to regenerate.', 'info');
    } else {
      void handleRunAssistant(mode);
    }
    document.getElementById('assistant-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Profile completeness, shown next to the match count on the dashboard.
  const [profileStrength, setProfileStrength] = useState<number | null>(null);
  useEffect(() => {
    if (!authed || activeTab !== 'dashboard') return;
    let cancelled = false;
    api.profile
      .get()
      .then(p => !cancelled && setProfileStrength(p.completeness.percent))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authed, activeTab, analytics?.matchedGrantsCount]);

  // --- Live dashboard ---
  // The API pushes a "change" event whenever the harvester, housekeeping or
  // an admin changes catalogue data; the dashboard re-fetches at once. A slow
  // poll and a refresh on tab focus cover midnight roll-overs (deadlines pass
  // with no write) and a dropped connection.
  const [liveState, setLiveState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [statsUpdatedAt, setStatsUpdatedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (analytics) setStatsUpdatedAt(Date.now());
  }, [analytics]);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    const refresh = () => {
      if (timer) return; // one refresh already queued
      const wait = Math.max(0, 3_000 - (Date.now() - last));
      timer = setTimeout(async () => {
        timer = undefined;
        last = Date.now();
        const [g, m, st] = await Promise.allSettled([api.allGrants(), api.matches(), api.stats()]);
        if (cancelled) return;
        if (g.status === 'fulfilled') setGrants(g.value);
        if (m.status === 'fulfilled') setMatches(m.value);
        if (st.status === 'fulfilled') setAnalytics(st.value);
      }, wait);
    };
    let source: EventSource | null = null;
    try {
      source = new EventSource('/api/grants/live');
      source.addEventListener('ready', () => setLiveState('live'));
      source.addEventListener('change', refresh);
      source.onerror = () => setLiveState('offline'); // EventSource reconnects by itself
    } catch {
      setLiveState('offline');
    }
    const poll = setInterval(refresh, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      source?.close();
    };
  }, [authed]);

  // Refresh the automatic-scan status while the scraper panel is open.
  useEffect(() => {
    if (!authed || !isSuperAdmin || activeTab !== 'scraper') return;
    const refresh = () => {
      api.scraperSchedule().then(setScraperSchedule).catch(() => {});
      api.scraperRuns().then(setScraperLogs).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [authed, isSuperAdmin, activeTab]);

  // --- Ask the harvester for a run (platform admins) ---
  const handleTriggerScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authed) return;
    if (!isSuperAdmin) {
      triggerToast('Only platform administrators can trigger a harvest.', 'error');
      return;
    }
    setRunningScrape(true);
    setScrapeSuccess(null);
    try {
      const res = await api.requestScrape(customScrapeSource || undefined);
      setScrapeSuccess(res.note);
      triggerToast('Harvest requested. New grants appear when the run finishes.');
      // The worker records the run; give it a moment, then reload the log.
      setTimeout(() => {
        api.scraperRuns().then(setScraperLogs).catch(() => {});
      }, 3000);
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to contact the harvester'), 'error');
    } finally {
      setRunningScrape(false);
    }
  };

  // --- Set up grant tracking ---
  const handleTrackGrant = async (grantId: string) => {
    if (!authed) return;
    try {
      await api.trackGrant(grantId, trackingStatus, trackingNotes);
      triggerToast(
        user?.organizationId && trackingStatus !== 'draft'
          ? 'Saved as a draft: proposals in your organisation go through review first.'
          : 'Grant added to Application Tracker.',
      );
      refreshApplications();
      setSelectedGrant(null); // close dialog
      setTrackingNotes('');
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to save tracking status.'), err instanceof ApiError && err.status === 409 ? 'info' : 'error');
    }
  };

  /** Moves a proposal to `status`; notes edits go through handleNotesChange. */
  const handleUpdateApplicationStatus = async (appId: string, status: ApplicationTracker['status'], notes: string) => {
    if (!authed) return;
    const app = applications.find(a => a.id === appId);
    if (!app || app.status === status) return;
    try {
      await api.transition(appId, status, notes && notes !== app.notes ? notes : undefined);
      triggerToast(`Application moved to [${status}].`);
    } catch (err) {
      triggerToast(errorMessage(err, 'Error updating application status.'), 'error');
    }
    refreshApplications();
  };

  // Notes are edited inline; save once typing pauses.
  const notesTimers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const handleNotesChange = (appId: string, notes: string) => {
    setApplications(prev => prev.map(a => (a.id === appId ? { ...a, notes } : a)));
    clearTimeout(notesTimers.current[appId]);
    notesTimers.current[appId] = setTimeout(() => {
      api.updateNotes(appId, notes).catch((err) => triggerToast(errorMessage(err, 'Could not save notes.'), 'error'));
    }, 800);
  };

  /** The next step the owner can take from the Draft column, given the workflow. */
  const nextOwnerAction = (app: ApplicationTracker): { label: string; to: ApplicationTracker['status'] | null } => {
    if (!app.orgId) return { label: 'Submit Proposal', to: 'submitted' };
    if (app.status === 'draft') return { label: 'Send for Review', to: 'review' };
    if (app.status === 'review') return { label: 'Awaiting Approval', to: null };
    return { label: 'Awaiting Submission', to: null };
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: 'draft' | 'submitted' | 'awarded' | 'rejected') => {
    e.preventDefault();
    setActiveDragOverColumn(null);
    setDraggedAppId(null);
    const appId = e.dataTransfer.getData("text/plain");
    if (!appId) return;

    const app = applications.find(a => a.id === appId);
    if (!app) return;

    if (app.status === targetStatus) return;

    await handleUpdateApplicationStatus(appId, targetStatus, app.notes || '');
  };

  const handleAddTimelineEvent = async (appId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!authed) return;
    if (!customTimelineEventNotes.trim()) {
      triggerToast("Please enter event comments or details.", "error");
      return;
    }
    const app = applications.find(a => a.id === appId);

    setIsAddingTimelineEvent(true);
    try {
      if (customTimelineEventStatus && customTimelineEventStatus !== app?.status) {
        await api.transition(appId, customTimelineEventStatus, customTimelineEventNotes);
      } else {
        await api.addNote(appId, customTimelineEventNotes);
      }
      triggerToast("New activity logged in timeline!");
      setCustomTimelineEventNotes('');
      setCustomTimelineEventStatus('');
      refreshApplications();
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to log timeline event.'), 'error');
    } finally {
      setIsAddingTimelineEvent(false);
    }
  };

  const handleDeleteApplication = async (appId: string) => {
    if (!authed) return;
    try {
      await api.deleteApplication(appId);
      triggerToast("Removed from tracking.");
      refreshApplications();
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to delete application.'), 'error');
    }
  };

  const handleMarkNotificationRead = async (id: string) => {
    if (!authed) return;
    try {
      await api.markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (e) {}
  };

  const handleMarkAllNotificationsRead = async () => {
    if (!authed) return;
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      triggerToast("All notifications marked as read.");
    } catch (e) {}
  };

  // --- Open Detailed Modal with Match Evaluation ---
  const handleOpenGrantDetail = async (grant: Grant) => {
    setSelectedGrant(grant);
    setSelectedMatch(null);
    if (!authed) return;

    setLoadingDetailMatch(true);
    try {
      setSelectedMatch(await api.match(grant.id));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetailMatch(false);
    }
  };

  // Opens another edition of a call (from the call history or a "repeated" badge).
  const openGrantById = (grantId: string) => {
    const g = grants.find(x => x.id === grantId);
    if (g) handleOpenGrantDetail(g);
    else triggerToast('That edition is not in the loaded catalogue.', 'info');
  };

  // --- Save Match Relevance Feedback ---
  const handleSaveFeedback = async (grantId: string, feedback: 'relevant' | 'not_relevant' | null) => {
    if (!authed) return;
    try {
      await api.saveFeedback(grantId, feedback);
      triggerToast("Feedback captured! Continuously re-ranking match recommendations...");
      if (selectedMatch) {
        setSelectedMatch(prev => prev ? { ...prev, feedback } : null);
      }
      api.matches().then(setMatches).catch(() => {});
      api.stats().then(setAnalytics).catch(() => {});
    } catch (err) {
      triggerToast(errorMessage(err, 'Failed to save match feedback'), 'error');
    }
  };

  // --- Archive expired calls (super admin) ---
  const lifecycleCounts = useMemo(() => {
    const counts: Record<GrantLifecycle, number> = { active: 0, expired: 0, archived: 0 };
    for (const g of grants) counts[g.lifecycle]++;
    return counts;
  }, [grants]);

  const handleArchiveGrant = async (grant: Grant, restore = false) => {
    setArchivingGrantId(grant.id);
    try {
      const updated = restore ? await api.restoreGrant(grant.id) : await api.archiveGrant(grant.id);
      setGrants(prev => prev.map(g => (g.id === updated.id ? updated : g)));
      triggerToast(restore ? `Restored "${grant.title}" to expired calls` : `Archived "${grant.title}"`);
      api.stats().then(setAnalytics).catch(() => {});
    } catch (err) {
      triggerToast(errorMessage(err, restore ? 'Could not restore the call' : 'Could not archive the call'), 'error');
    } finally {
      setArchivingGrantId(null);
    }
  };

  const handleArchiveAllExpired = async () => {
    const n = lifecycleCounts.expired;
    if (n === 0) return;
    if (!window.confirm(`Archive all ${n} expired calls? They leave the expired list but can be restored from Archived.`)) return;
    setBulkArchiving(true);
    try {
      const archived = await api.archiveExpiredGrants();
      triggerToast(`Archived ${archived} expired call${archived === 1 ? '' : 's'}`);
      const [fresh, stats] = await Promise.all([api.allGrants(), api.stats()]);
      setGrants(fresh);
      setAnalytics(stats);
    } catch (err) {
      triggerToast(errorMessage(err, 'Could not archive expired calls'), 'error');
    } finally {
      setBulkArchiving(false);
    }
  };

  // --- Computed Filters for Grant Explorer ---
  const filteredGrantsBeforeMatchFilter = useMemo(() => {
    return grants.filter(g => {
      // Lifecycle: active / expired / archived
      if (g.lifecycle !== grantLifecycleView) return false;

      // Search Box
      const matchesSearch = searchQuery === '' || 
        g.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.funderName.toLowerCase().includes(searchQuery.toLowerCase());

      // Category
      const matchesCategory = selectedCategory === 'all' || g.category.toLowerCase() === selectedCategory.toLowerCase();

      // Funder
      const matchesFunder = selectedFunder === 'all' || g.funderId === selectedFunder;

      // Region
      // Africa is decided by meaning (shared/regions.ts); the rest by region name.
      const matchesRegion =
        selectedRegion === 'all' ||
        (REGION_FILTERS.some(f => f.id === selectedRegion)
          ? grantMatchesRegionFilter(g.eligibleRegions, selectedRegion)
          : g.eligibleRegions.some(r => r.toLowerCase().includes(selectedRegion.toLowerCase())));

      // Org Type
      const matchesOrg = selectedOrgType === 'all' || g.eligibleOrgTypes.some(o => o.toLowerCase().includes(selectedOrgType.toLowerCase()));

      return matchesSearch && matchesCategory && matchesFunder && matchesRegion && matchesOrg;
    });
  }, [grants, grantLifecycleView, searchQuery, selectedCategory, selectedFunder, selectedRegion, selectedOrgType]);

  const filteredGrants = useMemo(() => {
    return filteredGrantsBeforeMatchFilter.filter(g => {
      if (matchFilterMode === 'high') {
        const matchedScoreObj = matches.find(m => m.grantId === g.id);
        const score = matchedScoreObj?.matchScore ?? 70;
        return score >= 85;
      }
      return true;
    });
  }, [filteredGrantsBeforeMatchFilter, matchFilterMode, matches]);

  const highMatchCount = useMemo(() => {
    return filteredGrantsBeforeMatchFilter.filter(g => {
      const matchedScoreObj = matches.find(m => m.grantId === g.id);
      const score = matchedScoreObj?.matchScore ?? 70;
      return score >= 85;
    }).length;
  }, [filteredGrantsBeforeMatchFilter, matches]);

  // Unread notifications count
  const unreadCount = useMemo(() => {
    return notifications.filter(n => !n.read).length;
  }, [notifications]);

  const fundingTrends = useMemo(() => buildFundingTrends(grants, clock), [grants, clock]);
  const trendKey: keyof TrendPoint =
    trendCategory === 'all' ? 'funding' : trendCategory === 'activeGrants' ? 'activeGrants' : (trendCategory as keyof TrendPoint);
  const trendExtremes = useMemo(() => {
    const ranked = [...fundingTrends].sort((a, b) => (b[trendKey] as number) - (a[trendKey] as number));
    const withData = ranked.filter(p => (p[trendKey] as number) > 0);
    return { peaks: withData.slice(0, 2).map(p => p.month), low: ranked[ranked.length - 1]?.month ?? '—' };
  }, [fundingTrends, trendKey]);

  // Critical countdown list: open calls closing within CRITICAL_DEADLINE_DAYS, soonest first.
  const sortedUpcomingDeadlines = useMemo(() => {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date(clock);
    const from = iso(today);
    const to = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + CRITICAL_DEADLINE_DAYS));
    return grants
      .filter(g => g.lifecycle === 'active' && g.deadline && g.deadline >= from && g.deadline <= to)
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .slice(0, 4);
  }, [grants, clock]);

  if (restoringSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB]" aria-busy="true">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" aria-label="Restoring your session" />
      </div>
    );
  }

  // Signed out: the landing page doubles as sign-in and registration.
  if (!authed || !user) {
    return <AuthLanding onSignedIn={handleSignedIn} />;
  }

  // Define dynamic colors based on user role to make the UI feel highly tailored!
  const roleColorTheme = {
    academic: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', solid: 'bg-emerald-600' },
    industry: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', solid: 'bg-indigo-600' },
    student: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', solid: 'bg-purple-600' }
  }[user.role];

  // --- Derived Tracked Applications sorted by Deadline ---
  // The Draft column also holds proposals in review or approved: they are
  // still in progress, waiting on the research office.
  const getSortedAppsByStatus = (status: 'draft' | 'submitted' | 'awarded' | 'rejected') => {
    return [...applications]
      .filter(a => a.status === status || (status === 'draft' && (a.status === 'review' || a.status === 'approved')))
      .sort((a, b) => {
        const dateA = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const dateB = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        const valA = isNaN(dateA) ? Infinity : dateA;
        const valB = isNaN(dateB) ? Infinity : dateB;
        return valA - valB;
      });
  };

  // --- Dynamic Task Progression Bar Parser & Renderer ---
  const renderTaskProgressBar = (notes: string) => {
    const rawNotes = notes || '';
    const lines = rawNotes.split('\n');
    let total = 0;
    let completed = 0;
    
    // Regex for markdown style checklists: - [ ] or - [x]
    const taskRegex = /^\s*[-*+0-9.]*\s*\[([ xX])\]/;
    
    for (const line of lines) {
      const match = line.match(taskRegex);
      if (match) {
        total++;
        if (match[1].toLowerCase() === 'x') {
          completed++;
        }
      }
    }
    
    if (total === 0) {
      return (
        <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between items-center text-[9px] text-gray-400">
            <span>Tasks (0/0)</span>
            <span className="font-mono text-[8px] italic">Use - [ ] to list tasks</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1">
            <div className="h-1 bg-gray-200 rounded-full w-0" />
          </div>
        </div>
      );
    }
    
    const percent = Math.round((completed / total) * 100);
    
    let barColor = 'bg-red-500';
    let textColor = 'text-red-600 bg-red-50 border-red-100';
    
    if (percent >= 100) {
      barColor = 'bg-emerald-500';
      textColor = 'text-emerald-700 bg-emerald-50 border-emerald-100';
    } else if (percent >= 70) {
      barColor = 'bg-blue-500';
      textColor = 'text-blue-600 bg-blue-50 border-blue-100';
    } else if (percent >= 30) {
      barColor = 'bg-amber-500';
      textColor = 'text-amber-600 bg-amber-50 border-amber-100';
    }
    
    return (
      <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center text-[9px] font-bold">
          <span className="text-gray-500">Task Checklist</span>
          <span className={`px-1 rounded border text-[8px] font-mono ${textColor}`}>
            {completed}/{total} ({percent}%)
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div 
            className={`h-1.5 rounded-full transition-all duration-300 ${barColor}`} 
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen w-screen bg-[#F9FAFB] text-[#111827] font-sans overflow-hidden">
      
      {/* Toast Alert Widget */}
      {toast && (
        <div id="global-toast" className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border bg-white border-gray-100 max-w-sm transition-all animate-bounce">
          <div className={`w-2 h-2 rounded-full ${toast.type === 'success' ? 'bg-green-500' : toast.type === 'error' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
          <p className="text-xs font-medium text-gray-700">{toast.message}</p>
        </div>
      )}

      {/* --- Left Sidebar Navigation --- */}
      {navOpen && <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside
        id="sidebar"
        className={`w-64 bg-white border-r border-gray-200 flex flex-col shrink-0 fixed inset-y-0 left-0 z-40 transition-transform md:static md:translate-x-0 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="p-6 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-extrabold text-lg shadow-sm">G</div>
          <div className="flex flex-col">
            <span className="font-bold tracking-tight text-base leading-none text-gray-900">GrantSeeker</span>
            <span className="text-[10px] text-gray-400 font-semibold tracking-wider mt-0.5">INTELLIGENCE V2.4</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
          <button
            id="nav-dashboard"
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'dashboard' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Activity className="w-4 h-4 mr-3 shrink-0 text-blue-600" />
            Intelligence Dashboard
          </button>

          <button
            id="nav-explorer"
            onClick={() => { setActiveTab('explorer'); setSearchQuery(''); }}
            className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'explorer' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Search className="w-4 h-4 mr-3 shrink-0 text-gray-500" />
            Grant Explorer
          </button>

          <button
            id="nav-smart"
            onClick={() => setActiveTab('smart')}
            aria-current={activeTab === 'smart' ? 'page' : undefined}
            className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'smart' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Target className="w-4 h-4 mr-3 shrink-0 text-emerald-600" aria-hidden="true" />
            Smart Profile &amp; Matches
          </button>

          <button
            id="nav-assistant"
            onClick={() => setActiveTab('assistant')}
            className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'assistant' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Sparkles className="w-4 h-4 mr-3 shrink-0 text-amber-500 animate-pulse" />
            AI Proposal Assistant
          </button>

          <button
            id="nav-tracker"
            onClick={() => setActiveTab('tracker')}
            className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'tracker' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Layers className="w-4 h-4 mr-3 shrink-0 text-gray-500" />
            My Saved Applications
            {applications.length > 0 && (
              <span className="ml-auto bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-full font-bold">{applications.length}</span>
            )}
          </button>

          {canUseOffice && (
            <button
              id="nav-office"
              onClick={() => setActiveTab('office')}
              aria-current={activeTab === 'office' ? 'page' : undefined}
              className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'office' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Briefcase className="w-4 h-4 mr-3 shrink-0 text-gray-500" aria-hidden="true" />
              Research Office
            </button>
          )}

          <button
            id="nav-collaboration"
            onClick={() => setActiveTab('collaboration')}
            className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'collaboration' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Users className="w-4 h-4 mr-3 shrink-0 text-blue-600" />
            Collaboration Hub
            {teams.length > 0 && (
              <span className="ml-auto bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold">{teams.length}</span>
            )}
          </button>

          <button
            id="nav-notifications"
            onClick={() => setActiveTab('notifications')}
            className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'notifications' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Bell className="w-4 h-4 mr-3 shrink-0 text-gray-500" />
            Notification Hub
            {unreadCount > 0 && (
              <span id="unread-notif-badge" className="ml-auto bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">{unreadCount}</span>
            )}
          </button>

          <button
            id="nav-scraper"
            onClick={() => setActiveTab('scraper')}
            className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'scraper' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Terminal className="w-4 h-4 mr-3 shrink-0 text-gray-500" />
            AI Web Scraper Panel
          </button>

          <button
            id="nav-profile"
            onClick={() => setActiveTab('profile')}
            className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'profile' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <User className="w-4 h-4 mr-3 shrink-0 text-gray-500" />
            Match Profile Settings
          </button>
        </nav>

        {/* General settings, pinned to the bottom-left corner. */}
        <div className="p-4 border-t border-gray-100">
          <button
            id="nav-settings"
            onClick={() => setActiveTab('settings')}
            aria-current={activeTab === 'settings' ? 'page' : undefined}
            className={`w-full flex items-center px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${activeTab === 'settings' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Settings className="w-4 h-4 mr-3 shrink-0 text-gray-500" aria-hidden="true" />
            Settings
          </button>
        </div>
      </aside>

      {/* --- Main Content Area --- */}
      <main className="flex-1 flex flex-col overflow-hidden">
        
        {/* --- Top Header bar --- */}
        <header className="h-16 bg-white border-b border-gray-200 px-4 md:px-8 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="md:hidden p-2 -ml-2 text-gray-500 hover:text-gray-800"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            aria-controls="sidebar"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
          <div className="flex items-center flex-1 max-w-lg min-w-0">
            <div className="relative w-full">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                id="header-global-search"
                className="block w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg leading-5 bg-gray-50 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition-all"
                placeholder="Global Grant Scouting query..."
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (activeTab !== 'explorer') setActiveTab('explorer');
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 md:gap-6">
            <div className="hidden sm:flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${roleColorTheme.bg} ${roleColorTheme.text} border ${roleColorTheme.border}`}>
                {user.role === 'academic' ? 'Academic Researcher' : user.role === 'student' ? 'Graduate Student' : 'Industry Professional'}
              </span>
            </div>

            <div className="flex items-center gap-4">
              {/* Notification Quick Bell */}
              <button 
                id="header-bell"
                onClick={() => setActiveTab('notifications')}
                className="relative p-2 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 block h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white"></span>
                )}
              </button>

              <AccountMenu name={user.name} email={user.email} onProfile={() => setActiveTab('profile')} onSignOut={handleLogout} />
            </div>
          </div>
        </header>

        {/* --- Dynamic Route Subviews --- */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8">
          
          {/* ==================== SUBVIEW: DASHBOARD ==================== */}
          {activeTab === 'dashboard' && (
            <div id="subview-dashboard" className="space-y-8">
              {/* Greeting */}
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-2xl font-black text-gray-900 tracking-tight">Intelligence Dashboard</h1>
                  <p className="text-gray-500 text-sm mt-1">
                    AI agents are tracking <span className="font-semibold text-gray-900">{analytics?.totalActiveGrants ?? lifecycleCounts.active} open calls</span> from <span className="font-semibold text-gray-900">{analytics?.activeFundersCount ?? 0} funders</span>
                    {analytics?.newThisWeekCount ? <> &middot; <span className="font-semibold text-emerald-700">{analytics.newThisWeekCount} new this week</span></> : null}.
                  </p>
                  {/* Matching is scored against the user's whole profile (qualifications,
                      track record, documents, eligibility), so say how strong that is. */}
                  <p id="dashboard-profile-match" className="text-gray-500 text-xs mt-1">
                    Scored against your full profile
                    {profileStrength != null && (
                      <>
                        {' '}(<span className={`font-semibold ${profileStrength >= 80 ? 'text-emerald-700' : profileStrength >= 50 ? 'text-amber-700' : 'text-rose-700'}`}>{profileStrength}% complete</span>)
                      </>
                    )}
                    {' '}&middot; <span className="font-semibold text-gray-900">{analytics?.matchedGrantsCount ?? 0} strong matches</span>
                    {profileStrength != null && profileStrength < 80 && (
                      <>
                        {' '}&middot;{' '}
                        <button
                          type="button"
                          onClick={() => setActiveTab('smart')}
                          className="font-semibold text-blue-600 hover:underline cursor-pointer"
                        >
                          Strengthen your profile for better matches
                        </button>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex gap-4">
                  <div className="bg-white px-4 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col min-w-[130px]">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">ACTIVE AGENTS</span>
                    <span className="text-lg font-black text-gray-900 mt-1 flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${analytics?.harvest?.running ? 'bg-blue-500 animate-pulse' : analytics?.harvest?.lastRunStatus === 'failed' ? 'bg-red-500' : analytics?.harvest?.lastRunStatus === 'partial' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        aria-hidden="true"
                      />
                      {analytics?.harvest ? `${analytics.harvest.sourcesCount} sources` : '—'}
                    </span>
                    <span className="text-[10px] text-gray-400 font-semibold mt-0.5">
                      {analytics?.harvest?.running
                        ? 'Scanning now…'
                        : analytics?.harvest?.lastRunAt
                          ? `Last scan ${timeAgo(analytics.harvest.lastRunAt, clock)}${analytics.harvest.lastRunStatus === 'failed' ? ' (failed)' : analytics.harvest.lastRunStatus === 'partial' ? ' (partial)' : ''}`
                          : 'No scans yet'}
                    </span>
                  </div>
                  <div className="bg-white px-4 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col min-w-[130px]">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">TOP SCORE MATCH</span>
                    <span className="text-lg font-black text-blue-600 mt-1">
                      {matches.length > 0 ? `${matches[0].matchScore}%` : 'Evaluating'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Layout Toggle Bar */}
              <div id="dashboard-layout-bar" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/50 border border-gray-200/80 rounded-xl p-3 shadow-xs">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                  <span className="text-xs font-extrabold text-gray-700">Layout Mode:</span>
                  <span className="text-[11px] text-gray-500 font-semibold">
                    {dashboardLayout === 'compact' ? 'High-level analytics & trends' : 'Comprehensive lists, deadlines & recent activities'}
                  </span>
                  <span
                    id="dashboard-live-status"
                    className={`ml-2 inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${liveState === 'live' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-gray-500 bg-gray-50 border-gray-200'}`}
                    title={liveState === 'live' ? 'Figures update as soon as the agents change the catalogue' : 'Live updates paused; figures refresh every 5 minutes'}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${liveState === 'live' ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} aria-hidden="true" />
                    {liveState === 'live' ? 'Live' : liveState === 'connecting' ? 'Connecting' : 'Reconnecting'}
                    {statsUpdatedAt && <span className="font-semibold text-gray-500">· updated {timeAgo(statsUpdatedAt, clock)}</span>}
                  </span>
                </div>
                <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5 shadow-xs shrink-0 self-start sm:self-auto">
                  <button
                    id="btn-layout-compact"
                    onClick={() => setDashboardLayout('compact')}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${dashboardLayout === 'compact' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Compact View
                  </button>
                  <button
                    id="btn-layout-detailed"
                    onClick={() => setDashboardLayout('detailed')}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${dashboardLayout === 'detailed' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    Detailed View
                  </button>
                </div>
              </div>

              {/* Stat Bento Row */}
              <div className="grid grid-cols-5 gap-4">
                <div className="bg-white p-5 rounded-xl border border-gray-200 flex items-start gap-4 shadow-sm hover:border-gray-300 transition-colors">
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Available Pool</span>
                    <h3 className="text-xl font-extrabold text-gray-900 mt-0.5">
                      ${Math.round(analytics?.totalFundingAvailable ?? 0).toLocaleString()}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      {analytics?.totalActiveGrants ?? 0} open calls · {analytics?.fundedGrantsCount ?? 0} state an amount
                    </p>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-gray-200 flex items-start gap-4 shadow-sm hover:border-gray-300 transition-colors">
                  <div className="p-3 bg-green-50 text-green-600 rounded-lg">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Avg Award Size</span>
                    <h3 className="text-xl font-extrabold text-gray-900 mt-0.5">
                      ${Math.round(analytics?.averageGrantAmount ?? 0).toLocaleString()}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">Average across {analytics?.fundedGrantsCount ?? 0} open calls</p>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-gray-200 flex items-start gap-4 shadow-sm hover:border-gray-300 transition-colors">
                  <div className="p-3 bg-orange-50 text-orange-600 rounded-lg">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Critical Deadlines</span>
                    <h3 className="text-xl font-extrabold text-gray-900 mt-0.5">
                      {analytics?.upcomingDeadlinesCount ?? 0} Grants
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      Due within {analytics?.criticalDeadlineDays ?? CRITICAL_DEADLINE_DAYS} days · {analytics?.dueThisWeekCount ?? 0} this week
                    </p>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-gray-200 flex items-start gap-4 shadow-sm hover:border-gray-300 transition-colors">
                  <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Application success</span>
                    <h3 className="text-xl font-extrabold text-gray-900 mt-0.5">
                      {analytics?.successRate != null ? `${analytics.successRate}%` : '—'}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">From tracked logs</p>
                  </div>
                </div>

                <button
                  id="stat-expired-calls"
                  type="button"
                  onClick={() => {
                    setGrantLifecycleView('expired');
                    setActiveTab('explorer');
                  }}
                  title="Review expired calls in the Grant Explorer"
                  className="text-left bg-white p-5 rounded-xl border border-gray-200 flex items-start gap-4 shadow-sm hover:border-rose-300 transition-colors cursor-pointer"
                >
                  <div className="p-3 bg-rose-50 text-rose-600 rounded-lg">
                    <CalendarX className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Expired Calls</span>
                    <h3 className="text-xl font-extrabold text-gray-900 mt-0.5">
                      {analytics?.expiredGrantsCount ?? 0} Grants
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      Ended ≤{ARCHIVE_AFTER_DAYS} days ago · {analytics?.archivingSoonCount ?? 0} archive this week · {analytics?.archivedGrantsCount ?? 0} archived
                    </p>
                  </div>
                </button>
              </div>

              {/* Main Grid: Left Matches, Right Deadlines */}
              {dashboardLayout === 'detailed' ? (
                <div className="grid grid-cols-12 gap-8">
                  
                  {/* Left: Top AI Matches */}
                  <div className="col-span-8 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden shadow-sm">
                    <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                      <div>
                        <h3 className="font-extrabold text-sm text-gray-900">AI-Optimized Funding Matches</h3>
                        <p className="text-xs text-gray-400">Scored dynamically via Gemini-2.5-Flash integration</p>
                      </div>
                      <button 
                        id="dashboard-view-all-explorer"
                        onClick={() => setActiveTab('explorer')}
                        className="text-xs text-blue-600 font-bold hover:underline cursor-pointer"
                      >
                        View All Listings &rarr;
                      </button>
                    </div>

                    {loadingMatches ? (
                      <div className="flex-1 py-16 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                        <p className="text-xs text-gray-500 font-semibold">Running agent similarity matrices...</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {matches.slice(0, 5).map((matchItem) => {
                          const score = matchItem.matchScore;
                          const scoreColor = score >= 85 ? 'text-green-600 bg-green-50 border-green-200' : score >= 70 ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-gray-500 bg-gray-50 border-gray-200';
                          const scoreTag = score >= 85 ? 'High Match' : score >= 70 ? 'Highly Relevant' : 'Moderate Alignment';

                          return (
                            <div 
                              key={matchItem.grantId} 
                              onClick={() => handleOpenGrantDetail(matchItem.grant)}
                              className="p-5 hover:bg-gray-50/80 transition-all flex items-start justify-between cursor-pointer group"
                            >
                              <div className="flex gap-4">
                                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center font-bold text-gray-700 text-xs shrink-0 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                                  {matchItem.grant.funderName.substring(0, 3).toUpperCase()}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <h4 className="font-extrabold text-sm text-gray-900 group-hover:text-blue-600 transition-colors leading-tight">
                                      {matchItem.grant.title}
                                    </h4>
                                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${scoreColor}`}>
                                      {scoreTag}
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-500 line-clamp-2 max-w-xl">
                                    {matchItem.grant.description}
                                  </p>
                                  <div className="flex gap-4 text-[10px] text-gray-400 font-semibold mt-3 flex-wrap">
                                    <span className="flex items-center gap-1"><DollarSign className="w-3 h-3 text-gray-500" /> ${matchItem.grant.fundingAmount.toLocaleString()} Cap</span>
                                    <span>•</span>
                                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3 text-gray-500" /> Deadline: {matchItem.grant.deadline}</span>
                                    <span>•</span>
                                    <span className="flex items-center gap-1"><Globe className="w-3 h-3 text-gray-500" /> {matchItem.grant.eligibleRegions[0]}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right shrink-0 ml-4">
                                <div className="text-2xl font-black text-blue-600 tracking-tight leading-none">
                                  {score}%
                                </div>
                                <div className="text-[9px] uppercase text-gray-400 font-extrabold tracking-wider mt-1">Match Score</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right Column */}
                  <div className="col-span-4 flex flex-col gap-8">
                    
                    {/* Visual: Donut Category Distribution */}
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col">
                      <h3 className="font-extrabold text-sm text-gray-900">Grant Portfolios</h3>
                      <p className="text-xs text-gray-400 mb-4">Subject alignment breakdown</p>
                      
                      <div className="space-y-3">
                        {[
                          { name: 'Technology & AI', count: grants.filter(g => g.category === 'Technology').length, color: 'bg-blue-500' },
                          { name: 'Health & Medicine', count: grants.filter(g => g.category === 'Health').length, color: 'bg-emerald-500' },
                          { name: 'Energy & Climate', count: grants.filter(g => g.category === 'Energy').length, color: 'bg-amber-500' },
                          { name: 'Social Sciences', count: grants.filter(g => g.category === 'Social Sciences').length, color: 'bg-pink-500' },
                          { name: 'Education Research', count: grants.filter(g => g.category === 'Education').length, color: 'bg-purple-500' }
                        ].map((cat, idx) => {
                          const total = grants.length || 1;
                          const pct = Math.round((cat.count / total) * 100);
                          return (
                            <div key={idx} className="space-y-1">
                              <div className="flex justify-between text-xs font-semibold">
                                <span className="flex items-center gap-2">
                                  <span className={`w-2.5 h-2.5 rounded-full ${cat.color}`}></span>
                                  {cat.name}
                                </span>
                                <span className="text-gray-500">{pct}% ({cat.count})</span>
                              </div>
                              <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                                <div className={`h-full ${cat.color}`} style={{ width: `${pct}%` }}></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Upcoming Critical Deadlines Countdown */}
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col">
                      <h3 className="font-extrabold text-sm text-gray-900">Urgent Deadlines</h3>
                      <p className="text-xs text-gray-400 mb-4">Urgency evaluation list</p>

                      <div className="space-y-4">
                        {sortedUpcomingDeadlines.map((g) => {
                          const today = new Date();
                          const diff = new Date(g.deadline).getTime() - today.getTime();
                          const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
                          
                          let badgeColor = 'bg-gray-100 text-gray-700';
                          if (days <= 5) badgeColor = 'bg-red-50 text-red-600 border border-red-200 animate-pulse';
                          else if (days <= 30) badgeColor = 'bg-orange-50 text-orange-600 border border-orange-200';

                          return (
                            <div 
                              key={g.id} 
                              onClick={() => handleOpenGrantDetail(g)}
                              className="flex items-start justify-between gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-all border border-transparent hover:border-gray-100"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-gray-900 truncate leading-tight">{g.title}</p>
                                <p className="text-[10px] text-gray-400 mt-1">{g.funderName.split(' (')[0]}</p>
                              </div>
                              <span className={`text-[10px] font-extrabold px-2 py-1 rounded shrink-0 ${badgeColor}`}>
                                {days <= 0 ? 'Closed' : `In ${days} days`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                </div>
              ) : (
                /* Compact View: Premium grid-based presentation of Category Distribution (No list clutter) */
                <div className="grid grid-cols-12 gap-8">
                  <div className="col-span-12 bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col">
                    <h3 className="font-extrabold text-sm text-gray-900">Active Grant Portfolios</h3>
                    <p className="text-xs text-gray-400 mb-5">Subject alignment breakdown of currently scanned funding opportunities</p>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      {[
                        { name: 'Technology & AI', count: grants.filter(g => g.category === 'Technology').length, color: 'bg-blue-500', bg: 'bg-blue-50/50', border: 'border-blue-100' },
                        { name: 'Health & Medicine', count: grants.filter(g => g.category === 'Health').length, color: 'bg-emerald-500', bg: 'bg-emerald-50/50', border: 'border-emerald-100' },
                        { name: 'Energy & Climate', count: grants.filter(g => g.category === 'Energy').length, color: 'bg-amber-500', bg: 'bg-amber-50/50', border: 'border-amber-100' },
                        { name: 'Social Sciences', count: grants.filter(g => g.category === 'Social Sciences').length, color: 'bg-pink-500', bg: 'bg-pink-50/50', border: 'border-pink-100' },
                        { name: 'Education Research', count: grants.filter(g => g.category === 'Education').length, color: 'bg-purple-500', bg: 'bg-purple-50/50', border: 'border-purple-100' }
                      ].map((cat, idx) => {
                        const total = grants.length || 1;
                        const pct = Math.round((cat.count / total) * 100);
                        return (
                          <div key={idx} className={`${cat.bg} border ${cat.border} p-4 rounded-xl flex flex-col justify-between min-h-[110px]`}>
                            <div className="flex justify-between items-start">
                              <span className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5">
                                <span className={`w-2.5 h-2.5 rounded-full ${cat.color} shrink-0`}></span>
                                {cat.name.split(' & ')[0]}
                              </span>
                              <span className="text-[11px] font-black text-gray-500">{pct}%</span>
                            </div>
                            <div className="mt-4">
                              <div className="text-xl font-black text-gray-950">
                                {cat.count} <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Active</span>
                              </div>
                              <div className="w-full bg-gray-200/70 h-2 rounded-full overflow-hidden mt-1.5">
                                <div className={`h-full ${cat.color}`} style={{ width: `${pct}%` }}></div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* 12-Month Seasonal Funding Trends Chart Section */}
              <div id="dashboard-funding-trends" className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
                  <div>
                    <h3 className="font-extrabold text-base text-gray-900 flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-blue-600" />
                      12-Month Funding Trends & Seasonality Tracker
                    </h3>
                    <p className="text-xs text-gray-400">
                      Historical analysis of monthly grant capital volume and active opportunities to identify seasonal peaks.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {/* Filter Category */}
                    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1">
                      <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Metrics:</span>
                      <select
                        id="trends-metric-select"
                        value={trendCategory}
                        onChange={(e) => setTrendCategory(e.target.value as any)}
                        className="text-xs bg-transparent border-none font-semibold text-gray-700 focus:outline-none focus:ring-0 p-0.5 cursor-pointer"
                      >
                        <option value="all">Total Capital Vol</option>
                        <option value="Tech">Tech & AI Vol</option>
                        <option value="Health">Health & Medicine Vol</option>
                        <option value="Energy">Energy & Climate Vol</option>
                        <option value="activeGrants">Active Grants Count</option>
                      </select>
                    </div>

                    {/* Chart Type Toggle */}
                    <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-gray-50 p-0.5">
                      <button
                        id="trends-chart-area"
                        onClick={() => setTrendChartType('area')}
                        className={`px-3 py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${trendChartType === 'area' ? 'bg-white text-blue-600 shadow-xs border border-gray-200/50' : 'text-gray-500 hover:text-gray-950'}`}
                      >
                        Area
                      </button>
                      <button
                        id="trends-chart-bar"
                        onClick={() => setTrendChartType('bar')}
                        className={`px-3 py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${trendChartType === 'bar' ? 'bg-white text-blue-600 shadow-xs border border-gray-200/50' : 'text-gray-500 hover:text-gray-950'}`}
                      >
                        Bar
                      </button>
                      <button
                        id="trends-chart-line"
                        onClick={() => setTrendChartType('line')}
                        className={`px-3 py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${trendChartType === 'line' ? 'bg-white text-blue-600 shadow-xs border border-gray-200/50' : 'text-gray-500 hover:text-gray-950'}`}
                      >
                        Line
                      </button>
                    </div>
                  </div>
                </div>

                {/* Key Insights Row */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl">
                    <span className="text-[10px] font-extrabold text-blue-500 uppercase tracking-wider block">Peak Months</span>
                    <span className="text-sm font-black text-blue-900 mt-1 block">{trendExtremes.peaks.length ? trendExtremes.peaks.join(' & ') : 'No data yet'}</span>
                    <p className="text-[11px] text-blue-700/80 mt-1 leading-relaxed">
                      Months with the most deadlines in the 12-month window, from calls the agents found.
                    </p>
                  </div>
                  <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-xl">
                    <span className="text-[10px] font-extrabold text-amber-600 uppercase tracking-wider block">Quietest Month</span>
                    <span className="text-sm font-black text-amber-900 mt-1 block">{trendExtremes.low}</span>
                    <p className="text-[11px] text-amber-700/80 mt-1 leading-relaxed">
                      Fewest deadlines in the window: a good time to prepare proposals ahead of busier months.
                    </p>
                  </div>
                  <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl">
                    <span className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-wider block">12-Month Total</span>
                    <span className="text-sm font-black text-emerald-900 mt-1 block">
                      {trendCategory === 'activeGrants' 
                        ? `${fundingTrends.reduce((sum, item) => sum + item.activeGrants, 0)} Opportunities`
                        : `$${(fundingTrends.reduce((sum, item) => {
                            if (trendCategory === 'all') return sum + item.funding;
                            if (trendCategory === 'Tech') return sum + item.Tech;
                            if (trendCategory === 'Health') return sum + item.Health;
                            if (trendCategory === 'Energy') return sum + item.Energy;
                            return sum;
                          }, 0) / 1000000).toFixed(1)}M Capital`
                      }
                    </span>
                    <p className="text-[11px] text-emerald-700/80 mt-1 leading-relaxed">
                      Calls with deadlines in this window, open, expired and archived.
                    </p>
                  </div>
                  <div className="bg-purple-50/50 border border-purple-100 p-4 rounded-xl">
                    <span className="text-[10px] font-extrabold text-purple-600 uppercase tracking-wider block">Scraper Status</span>
                    <span className="text-sm font-black text-purple-900 mt-1 block">
                      {analytics?.harvest?.running
                        ? 'Scanning now…'
                        : analytics?.harvest?.lastRunAt
                          ? `Last scan ${timeAgo(analytics.harvest.lastRunAt, clock)}`
                          : 'No scans yet'}
                    </span>
                    <p className="text-[11px] text-purple-700/80 mt-1 leading-relaxed">
                      {liveState === 'live' ? 'Live: charts update as soon as the agents add or close calls.' : 'Reconnecting; charts refresh every 5 minutes.'}
                    </p>
                  </div>
                </div>

                {/* Recharts Container */}
                <div className="h-[320px] w-full pt-4 pr-4 border border-gray-100 bg-gray-50/20 rounded-xl">
                  <ResponsiveContainer width="100%" height="100%">
                    {trendChartType === 'area' ? (
                      <AreaChart data={fundingTrends} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorFunding" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="month" 
                          tickLine={false} 
                          axisLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                        />
                        <YAxis 
                          tickLine={false} 
                          axisLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                          tickFormatter={(val) => trendCategory === 'activeGrants' ? val : `$${(val / 1000000).toFixed(1)}M`}
                        />
                        <Tooltip 
                          contentStyle={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)' }}
                          labelStyle={{ fontWeight: 800, fontSize: '11px', color: '#1e293b' }}
                          itemStyle={{ fontSize: '11px', fontWeight: 600 }}
                          formatter={(value: any) => trendCategory === 'activeGrants' ? [`${value} Grants`, 'Active Calls'] : [`$${value.toLocaleString()}`, 'Funding Pool']}
                        />
                        <Area 
                          type="monotone" 
                          dataKey={
                            trendCategory === 'all' ? 'funding' :
                            trendCategory === 'Tech' ? 'Tech' :
                            trendCategory === 'Health' ? 'Health' :
                            trendCategory === 'Energy' ? 'Energy' :
                            'activeGrants'
                          } 
                          stroke={trendCategory === 'activeGrants' ? '#10b981' : '#3b82f6'} 
                          strokeWidth={2}
                          fillOpacity={1} 
                          fill={trendCategory === 'activeGrants' ? 'url(#colorActive)' : 'url(#colorFunding)'} 
                        />
                      </AreaChart>
                    ) : trendChartType === 'bar' ? (
                      <BarChart data={fundingTrends} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="month" 
                          tickLine={false} 
                          axisLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                        />
                        <YAxis 
                          tickLine={false} 
                          axisLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                          tickFormatter={(val) => trendCategory === 'activeGrants' ? val : `$${(val / 1000000).toFixed(1)}M`}
                        />
                        <Tooltip 
                          contentStyle={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)' }}
                          labelStyle={{ fontWeight: 800, fontSize: '11px', color: '#1e293b' }}
                          itemStyle={{ fontSize: '11px', fontWeight: 600 }}
                          formatter={(value: any) => trendCategory === 'activeGrants' ? [`${value} Grants`, 'Active Calls'] : [`$${value.toLocaleString()}`, 'Funding Pool']}
                        />
                        <Bar 
                          dataKey={
                            trendCategory === 'all' ? 'funding' :
                            trendCategory === 'Tech' ? 'Tech' :
                            trendCategory === 'Health' ? 'Health' :
                            trendCategory === 'Energy' ? 'Energy' :
                            'activeGrants'
                          } 
                          fill={trendCategory === 'activeGrants' ? '#10b981' : '#3b82f6'} 
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    ) : (
                      <LineChart data={fundingTrends} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="month" 
                          tickLine={false} 
                          axisLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                        />
                        <YAxis 
                          tickLine={false} 
                          axisLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                          tickFormatter={(val) => trendCategory === 'activeGrants' ? val : `$${(val / 1000000).toFixed(1)}M`}
                        />
                        <Tooltip 
                          contentStyle={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)' }}
                          labelStyle={{ fontWeight: 800, fontSize: '11px', color: '#1e293b' }}
                          itemStyle={{ fontSize: '11px', fontWeight: 600 }}
                          formatter={(value: any) => trendCategory === 'activeGrants' ? [`${value} Grants`, 'Active Calls'] : [`$${value.toLocaleString()}`, 'Funding Pool']}
                        />
                        <Line 
                          type="monotone"
                          dataKey={
                            trendCategory === 'all' ? 'funding' :
                            trendCategory === 'Tech' ? 'Tech' :
                            trendCategory === 'Health' ? 'Health' :
                            trendCategory === 'Energy' ? 'Energy' :
                            'activeGrants'
                          } 
                          stroke={trendCategory === 'activeGrants' ? '#10b981' : '#3b82f6'} 
                          strokeWidth={3}
                          dot={{ r: 4, strokeWidth: 2 }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Activity Log Summary */}
              {dashboardLayout === 'detailed' && (
                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h3 className="font-extrabold text-sm text-gray-900">Intelligence Activity Logs</h3>
                      <p className="text-xs text-gray-400">Scheduled and triggered scraper actions and telemetry</p>
                    </div>
                    <button 
                      onClick={() => setActiveTab('scraper')}
                      className="text-xs text-blue-600 font-semibold hover:underline"
                    >
                      Configure Scraper &rarr;
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          <th className="py-3 px-2">Timestamp</th>
                          <th className="py-3 px-2">Subsystem / Source</th>
                          <th className="py-3 px-2">Status</th>
                          <th className="py-3 px-2">Extracted Items</th>
                          <th className="py-3 px-2">Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-xs text-gray-600">
                        {scraperLogs.slice(0, 3).map((log) => (
                          <tr key={log.id} className="hover:bg-gray-50/50">
                            <td className="py-3 px-2 font-mono text-[11px] text-gray-400">{new Date(log.timestamp).toLocaleString()}</td>
                            <td className="py-3 px-2 font-bold text-gray-800">{log.source}</td>
                            <td className="py-3 px-2">
                              <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${log.status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                {log.status.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-3 px-2 font-semibold text-gray-900">{log.itemsExtracted} entries</td>
                            <td className="py-3 px-2 text-gray-500 max-w-sm truncate">{log.message || 'No extra feedback.'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== SUBVIEW: EXPLORER ==================== */}
          {activeTab === 'explorer' && (
            <div id="subview-explorer" className="space-y-6">
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-2xl font-black text-gray-900 tracking-tight">Grant Explorer</h1>
                  <p className="text-gray-500 text-sm mt-1">Multi-faceted real-time discovery of global research opportunities.</p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                    <button
                      id="view-mode-list"
                      onClick={() => setGrantViewMode('list')}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                        grantViewMode === 'list'
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                      title="List View"
                    >
                      <List className="w-3.5 h-3.5" />
                      List
                    </button>
                    <button
                      id="view-mode-tiles"
                      onClick={() => setGrantViewMode('tiles')}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                        grantViewMode === 'tiles'
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                      title="Tiles View"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      Tiles
                    </button>
                    <button
                      id="view-mode-details"
                      onClick={() => setGrantViewMode('details')}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                        grantViewMode === 'details'
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                      title="Details View"
                    >
                      <Columns className="w-3.5 h-3.5" />
                      Details
                    </button>
                  </div>
                  <div className="text-xs text-gray-400 font-semibold">
                    Showing <span className="text-gray-900 font-bold">{filteredGrants.length}</span> of <span className="text-gray-900 font-bold">{lifecycleCounts[grantLifecycleView]}</span> {grantLifecycleView} calls
                  </div>
                </div>
              </div>

              {/* Call lifecycle: active / expired / archived */}
              <div id="lifecycle-filters" className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm space-y-2">
                <div className="flex justify-between items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Call Status:</span>
                    <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200" role="tablist" aria-label="Call status">
                      {([
                        { id: 'active', label: 'Active', on: 'text-blue-700' },
                        { id: 'expired', label: `Expired ≤${ARCHIVE_AFTER_DAYS}d`, on: 'text-rose-700' },
                        { id: 'archived', label: `Archived >${ARCHIVE_AFTER_DAYS}d`, on: 'text-gray-800' },
                      ] as const).map(tab => (
                        <button
                          key={tab.id}
                          id={`lifecycle-${tab.id}`}
                          role="tab"
                          aria-selected={grantLifecycleView === tab.id}
                          onClick={() => setGrantLifecycleView(tab.id)}
                          className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                            grantLifecycleView === tab.id ? `bg-white shadow-sm ${tab.on}` : 'text-gray-600 hover:text-gray-950'
                          }`}
                        >
                          {tab.id === 'archived' && <Archive className="w-3.5 h-3.5" />}
                          {tab.id === 'expired' && <CalendarX className="w-3.5 h-3.5" />}
                          {tab.label} ({lifecycleCounts[tab.id]})
                        </button>
                      ))}
                    </div>
                  </div>

                  {isSuperAdmin && grantLifecycleView === 'expired' && lifecycleCounts.expired > 0 && (
                    <button
                      id="archive-all-expired"
                      onClick={handleArchiveAllExpired}
                      disabled={bulkArchiving}
                      className="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                    >
                      {bulkArchiving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                      Archive all expired ({lifecycleCounts.expired})
                    </button>
                  )}
                </div>
                {grantLifecycleView !== 'active' && (
                  <p className="text-[11px] text-gray-500">
                    {grantLifecycleView === 'expired'
                      ? `Calls that ended in the last ${ARCHIVE_AFTER_DAYS} days (deadline passed or closed by the source). They are left out of the dashboard figures and active listings, and move to the archive once more than ${ARCHIVE_AFTER_DAYS} days have passed since they ended.`
                      : `Calls that ended more than ${ARCHIVE_AFTER_DAYS} days ago, whether from the source or this system, plus any an admin archived early. Only early archives can be restored to the expired list.`}
                  </p>
                )}
              </div>

              {/* Filters Panel */}
              <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-3">
                  <Filter className="w-4 h-4 text-gray-500" />
                  Facetted Filter Intelligence
                </div>
                
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Category</label>
                    <select
                      id="filter-category"
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="block w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="all">All Portfolios</option>
                      <option value="Technology">Technology & AI</option>
                      <option value="Health">Health & Medicine</option>
                      <option value="Energy">Energy & Climate</option>
                      <option value="Social Sciences">Social Sciences</option>
                      <option value="Education">Education Research</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Originating Funder</label>
                    <select
                      id="filter-funder"
                      value={selectedFunder}
                      onChange={(e) => setSelectedFunder(e.target.value)}
                      className="block w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="all">All Funders</option>
                      {funders.map(f => (
                        <option key={f.id} value={f.id}>{f.name.split(' (')[0]}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="filter-region" className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Geographic Eligibility</label>
                    <select
                      id="filter-region"
                      value={selectedRegion}
                      onChange={(e) => setSelectedRegion(e.target.value)}
                      aria-describedby="filter-region-hint"
                      className="block w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="all">All Regions</option>
                      {REGION_FILTERS.map(f => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                      ))}
                      <option value="United States">United States</option>
                      <option value="European Union">European Union</option>
                      <option value="United Kingdom">United Kingdom</option>
                      <option value="Global">Global / International</option>
                    </select>
                    {REGION_FILTERS.some(f => f.id === selectedRegion) && (
                      <p id="filter-region-hint" className="text-[10px] text-gray-500 mt-1">
                        {REGION_FILTERS.find(f => f.id === selectedRegion)!.hint}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Org / Profile Constraint</label>
                    <select
                      id="filter-org"
                      value={selectedOrgType}
                      onChange={(e) => setSelectedOrgType(e.target.value)}
                      className="block w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="all">All Affiliations</option>
                      <option value="Higher Education">Universities & Faculties</option>
                      <option value="non-profit">Non-profit labs</option>
                      <option value="student">Postgraduate & PhD candidates</option>
                      <option value="Small Business">Industry & SMEs</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <div className="flex gap-2">
                    {searchQuery && (
                      <span className="bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
                        Query: {searchQuery}
                        <button onClick={() => setSearchQuery('')} className="hover:text-red-500 font-bold ml-1 cursor-pointer">&times;</button>
                      </span>
                    )}
                    {selectedCategory !== 'all' && (
                      <span className="bg-amber-50 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
                        Category: {selectedCategory}
                        <button onClick={() => setSelectedCategory('all')} className="hover:text-red-500 font-bold ml-1 cursor-pointer">&times;</button>
                      </span>
                    )}
                    {selectedFunder !== 'all' && (
                      <span className="bg-purple-50 text-purple-700 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
                        Funder: {funders.find(f => f.id === selectedFunder)?.name.split(' (')[0]}
                        <button onClick={() => setSelectedFunder('all')} className="hover:text-red-500 font-bold ml-1 cursor-pointer">&times;</button>
                      </span>
                    )}
                  </div>

                  <button 
                    id="clear-filters"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('all');
                      setSelectedFunder('all');
                      setSelectedRegion('all');
                      setSelectedOrgType('all');
                      setMatchFilterMode('all');
                    }}
                    className="text-xs text-gray-500 hover:text-gray-900 font-bold transition-all cursor-pointer"
                  >
                    Reset Filter Architecture
                  </button>
                </div>
              </div>

              {/* Quick Match Filter Pills */}
              <div id="quick-match-filters" className="flex justify-between items-center bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Relevance Level:</span>
                  <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                    <button
                      id="match-filter-all"
                      onClick={() => setMatchFilterMode('all')}
                      className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        matchFilterMode === 'all'
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-gray-600 hover:text-gray-950'
                      }`}
                    >
                      All Grants ({filteredGrantsBeforeMatchFilter.length})
                    </button>
                    <button
                      id="match-filter-high"
                      onClick={() => setMatchFilterMode('high')}
                      className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        matchFilterMode === 'high'
                          ? 'bg-white text-emerald-700 shadow-sm'
                          : 'text-gray-600 hover:text-gray-950'
                      }`}
                    >
                      High Match &ge;85% ({highMatchCount})
                    </button>
                  </div>
                </div>

                {matchFilterMode === 'high' && (
                  <div id="quick-filter-badge" className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    High Relevance Filter Active
                  </div>
                )}
              </div>

              {/* Grants Discovery Layout Container */}
              {loadingGrants ? (
                <div className="py-24 flex flex-col items-center justify-center gap-4">
                  <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                  <p className="text-sm font-semibold text-gray-500">Retrieving master catalog listings...</p>
                </div>
              ) : (() => {
                const selectedExplorerGrant = filteredGrants.find(g => g.id === explorerSelectedGrantId) || filteredGrants[0] || null;
                const selectedExplorerMatchScore = selectedExplorerGrant ? (matches.find(m => m.grantId === selectedExplorerGrant.id)?.matchScore || 70) : 70;

                // TILES VIEW
                if (grantViewMode === 'tiles') {
                  return (
                    <div className="grid grid-cols-2 gap-6">
                      {filteredGrants.map((grant) => {
                        const matchedScoreObj = matches.find(m => m.grantId === grant.id);
                        const score = matchedScoreObj?.matchScore || 70;
                        const scoreBadge = score >= 85 ? 'bg-green-50 text-green-700 border-green-200' : score >= 70 ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-200';

                        return (
                          <div 
                            key={grant.id}
                            onClick={() => handleOpenGrantDetail(grant)}
                            className="bg-white p-6 rounded-xl border border-gray-200 hover:border-blue-500 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex justify-between items-start gap-4">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-2 py-1 rounded border border-gray-100">
                                  {grant.category}
                                </span>
                                <span className={`text-xs font-black px-2.5 py-1 rounded-lg border shrink-0 ${scoreBadge}`}>
                                  {score}% Match
                                </span>
                              </div>

                              <h3 className="font-extrabold text-sm text-gray-900 mt-3 hover:text-blue-600 line-clamp-1">
                                {grant.title}
                              </h3>

                              <p className="text-xs text-gray-400 mt-1 font-semibold">
                                Funder: {grant.funderName}
                              </p>

                              <p className="text-xs text-gray-500 mt-2 line-clamp-2 leading-relaxed">
                                {grant.description}
                              </p>
                              {(grant.editionCount > 1 || grant.newerEditionId) && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                  {grant.editionCount > 1 && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded" title="This call has run before; open it to see what changed">
                                      <HistoryIcon className="w-3 h-3" /> {grant.editionCount} editions
                                    </span>
                                  )}
                                  {grant.newerEditionId && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openGrantById(grant.newerEditionId!);
                                      }}
                                      className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 px-1.5 py-0.5 rounded cursor-pointer"
                                      title="The funder has published a later edition of this call"
                                    >
                                      <Repeat className="w-3 h-3" /> Repeated: see new call
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="border-t border-gray-100 pt-4 mt-4 flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                              <span className="flex items-center gap-1">
                                <DollarSign className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                ${grant.fundingAmount.toLocaleString()}
                              </span>
                              <span className={`flex items-center gap-1 ${grant.lifecycle !== 'active' ? 'text-rose-500' : ''}`}>
                                <Calendar className="w-3.5 h-3.5 shrink-0" />
                                {grant.lifecycle !== 'active' ? `Ended ${grant.endedOn ?? grant.deadline}` : grant.deadline}
                              </span>
                              {(() => {
                                const left = grant.lifecycle === 'expired' ? daysUntilArchive(grant.endedOn) : null;
                                return left != null ? (
                                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded" title={`Calls move to the archive ${ARCHIVE_AFTER_DAYS} days after they end`}>
                                    {left <= 1 ? 'Archives tomorrow' : `Archives in ${left} days`}
                                  </span>
                                ) : null;
                              })()}
                            </div>
                            {isSuperAdmin && grant.lifecycle !== 'active' && !grant.archivedByAge && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleArchiveGrant(grant, grant.lifecycle === 'archived');
                                }}
                                disabled={archivingGrantId === grant.id}
                                className="mt-3 self-end px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
                              >
                                {grant.lifecycle === 'archived' ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                                {grant.lifecycle === 'archived' ? 'Restore' : 'Archive'}
                              </button>
                            )}
                          </div>
                        );
                      })}

                      {filteredGrants.length === 0 && (
                        <div className="col-span-2 py-16 text-center bg-white rounded-xl border border-dashed border-gray-200">
                          <AlertCircle className="w-8 h-8 text-gray-400 mx-auto" />
                          <h4 className="text-sm font-bold text-gray-800 mt-3">No matching grants discovered</h4>
                          <p className="text-xs text-gray-500 mt-1">Try resetting your active search or filtering metrics.</p>
                        </div>
                      )}
                    </div>
                  );
                }

                // LIST VIEW
                if (grantViewMode === 'list') {
                  return (
                    <div className="space-y-3">
                      {filteredGrants.map((grant) => {
                        const matchedScoreObj = matches.find(m => m.grantId === grant.id);
                        const score = matchedScoreObj?.matchScore || 70;
                        const scoreBadge = score >= 85 ? 'bg-green-50 text-green-700 border-green-200' : score >= 70 ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-200';

                        return (
                          <div 
                            key={grant.id}
                            onClick={() => handleOpenGrantDetail(grant)}
                            className="bg-white p-4 rounded-xl border border-gray-200 hover:border-blue-500 hover:shadow-sm transition-all cursor-pointer flex items-center justify-between gap-6"
                          >
                            <div className="flex items-center gap-4 min-w-0 flex-1">
                              <div className="flex flex-col items-center justify-center shrink-0 w-16 h-16 rounded-xl border border-gray-100 bg-gray-50/50">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{grant.category.slice(0, 4)}</span>
                                <span className={`text-[11px] font-black px-1.5 py-0.5 mt-1 rounded border shrink-0 ${scoreBadge}`}>
                                  {score}%
                                </span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                                    {grant.category}
                                  </span>
                                  <span className="text-xs text-gray-400 font-semibold">• Funder: {grant.funderName}</span>
                                </div>
                                <h3 className="font-extrabold text-sm text-gray-900 mt-1 hover:text-blue-600 truncate">
                                  {grant.title}
                                </h3>
                                <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                                  {grant.description}
                                </p>
                                {(grant.editionCount > 1 || grant.newerEditionId) && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                  {grant.editionCount > 1 && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded" title="This call has run before; open it to see what changed">
                                      <HistoryIcon className="w-3 h-3" /> {grant.editionCount} editions
                                    </span>
                                  )}
                                  {grant.newerEditionId && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openGrantById(grant.newerEditionId!);
                                      }}
                                      className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 px-1.5 py-0.5 rounded cursor-pointer"
                                      title="The funder has published a later edition of this call"
                                    >
                                      <Repeat className="w-3 h-3" /> Repeated: see new call
                                    </button>
                                  )}
                                </div>
                              )}
                              </div>
                            </div>

                            <div className="flex items-center gap-8 shrink-0">
                              <div className="text-right">
                                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Amount</div>
                                <div className="text-xs font-black text-gray-900 mt-0.5 flex items-center justify-end gap-0.5">
                                  <DollarSign className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                  ${grant.fundingAmount.toLocaleString()}
                                </div>
                              </div>
                              <div className="text-right min-w-[90px]">
                                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Deadline</div>
                                <div className="text-xs font-bold text-gray-600 mt-0.5 flex items-center justify-end gap-0.5">
                                  <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                  {grant.lifecycle !== 'active' ? (grant.endedOn ?? grant.deadline) : grant.deadline}
                                </div>
                                <div className="mt-1 flex justify-end">
                              {(() => {
                                const left = grant.lifecycle === 'expired' ? daysUntilArchive(grant.endedOn) : null;
                                return left != null ? (
                                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded" title={`Calls move to the archive ${ARCHIVE_AFTER_DAYS} days after they end`}>
                                    {left <= 1 ? 'Archives tomorrow' : `Archives in ${left} days`}
                                  </span>
                                ) : null;
                              })()}
                                </div>
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenGrantDetail(grant);
                                }}
                                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-100 text-blue-700 text-xs font-bold rounded-lg transition-all cursor-pointer"
                              >
                                Explore
                              </button>
                              {isSuperAdmin && grant.lifecycle !== 'active' && !grant.archivedByAge && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleArchiveGrant(grant, grant.lifecycle === 'archived');
                                  }}
                                  disabled={archivingGrantId === grant.id}
                                  title={grant.lifecycle === 'archived' ? 'Restore to expired calls' : 'Archive this expired call'}
                                  className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
                                >
                                  {grant.lifecycle === 'archived' ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                                  {grant.lifecycle === 'archived' ? 'Restore' : 'Archive'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {filteredGrants.length === 0 && (
                        <div className="py-16 text-center bg-white rounded-xl border border-dashed border-gray-200">
                          <AlertCircle className="w-8 h-8 text-gray-400 mx-auto" />
                          <h4 className="text-sm font-bold text-gray-800 mt-3">No matching grants discovered</h4>
                          <p className="text-xs text-gray-500 mt-1">Try resetting your active search or filtering metrics.</p>
                        </div>
                      )}
                    </div>
                  );
                }

                // DETAILS VIEW (SPLIT PANE)
                return (
                  <div className="grid grid-cols-12 gap-6 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm h-[750px]">
                    {/* Left Side: Scrollable opportunities */}
                    <div className="col-span-4 border-r border-gray-200 flex flex-col h-full bg-gray-50/20">
                      <div className="p-3 bg-white border-b border-gray-200 flex items-center gap-2 justify-between shrink-0">
                        <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Discovered Grants</span>
                        <span className="bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{filteredGrants.length}</span>
                      </div>

                      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                        {filteredGrants.map((grant) => {
                          const matchedScoreObj = matches.find(m => m.grantId === grant.id);
                          const score = matchedScoreObj?.matchScore || 70;
                          const scoreBadge = score >= 85 ? 'bg-green-50 text-green-700' : score >= 70 ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600';
                          const isSelected = selectedExplorerGrant?.id === grant.id;

                          return (
                            <div
                              key={grant.id}
                              onClick={() => setExplorerSelectedGrantId(grant.id)}
                              className={`p-3.5 hover:bg-white transition-all cursor-pointer flex flex-col gap-1 border-l-4 ${
                                isSelected 
                                  ? 'bg-white border-blue-600 shadow-sm' 
                                  : 'border-transparent'
                              }`}
                            >
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider truncate max-w-[120px]">
                                  {grant.category}
                                </span>
                                <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${scoreBadge}`}>
                                  {score}% Match
                                </span>
                              </div>
                              <h4 className="font-extrabold text-xs text-gray-900 mt-1 line-clamp-1">
                                {grant.title}
                              </h4>
                              <p className="text-[10px] text-gray-400 font-semibold truncate">
                                {grant.funderName}
                              </p>
                              <div className="flex items-center gap-2 mt-2 text-[9px] font-bold text-gray-500">
                                <span className="flex items-center gap-0.5">
                                  <DollarSign className="w-3 h-3 text-gray-400" />
                                  {grant.fundingAmount.toLocaleString()}
                                </span>
                                <span className="text-gray-300">•</span>
                                <span className="flex items-center gap-0.5">
                                  <Calendar className="w-3 h-3 text-gray-400" />
                                  {grant.deadline}
                                </span>
                              </div>
                            </div>
                          );
                        })}

                        {filteredGrants.length === 0 && (
                          <div className="py-16 text-center text-gray-400 px-4">
                            <AlertCircle className="w-8 h-8 text-gray-300 mx-auto" />
                            <h4 className="text-xs font-bold text-gray-700 mt-2">No Grants Discovered</h4>
                            <p className="text-[10px] text-gray-500 mt-1">Try resetting your filter parameters above.</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Side: Active Grant details */}
                    <div className="col-span-8 h-full flex flex-col bg-white overflow-hidden">
                      {selectedExplorerGrant ? (
                        <div className="flex flex-col h-full overflow-hidden">
                          {/* Detail Header */}
                          <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-start shrink-0">
                            <div>
                              <span className="text-[9px] font-bold text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                {selectedExplorerGrant.category} Opportunity
                              </span>
                              <h2 className="text-sm font-black text-gray-900 mt-1 leading-snug">{selectedExplorerGrant.title}</h2>
                              <p className="text-[11px] text-gray-400 mt-0.5 font-bold">Originating Funder: {selectedExplorerGrant.funderName}</p>
                            </div>
                            
                            <div className="flex items-center gap-1.5 shrink-0 bg-white px-2 py-1 rounded-lg border border-gray-100">
                              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Score:</span>
                              <span className={`text-xs font-black px-2 py-0.5 rounded border ${
                                selectedExplorerMatchScore >= 85 ? 'bg-green-50 text-green-700 border-green-100' : selectedExplorerMatchScore >= 70 ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-gray-50 text-gray-600 border-gray-100'
                              }`}>
                                {selectedExplorerMatchScore}%
                              </span>
                              {isSuperAdmin && selectedExplorerGrant.lifecycle !== 'active' && !selectedExplorerGrant.archivedByAge && (
                                <button
                                  onClick={() => handleArchiveGrant(selectedExplorerGrant, selectedExplorerGrant.lifecycle === 'archived')}
                                  disabled={archivingGrantId === selectedExplorerGrant.id}
                                  className="ml-1 px-2 py-0.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 text-[10px] font-bold rounded transition-all cursor-pointer flex items-center gap-1 disabled:opacity-60"
                                >
                                  {selectedExplorerGrant.lifecycle === 'archived' ? <ArchiveRestore className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                                  {selectedExplorerGrant.lifecycle === 'archived' ? 'Restore' : 'Archive'}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Detail Body */}
                          <div className="flex-1 overflow-y-auto p-5 space-y-5">
                            {/* AI Match Rationale */}
                            {loadingDetailsMatch ? (
                              <div className="p-4 bg-blue-50/30 rounded-xl border border-blue-100 text-xs text-gray-500 font-semibold flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                                Analyzing applicant qualifications against program objectives...
                              </div>
                            ) : detailsMatch ? (
                              <div className="p-4 bg-gradient-to-br from-blue-50/20 via-white to-gray-50 rounded-xl border border-blue-100 space-y-3">
                                <div className="flex items-center gap-1.5 text-xs font-bold text-blue-700">
                                  <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                                  <span>AI Match Rationale</span>
                                </div>
                                <p className="text-xs text-gray-600 leading-relaxed italic">
                                  &ldquo;{detailsMatch.rationale}&rdquo;
                                </p>
                                {detailsMatch.relevanceBreakdown && (
                                  <div className="grid grid-cols-4 gap-3 border-t border-gray-100 pt-2 text-[10px] text-gray-500 font-bold">
                                    <div>
                                      <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider block">Subject Fit</span>
                                      <span className="text-[11px] font-black text-gray-700 mt-0.5 block">{detailsMatch.relevanceBreakdown.subject} / 40</span>
                                    </div>
                                    <div>
                                      <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider block">Eligibility</span>
                                      <span className="text-[11px] font-black text-gray-700 mt-0.5 block">{detailsMatch.relevanceBreakdown.eligibility} / 30</span>
                                    </div>
                                    <div>
                                      <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider block">Amount Target</span>
                                      <span className="text-[11px] font-black text-gray-700 mt-0.5 block">{detailsMatch.relevanceBreakdown.amount} / 15</span>
                                    </div>
                                    <div>
                                      <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider block">Urgency</span>
                                      <span className="text-[11px] font-black text-gray-700 mt-0.5 block">{detailsMatch.relevanceBreakdown.urgency} / 15</span>
                                    </div>
                                  </div>
                                )}

                                {/* Feedback loop inside details view */}
                                <div className="border-t border-gray-100 pt-3 flex items-center justify-between gap-2">
                                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Is this match accurate?</span>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleSaveFeedback(selectedExplorerGrant.id, detailsMatch.feedback === 'relevant' ? null : 'relevant')}
                                      className={`px-2 py-1 rounded text-[10px] font-extrabold border transition-all cursor-pointer ${
                                        detailsMatch.feedback === 'relevant'
                                          ? 'bg-green-600 border-green-600 text-white'
                                          : 'bg-white border-gray-200 text-gray-600 hover:bg-green-50 hover:text-green-600 hover:border-green-100'
                                      }`}
                                    >
                                      👍 Relevant
                                    </button>
                                    <button
                                      onClick={() => handleSaveFeedback(selectedExplorerGrant.id, detailsMatch.feedback === 'not_relevant' ? null : 'not_relevant')}
                                      className={`px-2 py-1 rounded text-[10px] font-extrabold border transition-all cursor-pointer ${
                                        detailsMatch.feedback === 'not_relevant'
                                          ? 'bg-red-600 border-red-600 text-white'
                                          : 'bg-white border-gray-200 text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-100'
                                      }`}
                                    >
                                      👎 Not Relevant
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-500">
                                Portfolio compatibility index: {selectedExplorerMatchScore}% Match
                              </div>
                            )}

                            {/* Core Info Grid */}
                            <div className="grid grid-cols-3 gap-4 text-xs text-gray-600">
                              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Funding Cap</span>
                                <span className="text-xs font-black text-gray-900 mt-1 block flex items-center gap-0.5">
                                  <DollarSign className="w-3.5 h-3.5 text-gray-400" />
                                  {selectedExplorerGrant.fundingAmount.toLocaleString()}
                                </span>
                              </div>
                              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Submission Deadline</span>
                                <span className="text-xs font-extrabold text-gray-900 mt-1 block flex items-center gap-0.5">
                                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                  {selectedExplorerGrant.deadline}
                                </span>
                              </div>
                              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Source Directory</span>
                                <span className="text-xs font-extrabold text-gray-800 mt-1 block flex items-center gap-1">
                                  <Globe className="w-3.5 h-3.5 text-gray-400" />
                                  {selectedExplorerGrant.source}
                                </span>
                              </div>
                            </div>

                            {/* Eligibility Tags */}
                            <div className="space-y-1.5">
                              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Eligible Boundaries</span>
                              <div className="flex flex-wrap gap-1.5">
                                {selectedExplorerGrant.eligibleRegions.map(reg => (
                                  <span key={reg} className="bg-gray-50 text-gray-600 font-semibold px-2 py-0.5 rounded text-[10px] border border-gray-200">{reg}</span>
                                ))}
                                {selectedExplorerGrant.eligibleOrgTypes.map(org => (
                                  <span key={org} className="bg-purple-50 text-purple-700 font-semibold px-2 py-0.5 rounded text-[10px] border border-purple-100">{org}</span>
                                ))}
                              </div>
                            </div>

                            {/* Detailed Description */}
                            <div className="space-y-1 text-xs text-gray-600">
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Program Scope & Guidelines</span>
                              <p className="text-gray-700 bg-gray-50/50 p-3.5 rounded-xl border border-gray-100 text-xs whitespace-pre-line leading-relaxed">{selectedExplorerGrant.description}</p>
                            </div>

                            {selectedExplorerGrant.objectives && (
                              <div className="space-y-1 text-xs text-gray-600">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Objectives</span>
                                <p className="text-gray-700 bg-gray-50/50 p-3.5 rounded-xl border border-gray-100 text-xs whitespace-pre-line leading-relaxed">{selectedExplorerGrant.objectives}</p>
                              </div>
                            )}

                            {selectedExplorerGrant.requiredOutcomes && (
                              <div className="space-y-1 text-xs text-gray-600">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Required Outcomes</span>
                                <p className="text-gray-700 bg-gray-50/50 p-3.5 rounded-xl border border-gray-100 text-xs whitespace-pre-line leading-relaxed">{selectedExplorerGrant.requiredOutcomes}</p>
                              </div>
                            )}

                            {selectedExplorerGrant.scope && (
                              <div className="space-y-1 text-xs text-gray-600">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Scope</span>
                                <p className="text-gray-700 bg-gray-50/50 p-3.5 rounded-xl border border-gray-100 text-xs whitespace-pre-line leading-relaxed">{selectedExplorerGrant.scope}</p>
                              </div>
                            )}

                            <CallHistory grantId={selectedExplorerGrant.id} onOpenGrant={openGrantById} compact />

                            {/* Keywords */}
                            {selectedExplorerGrant.extractedKeywords && selectedExplorerGrant.extractedKeywords.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Semantic Keywords</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {selectedExplorerGrant.extractedKeywords.map((kw, i) => (
                                    <span key={i} className="bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded-full text-[10px] border border-blue-100">
                                      #{kw}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Integrated Pipeline Tracking Console */}
                            <div className="border-t border-gray-100 pt-5 space-y-3">
                              <h4 className="font-extrabold text-xs text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                                <Layers className="w-4 h-4 text-blue-600" />
                                Inline Tracking Console
                              </h4>
                              <p className="text-[10px] text-gray-500">Save and activate pipeline tracing for this opportunity immediately.</p>
                              
                              <div className="grid grid-cols-3 gap-3">
                                <div>
                                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Status Action</label>
                                  <select
                                    id="explorer-track-status"
                                    value={trackingStatus}
                                    onChange={(e) => setTrackingStatus(e.target.value as any)}
                                    className="block w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg cursor-pointer bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  >
                                    <option value="draft">Save to Drafts / Backlog</option>
                                    <option value="submitted">Mark as Submitted</option>
                                  </select>
                                </div>
                                <div className="col-span-2">
                                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Action Notes</label>
                                  <input 
                                    id="explorer-track-notes"
                                    type="text"
                                    value={trackingNotes}
                                    onChange={(e) => setTrackingNotes(e.target.value)}
                                    placeholder="Internal notes, collaborators, strategies..."
                                    className="block w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Collaborative Consortium Share Panel */}
                            {user && (
                              <div className="p-4 bg-blue-50/25 rounded-xl border border-dashed border-blue-200 space-y-3">
                                <h4 className="font-extrabold text-xs text-blue-900 flex items-center gap-1.5 uppercase tracking-wider">
                                  <Share2 className="w-3.5 h-3.5 text-blue-600" />
                                  Collaborative Consortia Sharing
                                </h4>
                                <p className="text-[10px] text-gray-500">Share this grant opportunity directly with your project teams to coordinate collectively.</p>

                                {teams.filter(t => t.memberIds.includes(user.id)).length === 0 ? (
                                  <p className="text-[9px] text-gray-400 italic">You aren't a member of any consortia yet. Go to the Collaboration Hub to form one.</p>
                                ) : (
                                  <div className="grid grid-cols-3 gap-3">
                                    <div>
                                      <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Target Consortium</label>
                                      <select
                                        id="explorer-share-target-team"
                                        value={sharingGrantId === selectedExplorerGrant.id ? (selectedTeam?.id || '') : ''}
                                        onChange={(e) => {
                                          setSharingGrantId(selectedExplorerGrant.id);
                                          const target = teams.find(t => t.id === e.target.value);
                                          if (target) setSelectedTeam(target);
                                        }}
                                        className="block w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg cursor-pointer bg-white"
                                      >
                                        <option value="">-- Select Team --</option>
                                        {teams.filter(t => t.memberIds.includes(user.id)).map(t => (
                                          <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="col-span-2 flex items-end gap-2.5">
                                      <div className="flex-1">
                                        <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Sharing Notes</label>
                                        <input 
                                          id="explorer-share-notes"
                                          type="text"
                                          value={shareNotes}
                                          onChange={(e) => setShareNotes(e.target.value)}
                                          placeholder="Let's build a submission consortium..."
                                          className="block w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                                        />
                                      </div>
                                      <button
                                        onClick={() => {
                                          const selectEl = document.getElementById('explorer-share-target-team') as HTMLSelectElement | null;
                                          const targetTeamId = selectEl?.value;
                                          if (!targetTeamId) {
                                            triggerToast("Please select a target team.", "error");
                                            return;
                                          }
                                          shareGrantWithTeam(targetTeamId, selectedExplorerGrant.id, shareNotes);
                                        }}
                                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shrink-0 transition-colors cursor-pointer h-[32px] flex items-center justify-center"
                                      >
                                        Share
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Detail Footer Actions */}
                          <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center shrink-0">
                            <a 
                              href={selectedExplorerGrant.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer transition-all"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Official Call Portal
                            </a>

                            <div className="flex gap-2">
                              <button
                                onClick={() => handleOpenInAssistant(selectedExplorerGrant)}
                                className="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-extrabold rounded-lg text-xs shadow-sm transition-all cursor-pointer flex items-center gap-1.5 animate-pulse"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                Draft with AI
                              </button>
                              <button
                                onClick={() => handleTrackGrant(selectedExplorerGrant.id)}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs shadow-sm transition-all cursor-pointer"
                              >
                                Activate Pipeline Tracking
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-400">
                          <Columns className="w-12 h-12 text-gray-300 mb-4 animate-pulse" />
                          <h4 className="font-bold text-gray-700">No Opportunity Selected</h4>
                          <p className="text-xs text-gray-500 mt-1 max-w-sm">Select an opportunity from the list on the left to inspect its detailed objectives, requirements, and AI match matrix.</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ==================== SUBVIEW: TRACKER ==================== */}
          {activeTab === 'settings' && (
            <GeneralSettings
              user={user}
              onToast={triggerToast}
              onSignedOut={handleLogout}
              onOpenProfile={() => setActiveTab('profile')}
              onOpenOffice={() => setActiveTab('office')}
            />
          )}

          {activeTab === 'smart' && <SmartProfile onToast={triggerToast} onApply={handleOpenInAssistant} />}

          {activeTab === 'office' && canUseOffice && (
            <ResearchOffice user={user} onToast={triggerToast} />
          )}

          {activeTab === 'tracker' && (
            <div id="subview-tracker" className="space-y-6">
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-2xl font-black text-gray-900 tracking-tight">Saved & Tracked Applications</h1>
                  <p className="text-gray-500 text-sm mt-1">Manage active proposals, submission workflows, and funding pipelines.</p>
                </div>
                <div className="bg-white px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  Verified Portfolio Success Rate: <span className="text-blue-600 text-sm font-black">{analytics?.successRate != null ? `${analytics.successRate}%` : '—'}</span>
                </div>
              </div>

              {/* Kanban-style or Status Group Columns */}
              <div className="grid grid-cols-4 gap-6">
                
                {/* Column: Draft (Saved) */}
                <div 
                  className={`p-4 rounded-xl border flex flex-col h-[520px] overflow-hidden transition-all duration-200 ${
                    activeDragOverColumn === 'draft' ? 'bg-blue-50/50 border-blue-400 ring-2 ring-blue-400/20' : 'bg-gray-50 border-gray-200'
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (activeDragOverColumn !== 'draft') {
                      setActiveDragOverColumn('draft');
                    }
                  }}
                  onDragLeave={() => {
                    if (activeDragOverColumn === 'draft') {
                      setActiveDragOverColumn(null);
                    }
                  }}
                  onDrop={(e) => handleDrop(e, 'draft')}
                >
                  <div className="border-b border-gray-200 pb-2.5 mb-3 shrink-0 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-600 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span>
                        Drafts ({getSortedAppsByStatus('draft').length})
                      </span>
                      <span className="text-[10px] font-mono font-bold text-gray-500">Drafting 25%</span>
                    </div>
                    <div className="w-full bg-gray-200/60 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-gray-400 h-1.5 rounded-full" style={{ width: '25%' }} />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {getSortedAppsByStatus('draft').map(app => {
                      const isSelected = selectedTimelineAppId === app.id || (selectedTimelineAppId === null && applications[0]?.id === app.id);
                      const isBeingDragged = draggedAppId === app.id;
                      return (
                        <div 
                          key={app.id} 
                          onClick={() => setSelectedTimelineAppId(app.id)}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", app.id);
                            setDraggedAppId(app.id);
                          }}
                          onDragEnd={() => {
                            setDraggedAppId(null);
                            setActiveDragOverColumn(null);
                          }}
                          className={`bg-white p-4 rounded-lg border shadow-sm space-y-3 hover:shadow-md transition-all cursor-grab active:cursor-grabbing relative ${
                            isSelected ? 'ring-2 ring-blue-500 border-blue-500 bg-blue-50/5' : 'border-gray-200'
                          } ${isBeingDragged ? 'opacity-40 border-dashed border-gray-400' : ''}`}
                        >
                          {isSelected && (
                            <span className="absolute top-2 right-2 flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                            </span>
                          )}
                          <div>
                            <h4 className="font-bold text-xs text-gray-900 line-clamp-1 pr-4">{app.grantTitle}</h4>
                            {(app.status === 'review' || app.status === 'approved') && (
                              <span className={`inline-block mt-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${app.status === 'review' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                {app.status === 'review' ? 'In review' : 'Approved by office'}
                              </span>
                            )}
                            <p className="text-[10px] text-gray-400 mt-0.5">{app.funderName}</p>
                          </div>
                          <div className="text-[10px] font-semibold text-gray-600 flex justify-between">
                            <span>${app.amount.toLocaleString()}</span>
                            <span>Due: {app.deadline}</span>
                          </div>
                          {renderTaskProgressBar(app.notes)}
                          <textarea
                            className="w-full p-2 text-[10px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            rows={2}
                            value={app.notes}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleNotesChange(app.id, e.target.value)}
                            placeholder="Add private drafting notes..."
                          />
                          <div className="flex justify-between gap-2 border-t border-gray-100 pt-2.5" onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              const next = nextOwnerAction(app);
                              return (
                                <button
                                  disabled={!next.to}
                                  onClick={() => next.to && handleUpdateApplicationStatus(app.id, next.to, app.notes || '')}
                                  className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold py-1 rounded transition-colors disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                                >
                                  {next.label}
                                </button>
                              );
                            })()}
                            <button 
                              onClick={() => handleDeleteApplication(app.id)}
                              className="p-1 text-gray-400 hover:text-red-500 rounded"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {getSortedAppsByStatus('draft').length === 0 && (
                      <p className="text-[11px] text-gray-400 text-center py-6">No drafts saved.</p>
                    )}
                  </div>
                </div>

                {/* Column: Submitted */}
                <div 
                  className={`p-4 rounded-xl border flex flex-col h-[520px] overflow-hidden transition-all duration-200 ${
                    activeDragOverColumn === 'submitted' ? 'bg-blue-50/50 border-blue-400 ring-2 ring-blue-400/20' : 'bg-gray-50 border-gray-200'
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (activeDragOverColumn !== 'submitted') {
                      setActiveDragOverColumn('submitted');
                    }
                  }}
                  onDragLeave={() => {
                    if (activeDragOverColumn === 'submitted') {
                      setActiveDragOverColumn(null);
                    }
                  }}
                  onDrop={(e) => handleDrop(e, 'submitted')}
                >
                  <div className="border-b border-gray-200 pb-2.5 mb-3 shrink-0 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
                        Submitted ({getSortedAppsByStatus('submitted').length})
                      </span>
                      <span className="text-[10px] font-mono font-bold text-blue-600">Submitted 50%</span>
                    </div>
                    <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-blue-500 h-1.5 rounded-full animate-pulse" style={{ width: '50%' }} />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {getSortedAppsByStatus('submitted').map(app => {
                      const isSelected = selectedTimelineAppId === app.id || (selectedTimelineAppId === null && applications[0]?.id === app.id);
                      const isBeingDragged = draggedAppId === app.id;
                      return (
                        <div 
                          key={app.id} 
                          onClick={() => setSelectedTimelineAppId(app.id)}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", app.id);
                            setDraggedAppId(app.id);
                          }}
                          onDragEnd={() => {
                            setDraggedAppId(null);
                            setActiveDragOverColumn(null);
                          }}
                          className={`bg-white p-4 rounded-lg border shadow-sm space-y-3 hover:shadow-md transition-all cursor-grab active:cursor-grabbing relative ${
                            isSelected ? 'ring-2 ring-blue-500 border-blue-500 bg-blue-50/5' : 'border-gray-200'
                          } ${isBeingDragged ? 'opacity-40 border-dashed border-gray-400' : ''}`}
                        >
                          {isSelected && (
                            <span className="absolute top-2 right-2 flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                            </span>
                          )}
                          <div>
                            <h4 className="font-bold text-xs text-gray-900 line-clamp-1 pr-4">{app.grantTitle}</h4>
                            <p className="text-[10px] text-gray-400 mt-0.5">{app.funderName}</p>
                          </div>
                          <div className="text-[10px] font-semibold text-gray-600 flex justify-between">
                            <span>${app.amount.toLocaleString()}</span>
                            <span className="text-blue-600 font-medium">Sub: {app.submittedDate || 'Just now'}</span>
                          </div>
                          {renderTaskProgressBar(app.notes)}
                          <textarea
                            className="w-full p-2 text-[10px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            rows={2}
                            value={app.notes}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleNotesChange(app.id, e.target.value)}
                            placeholder="Add review feedback notes..."
                          />
                          <div className="flex justify-between gap-1 border-t border-gray-100 pt-2.5" onClick={(e) => e.stopPropagation()}>
                            <button 
                              onClick={() => handleUpdateApplicationStatus(app.id, 'awarded', app.notes || '')}
                              className="flex-1 bg-green-50 hover:bg-green-100 text-green-700 text-[10px] font-bold py-1 rounded transition-colors"
                            >
                              Mark Awarded! 🎉
                            </button>
                            <button 
                              onClick={() => handleUpdateApplicationStatus(app.id, 'rejected', app.notes || '')}
                              className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold py-1 rounded transition-colors"
                            >
                              Mark Rejected
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {getSortedAppsByStatus('submitted').length === 0 && (
                      <p className="text-[11px] text-gray-400 text-center py-6">No pending submissions.</p>
                    )}
                  </div>
                </div>

                {/* Column: Awarded */}
                <div 
                  className={`p-4 rounded-xl border flex flex-col h-[520px] overflow-hidden transition-all duration-200 ${
                    activeDragOverColumn === 'awarded' ? 'bg-emerald-50/50 border-emerald-400 ring-2 ring-emerald-400/20' : 'bg-emerald-50/45 border-emerald-100'
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (activeDragOverColumn !== 'awarded') {
                      setActiveDragOverColumn('awarded');
                    }
                  }}
                  onDragLeave={() => {
                    if (activeDragOverColumn === 'awarded') {
                      setActiveDragOverColumn(null);
                    }
                  }}
                  onDrop={(e) => handleDrop(e, 'awarded')}
                >
                  <div className="border-b border-emerald-200 pb-2.5 mb-3 shrink-0 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-700 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                        Awarded ({getSortedAppsByStatus('awarded').length})
                      </span>
                      <span className="text-[10px] font-mono font-bold text-emerald-700">Awarded 100%</span>
                    </div>
                    <div className="w-full bg-emerald-100 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-emerald-500 h-1.5 rounded-full animate-pulse" style={{ width: '100%' }} />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {getSortedAppsByStatus('awarded').map(app => {
                      const isSelected = selectedTimelineAppId === app.id || (selectedTimelineAppId === null && applications[0]?.id === app.id);
                      const isBeingDragged = draggedAppId === app.id;
                      return (
                        <div 
                          key={app.id} 
                          onClick={() => setSelectedTimelineAppId(app.id)}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", app.id);
                            setDraggedAppId(app.id);
                          }}
                          onDragEnd={() => {
                            setDraggedAppId(null);
                            setActiveDragOverColumn(null);
                          }}
                          className={`bg-white p-4 rounded-lg border shadow-sm space-y-3 relative cursor-grab active:cursor-grabbing ${
                            isSelected ? 'ring-2 ring-emerald-500 border-emerald-500 bg-emerald-50/10' : 'border-emerald-200'
                          } ${isBeingDragged ? 'opacity-40 border-dashed border-gray-400' : ''}`}
                        >
                          {isSelected && (
                            <span className="absolute top-2 right-2 flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                          )}
                          <div>
                            <div className="flex justify-between items-start">
                              <h4 className="font-bold text-xs text-gray-900 line-clamp-1 pr-4">{app.grantTitle}</h4>
                              <span className="text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded shrink-0">Active Funding</span>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">{app.funderName}</p>
                          </div>
                          <div className="text-[10px] font-semibold text-gray-600 flex justify-between">
                            <span className="text-emerald-700 font-bold">${app.amount.toLocaleString()}</span>
                            <span>Due: {app.deadline}</span>
                          </div>
                          {renderTaskProgressBar(app.notes)}
                          <textarea
                            className="w-full p-2 text-[10px] border border-gray-100 bg-emerald-50/20 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            rows={2}
                            value={app.notes}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleNotesChange(app.id, e.target.value)}
                            placeholder="Add post-award notes..."
                          />
                          <div className="flex justify-end gap-2 border-t border-gray-100 pt-2.5" onClick={(e) => e.stopPropagation()}>
                            <button 
                              onClick={() => handleUpdateApplicationStatus(app.id, 'draft', app.notes || '')}
                              className="text-[9px] text-gray-400 hover:text-gray-600"
                            >
                              Revert to Draft
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {getSortedAppsByStatus('awarded').length === 0 && (
                      <p className="text-[11px] text-gray-400 text-center py-6">No awards recorded yet.</p>
                    )}
                  </div>
                </div>

                {/* Column: Rejected */}
                <div 
                  className={`p-4 rounded-xl border flex flex-col h-[520px] overflow-hidden transition-all duration-200 ${
                    activeDragOverColumn === 'rejected' ? 'bg-red-50/50 border-red-400 ring-2 ring-red-400/20' : 'bg-red-50/10 border-red-100'
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (activeDragOverColumn !== 'rejected') {
                      setActiveDragOverColumn('rejected');
                    }
                  }}
                  onDragLeave={() => {
                    if (activeDragOverColumn === 'rejected') {
                      setActiveDragOverColumn(null);
                    }
                  }}
                  onDrop={(e) => handleDrop(e, 'rejected')}
                >
                  <div className="border-b border-red-200 pb-2.5 mb-3 shrink-0 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-red-600 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-400"></span>
                        Rejected ({getSortedAppsByStatus('rejected').length})
                      </span>
                      <span className="text-[10px] font-mono font-bold text-red-600">Rejected 0%</span>
                    </div>
                    <div className="w-full bg-red-100/50 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-red-400 h-1.5 rounded-full" style={{ width: '0%' }} />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {getSortedAppsByStatus('rejected').map(app => {
                      const isSelected = selectedTimelineAppId === app.id || (selectedTimelineAppId === null && applications[0]?.id === app.id);
                      const isBeingDragged = draggedAppId === app.id;
                      return (
                        <div 
                          key={app.id} 
                          onClick={() => setSelectedTimelineAppId(app.id)}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", app.id);
                            setDraggedAppId(app.id);
                          }}
                          onDragEnd={() => {
                            setDraggedAppId(null);
                            setActiveDragOverColumn(null);
                          }}
                          className={`bg-white p-4 rounded-lg border shadow-sm space-y-3 relative cursor-grab active:cursor-grabbing ${
                            isSelected ? 'ring-2 ring-red-500 border-red-500 bg-red-50/5' : 'border-gray-200'
                          } ${isBeingDragged ? 'opacity-40 border-dashed border-gray-400' : ''}`}
                        >
                          {isSelected && (
                            <span className="absolute top-2 right-2 flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                          )}
                          <div>
                            <h4 className="font-bold text-xs text-gray-900 line-clamp-1 pr-4">{app.grantTitle}</h4>
                            <p className="text-[10px] text-gray-400 mt-0.5">{app.funderName}</p>
                          </div>
                          <div className="text-[10px] font-semibold text-gray-600 flex justify-between">
                            <span>${app.amount.toLocaleString()}</span>
                            <span>Due: {app.deadline}</span>
                          </div>
                          {renderTaskProgressBar(app.notes)}
                          <textarea
                            className="w-full p-2 text-[10px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
                            rows={2}
                            value={app.notes}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleNotesChange(app.id, e.target.value)}
                            placeholder="Add post-rejection analysis..."
                          />
                          <div className="flex justify-between gap-2 border-t border-gray-100 pt-2.5" onClick={(e) => e.stopPropagation()}>
                            <button 
                              onClick={() => handleUpdateApplicationStatus(app.id, 'draft', app.notes || '')}
                              className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-bold py-1 px-3 rounded transition-colors"
                            >
                              Re-draft Proposal
                            </button>
                            <button 
                              onClick={() => handleDeleteApplication(app.id)}
                              className="p-1 text-gray-400 hover:text-red-500 rounded"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {getSortedAppsByStatus('rejected').length === 0 && (
                      <p className="text-[11px] text-gray-400 text-center py-6">No records.</p>
                    )}
                  </div>
                </div>

              </div>

              {/* ==================== SECTION: APPLICATION ACTIVITY TIMELINE ==================== */}
              <div id="timeline-section" className="border-t border-gray-200 pt-8 mt-10 space-y-6">
                <div>
                  <h2 className="text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-600" />
                    Application Activity Timeline & Transition Audits
                  </h2>
                  <p className="text-gray-500 text-xs mt-1">
                    Select a tracked grant card above or from the list below to review its full audit trail and log incremental updates.
                  </p>
                </div>

                {applications.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 text-xs">
                    No tracked applications available. Save a grant from the Explorer to initiate an audit timeline.
                  </div>
                ) : (() => {
                  const activeApp = applications.find(a => a.id === (selectedTimelineAppId || applications[0]?.id)) || applications[0];
                  
                  // Safe fallback history constructor
                  const getHistory = (app: ApplicationTracker) => {
                    if (app.history && app.history.length > 0) {
                      return app.history;
                    }
                    const list: StatusTransition[] = [];
                    const draftDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
                    list.push({
                      id: `${app.id}_init_seed`,
                      status: 'draft',
                      timestamp: draftDate,
                      notes: `Grant seeker saved this opportunity. Core objective mapping and credentials preparation initiated.`,
                      actor: 'Dr. David Anderson'
                    });

                    if (app.status === 'submitted' || app.status === 'awarded' || app.status === 'rejected') {
                      const subDate = app.submittedDate 
                        ? new Date(app.submittedDate).toISOString() 
                        : new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
                      list.push({
                        id: `${app.id}_sub_seed`,
                        status: 'submitted',
                        timestamp: subDate,
                        notes: app.notes || `Submitted full dossier to funding agency. Transmitted via official API channel.`,
                        actor: 'Dr. David Anderson'
                      });
                    }

                    if (app.status === 'awarded') {
                      list.push({
                        id: `${app.id}_award_seed`,
                        status: 'awarded',
                        timestamp: new Date().toISOString(),
                        notes: app.notes || `Award received! Final agreement processed and financial accounts designated.`,
                        actor: 'Office of Sponsored Projects'
                      });
                    } else if (app.status === 'rejected') {
                      list.push({
                        id: `${app.id}_reject_seed`,
                        status: 'rejected',
                        timestamp: new Date().toISOString(),
                        notes: app.notes || `Proposal reviewed but not selected. Archiving for post-mortem analysis and adjustment.`,
                        actor: 'Selection Panel'
                      });
                    }
                    return list;
                  };

                  const history = getHistory(activeApp);
                  const sortedHistory = [...history].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      {/* Left Sidebar: Selector List */}
                      <div className="lg:col-span-1 bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3 h-[480px] overflow-y-auto">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2 px-1">Tracked Portfolios ({applications.length})</span>
                        <div className="space-y-2">
                          {applications.map(app => {
                            const isSelected = activeApp.id === app.id;
                            const statusColors = {
                              draft: 'bg-gray-100 text-gray-700',
                              submitted: 'bg-blue-50 text-blue-700 border-blue-100',
                              awarded: 'bg-emerald-50 text-emerald-700 border-emerald-100',
                              rejected: 'bg-red-50 text-red-700 border-red-100'
                            };

                            return (
                              <button
                                key={app.id}
                                onClick={() => setSelectedTimelineAppId(app.id)}
                                className={`w-full text-left p-3 rounded-lg border text-xs transition-all flex flex-col gap-1.5 cursor-pointer ${
                                  isSelected 
                                    ? 'border-blue-600 bg-blue-50/20 ring-1 ring-blue-500' 
                                    : 'border-gray-200 hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex justify-between items-start gap-2">
                                  <h4 className="font-extrabold text-gray-900 line-clamp-1 flex-1">{app.grantTitle}</h4>
                                  <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border shrink-0 ${statusColors[app.status]}`}>
                                    {app.status}
                                  </span>
                                </div>
                                <div className="flex justify-between text-[10px] text-gray-500">
                                  <span className="truncate max-w-[150px]">{app.funderName}</span>
                                  <span className="font-bold text-gray-700">${app.amount.toLocaleString()}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right Panel: The Interactive Timeline */}
                      <div className="lg:col-span-2 flex flex-col gap-6">
                        
                        {/* Selected Grant Mini-Info & Actions */}
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <div className="flex-1">
                            <span className="text-[9px] font-black bg-blue-100 text-blue-800 px-2 py-0.5 rounded uppercase tracking-wider">Active Audit View</span>
                            <h3 className="font-black text-base text-gray-900 mt-1.5">{activeApp.grantTitle}</h3>
                            <p className="text-xs text-gray-500 mt-0.5">{activeApp.funderName} &bull; Funding Amount: <span className="font-bold text-blue-600">${activeApp.amount.toLocaleString()}</span> &bull; Deadline: <span className="font-medium text-gray-800">{activeApp.deadline}</span></p>
                          </div>
                          
                          <button
                            onClick={() => {
                              const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(sortedHistory, null, 2))}`;
                              const downloadAnchor = document.createElement('a');
                              downloadAnchor.setAttribute("href", jsonString);
                              downloadAnchor.setAttribute("download", `audit_trail_${activeApp.id}.json`);
                              document.body.appendChild(downloadAnchor);
                              downloadAnchor.click();
                              downloadAnchor.remove();
                              triggerToast("Audit history exported to JSON successfully.");
                            }}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold py-2 px-3.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer self-stretch md:self-auto justify-center shrink-0"
                          >
                            <FileText className="w-3.5 h-3.5 text-gray-500" />
                            Export Audit Log
                          </button>
                        </div>

                        {/* Interactive Timeline Log List & Add Log form Split */}
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                          {/* Left: The chronological nodes */}
                          <div className="md:col-span-3 bg-white p-5 rounded-xl border border-gray-200 shadow-sm overflow-y-auto h-[480px]">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Milestone History ({sortedHistory.length})</h4>
                            
                            <div className="relative border-l border-gray-200 ml-4 pl-6 space-y-6 py-2">
                              {sortedHistory.map((item) => {
                                const statusConfigs = {
                                  draft: {
                                    title: 'Draft Saved',
                                    bg: 'bg-gray-100 border-gray-200 text-gray-600',
                                    badge: 'bg-gray-100 text-gray-700'
                                  },
                                  submitted: {
                                    title: 'Proposal Submitted',
                                    bg: 'bg-blue-100 border-blue-200 text-blue-600',
                                    badge: 'bg-blue-100 text-blue-800'
                                  },
                                  awarded: {
                                    title: 'Award Approved 🎉',
                                    bg: 'bg-emerald-100 border-emerald-200 text-emerald-600',
                                    badge: 'bg-emerald-100 text-emerald-800'
                                  },
                                  rejected: {
                                    title: 'Proposal Declined',
                                    bg: 'bg-red-100 border-red-200 text-red-600',
                                    badge: 'bg-red-100 text-red-800'
                                  }
                                };

                                const config = statusConfigs[item.status] || statusConfigs.draft;
                                
                                return (
                                  <div key={item.id} className="relative group">
                                    {/* Circle Icon Indicator */}
                                    <span className={`absolute -left-[35px] top-0.5 flex items-center justify-center w-6 h-6 rounded-full border border-2 ${config.bg} z-10 transition-transform group-hover:scale-110 shadow-sm`}>
                                      <Activity className="w-3 h-3" />
                                    </span>

                                    {/* Timeline Item Content Card */}
                                    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3.5 space-y-2 hover:bg-gray-100/60 transition-colors">
                                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                                        <span className="font-extrabold text-xs text-gray-900">{config.title}</span>
                                        <div className="flex items-center gap-1 text-[10px] text-gray-400">
                                          <Calendar className="w-3 h-3 text-gray-400" />
                                          <span>{new Date(item.timestamp).toLocaleString(undefined, {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                          })}</span>
                                        </div>
                                      </div>

                                      <p className="text-xs text-gray-600 leading-relaxed font-medium">
                                        {item.notes}
                                      </p>

                                      <div className="flex justify-between items-center text-[10px] text-gray-400 font-bold border-t border-gray-200/60 pt-1.5 mt-1.5">
                                        <span className="flex items-center gap-1 text-gray-500">
                                          <User className="w-3 h-3 text-gray-400" />
                                          {item.actor}
                                        </span>
                                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${config.badge}`}>
                                          {item.status}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Right: Add Custom Log entry Form */}
                          <div className="md:col-span-2 bg-white p-5 rounded-xl border border-gray-200 shadow-sm h-fit">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Add Custom Event Log</h4>
                            <p className="text-[11px] text-gray-500 mb-4 leading-normal">
                              Record draft progression, agency communication, reviews, or force state transitions.
                            </p>

                            <form onSubmit={(e) => handleAddTimelineEvent(activeApp.id, e)} className="space-y-4">
                              <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Status/State Transition (Optional)</label>
                                <select
                                  id="timeline-event-status"
                                  value={customTimelineEventStatus}
                                  onChange={(e: any) => setCustomTimelineEventStatus(e.target.value)}
                                  className="block w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                                >
                                  <option value="">Keep Current Status ({activeApp.status})</option>
                                  <option value="draft">Revert to Draft</option>
                                  <option value="submitted">Change to Submitted</option>
                                  <option value="awarded">Mark Awarded! 🎉</option>
                                  <option value="rejected">Mark Declined/Rejected</option>
                                </select>
                              </div>

                              <p className="text-[10px] text-gray-500">Logged as {user.name}.</p>

                              <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Event Details & Comments</label>
                                <textarea
                                  id="timeline-event-notes"
                                  rows={4}
                                  value={customTimelineEventNotes}
                                  onChange={(e) => setCustomTimelineEventNotes(e.target.value)}
                                  placeholder="e.g., Met with NSF program administrator to discuss budget revisions. Preparing supplemental figures."
                                  className="block w-full p-2.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </div>

                              <button
                                id="save-timeline-event-btn"
                                type="submit"
                                disabled={isAddingTimelineEvent}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg text-xs shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                {isAddingTimelineEvent ? (
                                  <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Saving to Audit...
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-3.5 h-3.5" />
                                    Commit Event Log
                                  </>
                                )}
                              </button>
                            </form>
                          </div>
                        </div>

                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ==================== SUBVIEW: SCRAPER TERMINAL ==================== */}
          {activeTab === 'scraper' && (
            <div id="subview-scraper" className="space-y-6">
              <div>
                <h1 className="text-2xl font-black text-gray-900 tracking-tight">AI Web Scraper Subsystem</h1>
                <p className="text-gray-500 text-sm mt-1">The harvester scans configured funder sources automatically and matches new calls to every profile.</p>
              </div>

              {isSuperAdmin && scraperSchedule && (() => {
                const fmt = (iso: string) =>
                  new Date(iso).toLocaleString('en-GB', { timeZone: scraperSchedule.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                const last = scraperSchedule.lastAutomatic;
                return (
                  <section aria-labelledby="auto-scan-heading" className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-wrap gap-x-10 gap-y-4 items-start">
                    <div className="space-y-1 min-w-[14rem]">
                      <h2 id="auto-scan-heading" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" aria-hidden="true" /> Automatic scans
                      </h2>
                      <p className="text-sm font-black text-gray-900">{scraperSchedule.description}</p>
                      <p className="text-[11px] text-gray-500">{scraperSchedule.timezone} · looks for newly launched grant calls</p>
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Next scans</h3>
                      <ul className="text-xs font-semibold text-gray-900 space-y-0.5">
                        {scraperSchedule.nextRuns.map((r) => (
                          <li key={r}><time dateTime={r}>{fmt(r)}</time></li>
                        ))}
                      </ul>
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Last automatic scan</h3>
                      <p className="text-xs text-gray-900">
                        {last ? (
                          <>
                            <time dateTime={last.startedAt}>{fmt(last.startedAt)}</time>{' · '}
                            {last.status === 'running' ? 'running now' : `${last.itemsNew} new of ${last.itemsFound} found${last.status !== 'ok' ? ` (${last.status})` : ''}`}
                          </>
                        ) : (
                          'None yet'
                        )}
                      </p>
                    </div>
                    <div className="ml-auto">
                      {scraperSchedule.workerOnline ? (
                        <span role="status" className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                          <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> Scheduler running
                        </span>
                      ) : (
                        <span role="alert" className="inline-flex items-center gap-1.5 text-[11px] font-bold text-red-800 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
                          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" /> Scheduler offline: scans will not run
                        </span>
                      )}
                    </div>
                  </section>
                );
              })()}

              {!isSuperAdmin && (
                <div role="note" className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs p-4 rounded-xl">
                  <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>Harvest controls and run history are available to platform administrators. New grants appear in your feed automatically.</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-8">
                {/* Trigger Control */}
                <div className="col-span-1 bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-6 h-fit">
                  <div className="border-b border-gray-100 pb-3">
                    <h3 className="font-extrabold text-sm text-gray-900">Trigger New Web Scrape</h3>
                    <p className="text-xs text-gray-400">Forces our indexing agent to parse targeted URLs</p>
                  </div>

                  <form onSubmit={handleTriggerScrape} className="space-y-4">


                    <div>
                      <label htmlFor="scraper-source-input" className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Source</label>
                      <select
                        id="scraper-source-input"
                        value={customScrapeSource}
                        onChange={(e) => setCustomScrapeSource(e.target.value)}
                        disabled={!isSuperAdmin}
                        className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs bg-white"
                      >
                        <option value="">All sources</option>
                        {scraperSources.map((src) => (
                          <option key={src.id} value={src.id}>{src.label}</option>
                        ))}
                      </select>
                    </div>

                    <button
                      id="run-scraper-btn"
                      type="submit"
                      disabled={runningScrape}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg text-xs shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {runningScrape ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Running AI Scraper Agent...
                        </>
                      ) : (
                        <>
                          <Terminal className="w-4 h-4" />
                          Execute Scraper Routine
                        </>
                      )}
                    </button>
                  </form>

                  <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Scraper Features</h4>
                    <ul className="text-xs text-gray-600 space-y-1.5 list-disc pl-4">
                      <li>Frequent polling capability (simulated scheduler)</li>
                      <li>Duplication avoidance via URI indexing</li>
                      <li>Keyword Extraction tags dynamically calculated</li>
                      <li>If Gemini is active, simulates deep site reading</li>
                    </ul>
                  </div>
                </div>

                {/* Scraper Log Console */}
                <div className="col-span-2 flex flex-col gap-6">
                  {scrapeSuccess && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-bold text-green-800">Scrape Job Completed Successfully!</h4>
                        <p className="text-xs text-green-700 mt-1">{scrapeSuccess}</p>
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-900 rounded-xl overflow-hidden flex flex-col shadow-lg border border-gray-800">
                    <div className="bg-gray-900 border-b border-gray-800 px-5 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-red-500 rounded-full"></span>
                        <span className="w-3 h-3 bg-yellow-500 rounded-full"></span>
                        <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                        <span className="text-[10px] font-bold font-mono text-gray-400 uppercase ml-3">scouting_agent_logs.stdout</span>
                      </div>
                      <span className="text-[9px] font-bold font-mono text-blue-400">TELEMETRY LIVE</span>
                    </div>

                    <div className="bg-[#0c1015] p-5 font-mono text-xs text-green-400 space-y-4 overflow-y-auto h-[380px]">
                      <div>
                        <p className="text-gray-500">[2026-07-01T02:20:46Z] INITIALIZING GRANTSEEKER AGENT SERVICE</p>
                        <p className="text-gray-500">[2026-07-01T02:20:47Z] Establishing secure memory buffer indices...</p>
                        <p className="text-gray-500">[2026-07-01T02:20:48Z] Syncing global funder databases: NIH RePORTER, NSF Awards, EU SEDIA</p>
                      </div>

                      {scraperLogs.map((log, index) => (
                        <div key={log.id} className={index === 0 && runningScrape ? "animate-pulse" : ""}>
                          <p className="text-blue-400">
                            [{new Date(log.timestamp).toISOString()}] SCRAPE JOB STARTED &rarr; Source: {log.source}
                          </p>
                          <p className="text-gray-300">
                            &nbsp;&nbsp;+ Executing network queries ... Connection status: 200 OK
                          </p>
                          <p className="text-gray-300">
                            &nbsp;&nbsp;+ Checking index against existing {grants.length} titles to prevent duplication...
                          </p>
                          <p className={log.status === 'success' ? "text-green-400" : "text-red-400"}>
                            &nbsp;&nbsp;&gt; Status: {log.status.toUpperCase()} - Extracted {log.itemsExtracted} items. {log.message}
                          </p>
                        </div>
                      ))}

                      {runningScrape && (
                        <div className="animate-pulse">
                          <p className="text-yellow-400">[PENDING] Executing recursive web parse...</p>
                          <p className="text-gray-500">&nbsp;&nbsp;&nbsp;Generating embeddings via BAAI/bge-m3 logic...</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SUBVIEW: NOTIFICATIONS ==================== */}
          {activeTab === 'notifications' && (
            <div id="subview-notifications" className="space-y-6">
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-2xl font-black text-gray-900 tracking-tight">Notification Center</h1>
                  <p className="text-gray-500 text-sm mt-1">Real-time alerts, high similarity alerts, and critical deadline warnings.</p>
                </div>
                {unreadCount > 0 && (
                  <button 
                    id="mark-all-read"
                    onClick={handleMarkAllNotificationsRead}
                    className="text-xs bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl border border-gray-200 font-bold transition-all cursor-pointer"
                  >
                    Mark All as Read
                  </button>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="divide-y divide-gray-100">
                  {notifications.map((notif) => (
                    <div 
                      key={notif.id} 
                      className={`p-5 flex items-start gap-4 transition-all ${notif.read ? 'bg-white opacity-80' : 'bg-blue-50/20'}`}
                    >
                      <div className={`p-2.5 rounded-lg shrink-0 ${notif.type === 'deadline' ? 'bg-red-50 text-red-600' : notif.type === 'match_alert' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                        {notif.type === 'deadline' ? <Calendar className="w-5 h-5" /> : notif.type === 'match_alert' ? <Sparkles className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                      </div>

                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <h4 className={`text-sm ${notif.read ? 'font-bold text-gray-700' : 'font-extrabold text-gray-900'}`}>{notif.title}</h4>
                          <span className="text-[10px] text-gray-400 font-semibold font-mono">{new Date(notif.date).toLocaleString()}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 leading-relaxed">{notif.message}</p>
                        
                        {notif.grantId && (
                          <button 
                            onClick={() => {
                              const grant = grants.find(g => g.id === notif.grantId);
                              if (grant) handleOpenGrantDetail(grant);
                            }}
                            className="text-[11px] text-blue-600 font-bold hover:underline mt-2 flex items-center gap-1 cursor-pointer"
                          >
                            Explore Scoped Opportunity Details &rarr;
                          </button>
                        )}
                      </div>

                      {!notif.read && (
                        <button 
                          onClick={() => handleMarkNotificationRead(notif.id)}
                          className="text-[10px] bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 px-2 py-1 rounded font-bold cursor-pointer transition-all shrink-0"
                        >
                          Mark Read
                        </button>
                      )}
                    </div>
                  ))}

                  {notifications.length === 0 && (
                    <div className="py-16 text-center text-gray-400">
                      <Bell className="w-8 h-8 text-gray-300 mx-auto" />
                      <h4 className="font-bold text-sm text-gray-800 mt-3">You have no new notifications</h4>
                      <p className="text-xs text-gray-500 mt-1">Our scanning agents are checking sources frequently.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==================== SUBVIEW: PROFILE ==================== */}
          {activeTab === 'profile' && (
            <div id="subview-profile" className="max-w-2xl bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-6">
              <div className="border-b border-gray-100 pb-4">
                <h1 className="text-xl font-black text-gray-900 tracking-tight">Match Profile Preferences</h1>
                <p className="text-gray-500 text-xs mt-1">Calibrate the intelligence weighting matrices and AI vector alignments.</p>
              </div>

              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Profile Name</label>
                    <input 
                      id="profile-name"
                      type="text" 
                      value={user.name}
                      onChange={(e) => setUser({ ...user, name: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Scouting Role</label>
                    <select 
                      id="profile-role"
                      value={user.role}
                      onChange={(e) => setUser({ ...user, role: e.target.value as UserRole })}
                      className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs cursor-pointer"
                    >
                      <option value="academic">Academic Researcher</option>
                      <option value="industry">Industry Innovator</option>
                      <option value="student">Graduate Student / Thesis Seeker</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Affiliated Organization</label>
                    <input 
                      id="profile-org"
                      type="text"
                      readOnly
                      value={user.organization || 'Independent researcher'}
                      aria-describedby="profile-org-hint"
                      className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs bg-gray-50 text-gray-600"
                    />
                    <p id="profile-org-hint" className="text-[10px] text-gray-500 mt-1">Changed by your organization's administrator.</p>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Geographic Location</label>
                    <input 
                      id="profile-region"
                      type="text" 
                      value={user.region}
                      onChange={(e) => setUser({ ...user, region: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Research Interests (Comma separated)</label>
                  <input 
                    id="profile-interests"
                    type="text" 
                    value={user.researchInterests.join(', ')}
                    onChange={(e) => setUser({ ...user, researchInterests: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Academic Qualifications & Bio</label>
                  <textarea 
                    id="profile-quals"
                    rows={3}
                    value={user.qualifications}
                    onChange={(e) => setUser({ ...user, qualifications: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Past Research Projects & Achievements</label>
                  <textarea 
                    id="profile-past-projects"
                    rows={3}
                    placeholder="Describe your prominent past research projects, publications, or award histories..."
                    value={user.pastProjects || ''}
                    onChange={(e) => setUser({ ...user, pastProjects: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Academic Publications, Citation Metrics & Patents</label>
                  <textarea 
                    id="profile-past-publications"
                    rows={3}
                    placeholder="List your publication titles, citation metrics (e.g. h-index), or patented innovations..."
                    value={user.pastPublications || ''}
                    onChange={(e) => setUser({ ...user, pastPublications: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Detailed Project Idea & Scope Descriptions</label>
                  <textarea 
                    id="profile-project-descriptions"
                    rows={3}
                    placeholder="Provide a detailed description of the project you are planning to scout funding for (objectives, methods, outcomes)..."
                    value={user.projectDescriptions || ''}
                    onChange={(e) => setUser({ ...user, projectDescriptions: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Active Project Team Members & Roles</label>
                  <textarea 
                    id="profile-team-members"
                    rows={3}
                    placeholder="List key team members, co-PIs, and specialized computational or subject experts..."
                    value={user.teamMembers || ''}
                    onChange={(e) => setUser({ ...user, teamMembers: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Minimum Funding Needed Cap ($)</label>
                  <input 
                    id="profile-min-funding"
                    type="number" 
                    value={user.fundingNeedsMin}
                    onChange={(e) => setUser({ ...user, fundingNeedsMin: Number(e.target.value) })}
                    className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                  />
                </div>

                <div className="border-t border-gray-100 pt-4 mt-4 space-y-4">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Collaboration & Consortia Preferences</h3>
                  
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div>
                      <span className="block text-xs font-bold text-gray-700">Public Collaboration Profile</span>
                      <span className="block text-[10px] text-gray-400">Allow other researchers to search for you in the Collaboration Hub</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={user.isPublicProfile !== false}
                        onChange={(e) => setUser({ ...user, isPublicProfile: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Institution Affiliation</label>
                      <input 
                        id="profile-institution"
                        type="text" 
                        placeholder="University of Science, Department of Neural Systems"
                        value={user.institution || ''}
                        onChange={(e) => setUser({ ...user, institution: e.target.value })}
                        className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Collaboration Interests (Comma separated)</label>
                      <input 
                        id="profile-colab-interests"
                        type="text" 
                        placeholder="Neural engineering, Edge computing, Medical AI"
                        value={user.collaborationInterests ? user.collaborationInterests.join(', ') : ''}
                        onChange={(e) => setUser({ 
                          ...user, 
                          collaborationInterests: e.target.value.split(',').map(s => s.trim()).filter(Boolean) 
                        })}
                        className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    id="save-profile-btn"
                    type="submit"
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all cursor-pointer"
                  >
                    Save Changes & Re-Align Intelligence
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ==================== SUBVIEW: COLLABORATION HUB ==================== */}
          {activeTab === 'collaboration' && (
            <div id="subview-collaboration" className="space-y-6">
              
              {/* Header section with top category buttons */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <div>
                  <h1 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-600" />
                    Collaborative Research Hub
                  </h1>
                  <p className="text-gray-500 text-xs mt-1">
                    Form scientific consortia, coordinate grant proposals, and communicate securely with co-investigators.
                  </p>
                </div>
                
                {/* View Switch Mode tabs */}
                <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 self-stretch md:self-auto">
                  <button
                    onClick={() => setColabViewMode('consortia')}
                    className={`flex-1 md:flex-none px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${colabViewMode === 'consortia' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    My Consortia & Teams
                  </button>
                  <button
                    onClick={() => { setColabViewMode('discover'); fetchColabUsers(); }}
                    className={`flex-1 md:flex-none px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${colabViewMode === 'discover' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                  >
                    <Search className="w-3.5 h-3.5" />
                    Discover Collaborators
                  </button>
                </div>
              </div>

              {colabViewMode === 'consortia' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  
                  {/* Left Column: Consortia List & Create form */}
                  <div className="lg:col-span-1 space-y-6">
                    
                    {/* Active Joined Consortia */}
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                      <div className="border-b border-gray-100 pb-2 flex justify-between items-center">
                        <h2 className="font-extrabold text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-blue-600" />
                          My Active Teams ({teams.filter(t => t.memberIds.includes(user.id)).length})
                        </h2>
                      </div>
                      
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                        {teams.filter(t => t.memberIds.includes(user.id)).map(team => (
                          <div 
                            key={team.id} 
                            onClick={() => { setSelectedTeam(team); setColabSubTab('chat'); }}
                            className={`p-4 rounded-lg border text-left cursor-pointer transition-all ${selectedTeam?.id === team.id ? 'border-blue-500 bg-blue-50/20 shadow-sm' : 'border-gray-200 hover:bg-gray-50'}`}
                          >
                            <div className="flex justify-between items-start">
                              <h3 className="font-bold text-xs text-gray-900 flex items-center gap-1">
                                {team.name}
                                {team.isPrivate ? (
                                  <Lock className="w-3 h-3 text-amber-500" title="Private Consortium" />
                                ) : (
                                  <Unlock className="w-3 h-3 text-emerald-500" title="Public Consortium" />
                                )}
                              </h3>
                              <span className="text-[10px] text-gray-400 font-semibold">{team.memberCount} members</span>
                            </div>
                            <p className="text-[10px] text-gray-500 line-clamp-2 mt-1">{team.description || 'No description provided.'}</p>
                            
                            <div className="flex justify-between items-center mt-3 pt-2 border-t border-gray-100">
                              <span className="text-[9px] text-gray-400 font-semibold">Led by: {team.creatorName}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); leaveTeam(team.id); }}
                                className="text-[9px] text-red-500 hover:text-red-700 font-bold transition-colors cursor-pointer"
                              >
                                Leave
                              </button>
                            </div>
                          </div>
                        ))}
                        {teams.filter(t => t.memberIds.includes(user.id)).length === 0 && (
                          <p className="text-xs text-gray-400 italic text-center py-4">You have not joined or formed any research teams yet.</p>
                        )}
                      </div>
                    </div>

                    {/* Create Consortium Form */}
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                      <div className="border-b border-gray-100 pb-2">
                        <h2 className="font-extrabold text-xs uppercase tracking-wider text-gray-500">
                          Form New Consortium
                        </h2>
                        <p className="text-[10px] text-gray-400">Launch a private or public project team to coordinate submissions</p>
                      </div>

                      <form onSubmit={createTeam} className="space-y-3.5">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Team / Consortium Name</label>
                          <input 
                            type="text"
                            required
                            placeholder="e.g. Brain-Computer Interface Team"
                            value={newTeamName}
                            onChange={(e) => setNewTeamName(e.target.value)}
                            className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Scope / Research Objectives</label>
                          <textarea 
                            rows={3}
                            placeholder="Briefly state the research focus, targeted funding calls, or team capabilities..."
                            value={newTeamDesc}
                            onChange={(e) => setNewTeamDesc(e.target.value)}
                            className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                          />
                        </div>

                        <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                          <div>
                            <span className="block text-xs font-bold text-gray-700">Private Consortium</span>
                            <span className="block text-[9px] text-gray-400">Restricts membership to explicit invites only</span>
                          </div>
                          <input 
                            type="checkbox"
                            checked={newTeamPrivate}
                            onChange={(e) => setNewTeamPrivate(e.target.checked)}
                            className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                          />
                        </div>

                        <button 
                          type="submit"
                          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Launch Consortium
                        </button>
                      </form>
                    </div>

                    {/* Joinable Public Teams */}
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                      <div className="border-b border-gray-100 pb-2">
                        <h2 className="font-extrabold text-xs uppercase tracking-wider text-gray-500">
                          Discover Public Consortia
                        </h2>
                      </div>
                      
                      <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
                        {teams.filter(t => !t.memberIds.includes(user.id) && !t.isPrivate).map(team => (
                          <div key={team.id} className="p-3 rounded-lg border border-gray-100 bg-gray-50/30 flex justify-between items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-xs text-gray-900 truncate">{team.name}</h4>
                              <p className="text-[10px] text-gray-500 line-clamp-2 mt-0.5">{team.description || 'No description provided.'}</p>
                              <div className="flex gap-2 items-center mt-2">
                                <span className="text-[9px] text-gray-400 font-semibold">Leader: {team.creatorName}</span>
                                <span className="text-[9px] text-gray-400">•</span>
                                <span className="text-[9px] text-gray-400 font-semibold">{team.memberCount} members</span>
                              </div>
                            </div>
                            <button
                              onClick={() => joinTeam(team.id)}
                              className="px-2.5 py-1 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-blue-600 font-bold text-[10px] rounded shrink-0 transition-colors cursor-pointer"
                            >
                              Join
                            </button>
                          </div>
                        ))}
                        {teams.filter(t => !t.memberIds.includes(user.id) && !t.isPrivate).length === 0 && (
                          <p className="text-xs text-gray-400 italic text-center py-2">No other public consortia currently active.</p>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Right Column: Active Team Workspace */}
                  <div className="lg:col-span-2">
                    {selectedTeam ? (
                      <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col h-[760px] overflow-hidden">
                        
                        {/* Workspace Header */}
                        <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="text-base font-black text-gray-900">{selectedTeam.name}</h2>
                              {selectedTeam.isPrivate ? (
                                <span className="px-2 py-0.5 rounded text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-100 flex items-center gap-1">
                                  <Lock className="w-2.5 h-2.5" /> Private Consortium
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 flex items-center gap-1">
                                  <Unlock className="w-2.5 h-2.5" /> Public Consortium
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 mt-1">{selectedTeam.description || 'Shared research project workspace.'}</p>
                            <p className="text-[9px] text-gray-400 mt-1 font-semibold">Founded by: {selectedTeam.creatorName} • Active since: {new Date(selectedTeam.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>

                        {/* Workspace Subtabs */}
                        <div className="border-b border-gray-100 px-6 flex shrink-0">
                          <button
                            onClick={() => setColabSubTab('chat')}
                            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${colabSubTab === 'chat' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
                          >
                            <MessageSquare className="w-4 h-4" />
                            Secure Team Chat
                          </button>
                          <button
                            onClick={() => setColabSubTab('shared_grants')}
                            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${colabSubTab === 'shared_grants' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
                          >
                            <Share2 className="w-4 h-4" />
                            Shared Opportunities
                            {teamGrants.length > 0 && (
                              <span className="bg-blue-100 text-blue-700 rounded-full text-[9px] px-1.5 py-0.5 font-extrabold">{teamGrants.length}</span>
                            )}
                          </button>
                          <button
                            onClick={() => setColabSubTab('members')}
                            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${colabSubTab === 'members' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
                          >
                            <Users className="w-4 h-4" />
                            Team Members
                            <span className="bg-gray-100 text-gray-600 rounded-full text-[9px] px-1.5 py-0.5 font-extrabold">{teamMembers.length}</span>
                          </button>
                        </div>

                        {/* Subtab Content Area */}
                        <div className="flex-1 p-6 overflow-y-auto min-h-0 bg-gray-50/30">
                          
                          {/* Chat Tab */}
                          {colabSubTab === 'chat' && (
                            <div className="flex flex-col h-full">
                              <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
                                {teamMessages.map((msg) => {
                                  const isSelf = msg.senderId === user.id;
                                  return (
                                    <div 
                                      key={msg.id} 
                                      className={`flex flex-col max-w-[80%] ${isSelf ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                                    >
                                      <span className="text-[10px] text-gray-400 font-semibold mb-1">
                                        {msg.senderName} • {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                      </span>
                                      <div className={`p-3 rounded-xl text-xs leading-relaxed shadow-sm ${isSelf ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none'}`}>
                                        {msg.content}
                                      </div>
                                    </div>
                                  );
                                })}
                                {teamMessages.length === 0 && (
                                  <div className="h-full flex flex-col items-center justify-center text-center py-12 text-gray-400 space-y-2">
                                    <MessageSquare className="w-8 h-8 text-gray-200" />
                                    <p className="text-xs font-medium">No secure messages yet. Start the coordination dialogue below!</p>
                                  </div>
                                )}
                              </div>

                              {/* Chat Composer */}
                              <div className="flex gap-2 shrink-0 border-t border-gray-100 pt-4 bg-white">
                                <input 
                                  type="text"
                                  value={newMessageText}
                                  onChange={(e) => setNewMessageText(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') sendTeamMessage(); }}
                                  placeholder="Type a secure message to co-investigators..."
                                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs"
                                />
                                <button
                                  onClick={sendTeamMessage}
                                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  Send
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Shared Opportunities Tab */}
                          {colabSubTab === 'shared_grants' && (
                            <div className="space-y-4">
                              {teamGrants.map((sg) => {
                                if (!sg.grant) return null;
                                return (
                                  <div key={sg.id} className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm space-y-4">
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-gray-100 pb-3">
                                      <div>
                                        <h3 className="font-extrabold text-xs text-gray-900">{sg.grant.title}</h3>
                                        <p className="text-[10px] text-gray-400 mt-0.5">Funder: {sg.grant.funderName} • Shared by: {sg.sharedByName}</p>
                                      </div>
                                      
                                      {/* Interactive status selector */}
                                      <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                          sg.status === 'awarded' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                          sg.status === 'submitted' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                                          sg.status === 'drafting' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                          sg.status === 'rejected' ? 'bg-red-50 text-red-700 border border-red-200' :
                                          'bg-gray-100 text-gray-600 border border-gray-200'
                                        }`}>
                                          {sg.status}
                                        </span>
                                        <select
                                          value={sg.status}
                                          onChange={(e) => updateTeamGrantStatus(selectedTeam.id, sg.grantId, e.target.value)}
                                          className="text-[10px] border border-gray-200 rounded px-2 py-0.5 bg-gray-50 font-bold text-gray-600 cursor-pointer"
                                        >
                                          <option value="planning">Consortium Planning</option>
                                          <option value="drafting">Proposal Drafting</option>
                                          <option value="submitted">Submitted</option>
                                          <option value="awarded">Awarded</option>
                                          <option value="rejected">Rejected</option>
                                        </select>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-4 text-[10px] font-semibold text-gray-600">
                                      <div>
                                        <span className="text-gray-400 block font-normal uppercase tracking-wider text-[8px]">Value Goal</span>
                                        ${sg.grant.amount.toLocaleString()}
                                      </div>
                                      <div>
                                        <span className="text-gray-400 block font-normal uppercase tracking-wider text-[8px]">Submission Deadline</span>
                                        {sg.grant.deadline}
                                      </div>
                                      <div>
                                        <span className="text-gray-400 block font-normal uppercase tracking-wider text-[8px]">Regions Scope</span>
                                        {sg.grant.eligibleRegions.join(', ')}
                                      </div>
                                    </div>

                                    {sg.notes && (
                                      <div className="p-3 bg-gray-50 border border-gray-100 rounded-lg text-xs italic text-gray-600">
                                        <span className="font-bold text-[9px] uppercase tracking-wider text-gray-400 block not-italic mb-1">Shared Notes / Coordination Strategy</span>
                                        &ldquo;{sg.notes}&rdquo;
                                      </div>
                                    )}

                                    <div className="flex justify-end pt-2">
                                      <button
                                        onClick={() => setSelectedGrant(sg.grant!)}
                                        className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
                                      >
                                        Inspect Complete AI Match Matrix & Details &rarr;
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                              {teamGrants.length === 0 && (
                                <div className="text-center py-12 text-gray-400 space-y-2">
                                  <Share2 className="w-8 h-8 text-gray-200 mx-auto" />
                                  <p className="text-xs font-medium">No grant opportunities shared with this team yet.</p>
                                  <p className="text-[10px] text-gray-400 max-w-sm mx-auto">Browse opportunities on the Grant Explorer and click "Share Opportunity" to coordinate proposals collectively.</p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Team Members Tab */}
                          {colabSubTab === 'members' && (
                            <div className="space-y-6">
                              
                              {/* Current Members list */}
                              <div className="space-y-3">
                                <h3 className="font-extrabold text-xs text-gray-500 uppercase tracking-wider">Current Consortium Investigators</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {teamMembers.map((member) => (
                                    <div key={member.id} className="p-4 rounded-lg bg-white border border-gray-200 flex items-start gap-3 shadow-sm">
                                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold shrink-0 text-xs">
                                        {member.name.substring(0, 2).toUpperCase()}
                                      </div>
                                      <div>
                                        <h4 className="font-bold text-xs text-gray-900">{member.name}</h4>
                                        <span className="text-[10px] font-semibold text-blue-600 block mt-0.5 capitalize">{member.role}</span>
                                        <span className="text-[10px] text-gray-400 block mt-0.5">{member.institution || member.organization || 'Independent Investigator'}</span>
                                        {member.researchInterests && member.researchInterests.length > 0 && (
                                          <div className="flex flex-wrap gap-1.5 mt-2">
                                            {member.researchInterests.slice(0, 3).map((ri, i) => (
                                              <span key={i} className="px-1.5 py-0.5 rounded text-[8px] bg-gray-100 text-gray-600 font-bold font-mono">
                                                {ri}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Invite Public Researchers: the API lets only the team owner add people */}
                              {selectedTeam.isOwner ? (
                              <div className="border-t border-gray-100 pt-6 space-y-4">
                                <h3 className="font-extrabold text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">
                                  <UserPlus className="w-3.5 h-3.5 text-blue-600" />
                                  Invite New Public Investigators to Consortium
                                </h3>
                                <p className="text-[10px] text-gray-400">Add other platform scientists with mutual academic interests to your consortium team</p>

                                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                                  {colabUsers.filter(u => !selectedTeam.memberIds.includes(u.id)).map((cUser) => (
                                    <div key={cUser.id} className="p-3 bg-white border border-gray-100 hover:border-gray-200 rounded-lg flex justify-between items-center gap-4">
                                      <div>
                                        <h4 className="font-bold text-xs text-gray-900">{cUser.name}</h4>
                                        <span className="text-[10px] text-gray-400 block">{cUser.institution || cUser.organization || 'Independent'}</span>
                                        {cUser.collaborationInterests && cUser.collaborationInterests.length > 0 && (
                                          <p className="text-[10px] text-blue-600 mt-1">Interests: {cUser.collaborationInterests.join(', ')}</p>
                                        )}
                                      </div>
                                      <button
                                        onClick={() => inviteMember(selectedTeam.id, cUser.id)}
                                        className="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold text-[10px] rounded transition-all cursor-pointer"
                                      >
                                        Invite & Add
                                      </button>
                                    </div>
                                  ))}
                                  {colabUsers.filter(u => !selectedTeam.memberIds.includes(u.id)).length === 0 && (
                                    <p className="text-[11px] text-gray-400 italic text-center py-2">No additional public investigators found matching targeted expertise filters. Browse the directory tab to inspect further.</p>
                                  )}
                                </div>
                              </div>
                              ) : (
                                <p className="border-t border-gray-100 pt-6 text-[11px] text-gray-500">Only the team owner can add members.</p>
                              )}

                            </div>
                          )}

                        </div>

                      </div>
                    ) : (
                      <div className="h-[760px] flex flex-col items-center justify-center text-center p-8 bg-white rounded-xl border border-gray-200 shadow-sm space-y-4">
                        <Users className="w-16 h-16 text-gray-200" />
                        <h2 className="text-sm font-extrabold text-gray-900">Consortia Subsystem Ready</h2>
                        <p className="text-xs text-gray-400 max-w-md">Select a research team from your sidebar or launch a brand new scientific consortium to access real-time secure communication and collaborative proposal planning.</p>
                      </div>
                    )}
                  </div>

                </div>
              ) : (
                /* Discover Collaborators Directory subview */
                <div className="space-y-6">
                  
                  {/* Search Directory Filters */}
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                    <div className="border-b border-gray-100 pb-2">
                      <h2 className="font-extrabold text-xs uppercase tracking-wider text-gray-500">
                        Scientific Collaborators Directory
                      </h2>
                      <p className="text-[10px] text-gray-400">Query other global platform investigators indicating active interest in mutual research programs</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="md:col-span-2 relative">
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                        <input 
                          type="text"
                          placeholder="Search scientists by name, bio, qualifications, past projects..."
                          value={searchColabQuery}
                          onChange={(e) => { setSearchColabQuery(e.target.value); fetchColabUsers(e.target.value, searchColabExpertise, searchColabInstitution); }}
                          className="block w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-xs"
                        />
                      </div>
                      
                      <div>
                        <input 
                          type="text"
                          placeholder="Filter by Expertise / Topic"
                          value={searchColabExpertise}
                          onChange={(e) => { setSearchColabExpertise(e.target.value); fetchColabUsers(searchColabQuery, e.target.value, searchColabInstitution); }}
                          className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                        />
                      </div>

                      <div>
                        <input 
                          type="text"
                          placeholder="Filter by Institution / School"
                          value={searchColabInstitution}
                          onChange={(e) => { setSearchColabInstitution(e.target.value); fetchColabUsers(searchColabQuery, searchColabExpertise, e.target.value); }}
                          className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Results Grid */}
                  {loadingColab ? (
                    <div className="flex items-center justify-center gap-3 py-16 text-xs font-semibold text-gray-500 bg-white rounded-xl border border-gray-200 shadow-sm">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                      Interrogating global investigator databases...
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {colabUsers.map((colabUser) => (
                        <div key={colabUser.id} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between space-y-4">
                          <div className="space-y-3">
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-lg flex items-center justify-center text-blue-700 font-black text-xs shrink-0">
                                {colabUser.name.substring(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-bold text-xs text-gray-900 truncate">{colabUser.name}</h3>
                                <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 block w-fit mt-1 capitalize">{colabUser.role}</span>
                              </div>
                            </div>

                            <p className="text-[10px] text-gray-400 font-semibold flex items-center gap-1">
                              <Building className="w-3 h-3 text-gray-400" />
                              {colabUser.institution || colabUser.organization || 'Independent Scholar'}
                            </p>

                            {colabUser.qualifications && (
                              <p className="text-[10px] text-gray-500 line-clamp-2 italic leading-relaxed">&ldquo;{colabUser.qualifications}&rdquo;</p>
                            )}

                            {colabUser.researchInterests && colabUser.researchInterests.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider block">Areas of Study</span>
                                <div className="flex flex-wrap gap-1">
                                  {colabUser.researchInterests.map((ri, i) => (
                                    <span key={i} className="px-1.5 py-0.5 rounded text-[8px] bg-gray-50 text-gray-600 border border-gray-150 font-bold font-mono">
                                      {ri}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {colabUser.collaborationInterests && colabUser.collaborationInterests.length > 0 && (
                              <div className="space-y-1 pt-1">
                                <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider block">Collaboration Goals</span>
                                <div className="flex flex-wrap gap-1">
                                  {colabUser.collaborationInterests.map((ci, i) => (
                                    <span key={i} className="px-1.5 py-0.5 rounded text-[8px] bg-blue-50 text-blue-700 font-bold font-mono">
                                      {ci}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="pt-4 border-t border-gray-100 flex gap-2">
                            {selectedTeam ? (
                              <button
                                onClick={() => inviteMember(selectedTeam.id, colabUser.id)}
                                className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-1"
                              >
                                <UserPlus className="w-3 h-3" />
                                Add to {selectedTeam.name.split(' ')[0]}
                              </button>
                            ) : (
                              <p className="text-[10px] text-gray-400 italic">Select a team in Consortia workspace to invite this researcher.</p>
                            )}
                          </div>
                        </div>
                      ))}
                      {colabUsers.length === 0 && (
                        <div className="col-span-full bg-white py-16 text-center text-gray-400 rounded-xl border border-gray-200 shadow-sm space-y-2">
                          <Users className="w-10 h-10 text-gray-200 mx-auto" />
                          <p className="text-xs font-semibold">No global researchers found matching search parameters.</p>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}

            </div>
          )}

          {/* ==================== SUBVIEW: AI PROPOSAL ASSISTANT ==================== */}
          {activeTab === 'assistant' && (
            <div id="subview-assistant" className="space-y-6">
              
              <div>
                <h1 className="text-2xl font-black text-gray-900 tracking-tight">AI Proposal Assistant</h1>
                <p className="text-gray-500 text-sm mt-1">Check your eligibility, start the application and draft it here, grounded in your matched profile.</p>
              </div>

              {assistantGrantId && (
                <React.Fragment key={assistantGrantId}>
                  <ApplicationReadiness
                    grantId={assistantGrantId}
                    refreshKey={assistantRefresh}
                    onToast={triggerToast}
                    onRunMode={handleAssistantStep}
                    onContext={setAssistantApp}
                  />
                </React.Fragment>
              )}

              {/* Grid Workbench */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Left Column - Controls & Input Context (5 cols) */}
                <div className="lg:col-span-5 space-y-6">
                  
                  {/* Step 1: Selection & Template Repository */}
                  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">1. Selected Grant Opportunity</label>
                        {assistantGrantId && (
                          <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                            Active Match
                          </span>
                        )}
                      </div>
                      <select 
                        id="assistant-grant-selector"
                        value={assistantGrantId}
                        onChange={(e) => {
                          setAssistantGrantId(e.target.value);
                          setAssistantApp(null);
                          setAssistantResponse('');
                        }}
                        className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs cursor-pointer font-medium text-gray-800"
                      >
                        <option value="">-- Choose a Grant to Draft For --</option>
                        {grants.map(g => (
                          <option key={g.id} value={g.id}>
                            {g.funderName.split(' ')[0]}: {g.title.substring(0, 55)}... (${g.fundingAmount.toLocaleString()})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Quick-Load Templates Repository */}
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Template Repository & Outlines
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            setAssistantDraftText(`## Project Title: Advanced Computational Scaffolding

### 1. Executive Summary
This research project aims to establish next-generation bioinformatics infrastructures utilizing scalable container networks and custom-trained model parameters. Our main focus is addressing the critical computational gaps in genomic and molecular data modeling...

### 2. Specific Aims & Technical Framework
- Aim 1: Design and optimize distributed high-performance computing pipelines...
- Aim 2: Develop robust visual scaffolding tools for biological sequences...

### 3. Timeline, Milestones, & Expected Impact
We expect to validate initial pipelines by Q3 and deploy open-source packages in Q4.`);
                            triggerToast("Loaded Research Grant Proposal template!");
                          }}
                          className="p-2 border border-dashed border-gray-200 hover:border-blue-400 rounded-lg hover:bg-blue-50/20 text-left cursor-pointer transition-all"
                        >
                          <span className="block font-bold text-[11px] text-gray-800">🔬 Research Grant</span>
                          <span className="text-[9px] text-gray-400 block mt-0.5">Summary, Technical aims, Timeline</span>
                        </button>

                        <button
                          onClick={() => {
                            setAssistantDraftText(`## Proposal for Equipment Upgrade: High-Throughput Seq-Scaffolding Node

### 1. Project Background & Technical Need
To accelerate molecular diagnostics and machine learning analysis, our lab requires a high-performance compute station containing triple-redundant graphics processing blocks and liquid-cooled core nodes. This equipment will solve the long model compile bottlenecks...

### 2. Management & Shared Access Plan
The proposed server node will be housed at the University Compute Core and shared among 12 key project investigators under a secure round-robin scheduling framework...`);
                            triggerToast("Loaded Equipment/Infrastructure Grant template!");
                          }}
                          className="p-2 border border-dashed border-gray-200 hover:border-blue-400 rounded-lg hover:bg-blue-50/20 text-left cursor-pointer transition-all"
                        >
                          <span className="block font-bold text-[11px] text-gray-800">🖥️ Equipment & Infrastructure</span>
                          <span className="text-[9px] text-gray-400 block mt-0.5">Technical needs, Shared access plan</span>
                        </button>

                        <button
                          onClick={() => {
                            setAssistantDraftText(`## Scientific Delegation & Global Transfer Consortium

### 1. Purpose of Travel & Collaborative Activities
This proposal requests funding for travel and research residency at the European Bioinformatics Consortium. The trip aims to establish a shared dataset schema and finalize model alignment metrics between transatlantic project groups...

### 2. Expected Technical Outcomes
Establish joint publication drafts, run physical calibration tests on the shared sequence scanner, and host a collaborative hackathon.`);
                            triggerToast("Loaded Travel & Collaboration Grant template!");
                          }}
                          className="p-2 border border-dashed border-gray-200 hover:border-blue-400 rounded-lg hover:bg-blue-50/20 text-left cursor-pointer transition-all"
                        >
                          <span className="block font-bold text-[11px] text-gray-800">✈️ Travel & Collaboration</span>
                          <span className="text-[9px] text-gray-400 block mt-0.5">Joint residencies, Transnational hackathons</span>
                        </button>

                        <button
                          onClick={() => {
                            setAssistantDraftText(`## Educational Outreach & Community Computational Bootcamps

### 1. Educational Objective & Curriculum Outline
To bridge the technology gap, we propose conducting 4 intensive weekend workshops on artificial intelligence fundamentals for community college teachers. This curriculum will cover neural nets, sequence parsing, and ethical AI...

### 2. Broad Impacts & Assessment Plan
The bootcamp expects to reach 100+ educators, who will introduce computational thinking models to over 2,000 diverse students annually.`);
                            triggerToast("Loaded Outreach & Training template!");
                          }}
                          className="p-2 border border-dashed border-gray-200 hover:border-blue-400 rounded-lg hover:bg-blue-50/20 text-left cursor-pointer transition-all"
                        >
                          <span className="block font-bold text-[11px] text-gray-800">🎓 Outreach & Education</span>
                          <span className="text-[9px] text-gray-400 block mt-0.5">Bootcamps, Outreach broad impacts</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Integrated Profile Calibration Inputs (Overrides) */}
                  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">2. Profile Context (Pre-Loaded)</span>
                      <span className="text-[9px] text-gray-400 italic">Overrides do not alter main settings</span>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-500 uppercase mb-1">Target Research Focus Area</label>
                        <input 
                          type="text" 
                          value={assistantResearchArea}
                          onChange={(e) => setAssistantResearchArea(e.target.value)}
                          className="block w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs text-gray-700"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] font-semibold text-gray-500 uppercase mb-1">Relevant Past Projects & Achievements</label>
                        <textarea 
                          rows={2}
                          value={assistantPastProjects}
                          onChange={(e) => setAssistantPastProjects(e.target.value)}
                          className="block w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-[11px] text-gray-600 leading-normal"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] font-semibold text-gray-500 uppercase mb-1">Project Co-PIs & Team Members</label>
                        <textarea 
                          rows={2}
                          value={assistantTeamMembers}
                          onChange={(e) => setAssistantTeamMembers(e.target.value)}
                          className="block w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-[11px] text-gray-600 leading-normal"
                        />
                      </div>
                    </div>
                  </div>

                </div>

                {/* Right Column - Workspace & AI Panel (7 cols) */}
                <div className="lg:col-span-7 space-y-6">
                  
                  {/* Selector Modes for Assistant Actions */}
                  <div id="assistant-workspace" className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4 scroll-mt-4">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <h2 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                        <Settings className="w-3.5 h-3.5 text-blue-600" /> Choose Assistant Workspace Action
                      </h2>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <button
                        onClick={() => {
                          setAssistantMode('eligibility');
                          setAssistantResponse(assistantApp?.proposal?.body?.drafts?.eligibility?.text ?? '');
                        }}
                        className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${assistantMode === 'eligibility' ? 'border-blue-600 bg-blue-50/50 text-blue-700 shadow-sm' : 'border-gray-100 hover:bg-gray-50 text-gray-600'}`}
                      >
                        <ShieldCheck className="w-4 h-4 mx-auto mb-1.5 text-emerald-600" />
                        <span className="block font-bold text-xs">Eligibility Review</span>
                        <span className="text-[9px] text-gray-400 block mt-0.5">Go / no-go and documents</span>
                      </button>

                      <button
                        onClick={() => {
                          setAssistantMode('outline');
                          setAssistantResponse('');
                        }}
                        className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${assistantMode === 'outline' ? 'border-blue-600 bg-blue-50/50 text-blue-700 shadow-sm' : 'border-gray-100 hover:bg-gray-50 text-gray-600'}`}
                      >
                        <FileText className="w-4 h-4 mx-auto mb-1.5 text-blue-600" />
                        <span className="block font-bold text-xs">Proposal Outliner</span>
                        <span className="text-[9px] text-gray-400 block mt-0.5">Generate Outline & Methodologies</span>
                      </button>

                      <button
                        onClick={() => {
                          setAssistantMode('collaborators');
                          setAssistantResponse('');
                        }}
                        className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${assistantMode === 'collaborators' ? 'border-blue-600 bg-blue-50/50 text-blue-700 shadow-sm' : 'border-gray-100 hover:bg-gray-50 text-gray-600'}`}
                      >
                        <User className="w-4 h-4 mx-auto mb-1.5 text-indigo-600" />
                        <span className="block font-bold text-xs">Team Matcher</span>
                        <span className="text-[9px] text-gray-400 block mt-0.5">Suggest Synergistic Collaborators</span>
                      </button>

                      <button
                        onClick={() => {
                          setAssistantMode('feedback');
                          setAssistantResponse('');
                        }}
                        className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${assistantMode === 'feedback' ? 'border-blue-600 bg-blue-50/50 text-blue-700 shadow-sm' : 'border-gray-100 hover:bg-gray-50 text-gray-600'}`}
                      >
                        <CheckCircle className="w-4 h-4 mx-auto mb-1.5 text-emerald-600" />
                        <span className="block font-bold text-xs">Compliance Checker</span>
                        <span className="text-[9px] text-gray-400 block mt-0.5">Analyze Draft Gaps & Similarity</span>
                      </button>
                    </div>

                    {/* Mode dependent input or trigger button */}
                    {assistantMode === 'feedback' ? (
                      <div className="space-y-2 animate-fade-in">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Paste Draft Proposal Text to Analyze</label>
                        <textarea 
                          rows={6}
                          placeholder="Paste your rough draft sections here (e.g. project summary, aims, or background text)..."
                          value={assistantDraftText}
                          onChange={(e) => setAssistantDraftText(e.target.value)}
                          className="block w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono leading-relaxed"
                        />
                      </div>
                    ) : (
                      <div className="p-4 bg-gray-50 rounded-lg text-xs text-gray-600 border border-gray-100 flex items-start gap-2.5">
                        <HelpCircle className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-gray-800">
                            {assistantMode === 'eligibility' ? 'Eligibility & Readiness Review' : assistantMode === 'outline' ? 'Aims & Methodology Generation' : 'Strategic Collaborator Recommendation'}
                          </p>
                          <p className="mt-0.5 leading-normal text-gray-500">
                            {assistantMode === 'eligibility'
                              ? 'Checks each requirement of the call against your matched profile, lists the documents to prepare and the first steps to apply.'
                              : assistantMode === 'outline'
                              ? 'This tool will generate a targeted, professional proposal framework and high-fidelity project outline custom tailored to your profile.' 
                              : 'This tool analyzes current technical gaps in your proposal goals and profiles prospective multidisciplinary co-PIs or industry partners.'}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="pt-2">
                      <button
                        onClick={() => handleRunAssistant()}
                        disabled={assistantLoading || !assistantGrantId}
                        className={`w-full py-3 rounded-lg text-xs font-extrabold text-white shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer ${(!assistantGrantId || assistantLoading) ? 'bg-gray-400 cursor-not-allowed shadow-none' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'}`}
                      >
                        {assistantLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                            Running Advanced AI Models...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 text-amber-300" />
                            {assistantMode === 'eligibility' ? 'Review My Eligibility for This Call' :
                             assistantMode === 'outline' ? 'Generate Custom Draft Outline & Methodology' : 
                             assistantMode === 'collaborators' ? 'Analyze & Suggest Strategic Collaborators' : 
                             'Perform Quality & Gap Compliance Analysis'}
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* AI Response Output Panel */}
                  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4 min-h-[300px] flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-3">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5 text-blue-600" /> Real-time Intelligence Outputs
                        </span>
                        {assistantResponse && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(assistantResponse);
                              triggerToast("Copied report to clipboard!");
                            }}
                            className="text-[10px] text-blue-600 font-semibold hover:underline cursor-pointer"
                          >
                            Copy Report
                          </button>
                        )}
                      </div>

                      {assistantResponse ? (
                        <div className="p-4 bg-gray-50 rounded-lg border border-gray-100 max-h-[500px] overflow-y-auto">
                          {renderMarkdown(assistantResponse)}
                        </div>
                      ) : (
                        <div className="py-24 text-center text-gray-400 flex flex-col items-center justify-center">
                          <Sparkles className="w-12 h-12 text-blue-100 mb-3 animate-pulse" />
                          <h4 className="font-extrabold text-sm text-gray-800">Proposal Studio Output Workspace</h4>
                          <p className="text-xs text-gray-500 mt-1 max-w-sm">
                            Configure your grant choice and profile variables above, then select an action to start receiving real-time matching intelligence reports.
                          </p>
                        </div>
                      )}
                    </div>

                    {assistantResponse && (
                      <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400 font-semibold">
                        <span>Analysis Mode: <span className="text-gray-700 uppercase">{assistantMode}</span></span>
                        <span className="text-green-600 flex items-center gap-1">● AI Engine Grounding Status: Live</span>
                      </div>
                    )}
                  </div>

                </div>

              </div>
            </div>
          )}

        </div>
      </main>

      {/* ==================== MODAL: DETAIL DIALOG ==================== */}
      {selectedGrant && (
        <div id="grant-detail-modal" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6 animate-fade-in">
          <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col">
            
            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex justify-between items-start bg-gray-50/50">
              <div>
                <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider bg-blue-50 px-2 py-1 rounded border border-blue-100">
                  {selectedGrant.category} Opportunity
                </span>
                <h2 className="text-lg font-black text-gray-900 mt-2">{selectedGrant.title}</h2>
                <p className="text-xs text-gray-400 mt-1 font-semibold">Originating Funder: {selectedGrant.funderName}</p>
              </div>
              <button 
                id="close-modal-btn"
                onClick={() => setSelectedGrant(null)} 
                className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 font-bold text-lg cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* Content Body */}
            <div className="p-8 overflow-y-auto space-y-6 flex-1">
              
              {/* Intelligent Agent Score Breakdown Panel */}
              <div className="p-5 bg-gradient-to-br from-blue-50/30 via-white to-gray-50 rounded-xl border border-blue-100 space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                    <h3 className="font-extrabold text-sm text-gray-900">AI Agent Match Matrix</h3>
                  </div>
                  <span className="text-xl font-black text-blue-600 font-mono">
                    {selectedMatch ? `${selectedMatch.matchScore}%` : 'Calculating...'}
                  </span>
                </div>

                {loadingDetailMatch ? (
                  <div className="py-2 flex items-center gap-2 text-xs text-gray-500 font-semibold">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    Parsing user profile qualifications against call text...
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-600 leading-relaxed italic">
                      &ldquo;{selectedMatch?.rationale}&rdquo;
                    </p>

                    {/* Score Bar Breakdown */}
                    {selectedMatch?.relevanceBreakdown && (
                      <div className="grid grid-cols-4 gap-4 border-t border-gray-100 pt-3">
                        <div>
                          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Interests Fit</span>
                          <span className="text-xs font-extrabold text-gray-700 mt-0.5 block">{selectedMatch.relevanceBreakdown.subject} / 40</span>
                        </div>
                        <div>
                          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Org Eligibility</span>
                          <span className="text-xs font-extrabold text-gray-700 mt-0.5 block">{selectedMatch.relevanceBreakdown.eligibility} / 30</span>
                        </div>
                        <div>
                          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Funding Target</span>
                          <span className="text-xs font-extrabold text-gray-700 mt-0.5 block">{selectedMatch.relevanceBreakdown.amount} / 15</span>
                        </div>
                        <div>
                          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Deadline Urgency</span>
                          <span className="text-xs font-extrabold text-gray-700 mt-0.5 block">{selectedMatch.relevanceBreakdown.urgency} / 15</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Thumbs Feedback Learning Loop */}
              {selectedMatch && (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 animate-fade-in">
                  <div className="text-center sm:text-left">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Feedback Learning Loop</span>
                    <p className="text-xs font-semibold text-gray-700 mt-0.5">Is this grant match aligned with your actual research direction?</p>
                  </div>
                  <div className="flex gap-2.5 shrink-0">
                    <button
                      id="feedback-relevant-btn"
                      onClick={() => handleSaveFeedback(selectedGrant.id, selectedMatch.feedback === 'relevant' ? null : 'relevant')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 border transition-all cursor-pointer ${
                        selectedMatch.feedback === 'relevant'
                          ? 'bg-green-600 border-green-600 text-white shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-green-50 hover:text-green-600 hover:border-green-100'
                      }`}
                    >
                      <span>👍</span> Relevant
                    </button>
                    <button
                      id="feedback-not-relevant-btn"
                      onClick={() => handleSaveFeedback(selectedGrant.id, selectedMatch.feedback === 'not_relevant' ? null : 'not_relevant')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 border transition-all cursor-pointer ${
                        selectedMatch.feedback === 'not_relevant'
                          ? 'bg-red-600 border-red-600 text-white shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-100'
                      }`}
                    >
                      <span>👎</span> Not Relevant
                    </button>
                  </div>
                </div>
              )}

              {/* Core Information Section */}
              <div className="grid grid-cols-2 gap-6 text-xs text-gray-600">
                <div className="space-y-1 bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Eligible Regions</span>
                  <p className="font-extrabold text-gray-800">{selectedGrant.eligibleRegions.join(', ')}</p>
                </div>
                <div className="space-y-1 bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Eligible Organization Types</span>
                  <p className="font-extrabold text-gray-800">{selectedGrant.eligibleOrgTypes.join(', ')}</p>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <h4 className="font-extrabold text-xs text-gray-900 uppercase tracking-wider">Proposal Specification Description</h4>
                <p className="text-xs text-gray-600 leading-relaxed bg-white p-4 border border-gray-100 rounded-lg whitespace-pre-line">
                  {selectedGrant.description}
                </p>
              </div>

              {/* Historical trail of this call across editions */}
              <CallHistory grantId={selectedGrant.id} onOpenGrant={openGrantById} />

              {/* Scope & Objectives */}
              {selectedGrant.objectives && (
                <div className="space-y-2 animate-fade-in">
                  <h4 className="font-extrabold text-xs text-gray-900 uppercase tracking-wider flex items-center gap-1">
                    <span className="text-blue-600">&bull;</span> Key Objectives
                  </h4>
                  <p className="text-xs text-gray-600 leading-relaxed bg-blue-50/20 p-4 border border-blue-100/50 rounded-lg whitespace-pre-line">
                    {selectedGrant.objectives}
                  </p>
                </div>
              )}

              {/* Required Outcomes */}
              {selectedGrant.requiredOutcomes && (
                <div className="space-y-2 animate-fade-in">
                  <h4 className="font-extrabold text-xs text-gray-900 uppercase tracking-wider flex items-center gap-1">
                    <span className="text-blue-600">&bull;</span> Required Outcomes & Deliverables
                  </h4>
                  <p className="text-xs text-gray-600 leading-relaxed bg-orange-50/10 p-4 border border-orange-100/30 rounded-lg whitespace-pre-line">
                    {selectedGrant.requiredOutcomes}
                  </p>
                </div>
              )}

              {/* Scope */}
              {selectedGrant.scope && (
                <div className="space-y-2 animate-fade-in">
                  <h4 className="font-extrabold text-xs text-gray-900 uppercase tracking-wider flex items-center gap-1">
                    <span className="text-blue-600">&bull;</span> Full Solicitation Scope
                  </h4>
                  <p className="text-xs text-gray-600 leading-relaxed bg-gray-50/50 p-4 border border-gray-100 rounded-lg whitespace-pre-line">
                    {selectedGrant.scope}
                  </p>
                </div>
              )}

              {/* Extracted Keywords Tag Cloud */}
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Scraper Keywords:</span>
                {selectedGrant.extractedKeywords.map((kw, i) => (
                  <span key={i} className="text-[9px] bg-gray-100 text-gray-600 border border-gray-200 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    {kw}
                  </span>
                ))}
              </div>

              {/* Quick Tracker Panel */}
              <div className="border-t border-gray-100 pt-6 space-y-3">
                <h4 className="font-extrabold text-xs text-gray-900 uppercase tracking-wider flex items-center gap-1">
                  <Layers className="w-4 h-4 text-blue-600" />
                  Proposal Tracking Console
                </h4>
                <p className="text-[11px] text-gray-500">Save this opportunity to your personal workflow pipeline to track progress.</p>
                
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Status Action</label>
                    <select
                      id="track-status"
                      value={trackingStatus}
                      onChange={(e) => setTrackingStatus(e.target.value as any)}
                      className="block w-full px-3 py-2 text-xs border border-gray-200 rounded-lg cursor-pointer"
                    >
                      <option value="draft">Save to Drafts / Backlog</option>
                      <option value="submitted">Mark as Submitted</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Action Notes (Internal)</label>
                    <input 
                      id="track-notes"
                      type="text"
                      value={trackingNotes}
                      onChange={(e) => setTrackingNotes(e.target.value)}
                      placeholder="Collaborators recruited, deadline strategy..."
                      className="block w-full px-3 py-2 text-xs border border-gray-200 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              {/* Collaborative Consortium Share Panel */}
              <div className="p-5 bg-blue-50/25 rounded-xl border border-dashed border-blue-200 space-y-4">
                <h4 className="font-extrabold text-xs text-blue-900 flex items-center gap-1.5 uppercase tracking-wider">
                  <Share2 className="w-3.5 h-3.5 text-blue-600" />
                  Collaborative Consortia Sharing
                </h4>
                <p className="text-[11px] text-gray-500">Share this grant opportunity directly with your project teams to track collectively.</p>

                {teams.filter(t => t.memberIds.includes(user.id)).length === 0 ? (
                  <p className="text-[10px] text-gray-400 italic">You aren't a member of any consortia yet. Go to the Collaboration Hub to form one.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Target Consortium</label>
                      <select
                        id="share-target-team"
                        value={sharingGrantId === selectedGrant.id ? (selectedTeam?.id || '') : ''}
                        onChange={(e) => {
                          setSharingGrantId(selectedGrant.id);
                          const target = teams.find(t => t.id === e.target.value);
                          if (target) setSelectedTeam(target);
                        }}
                        className="block w-full px-3 py-2 text-xs border border-gray-200 rounded-lg cursor-pointer bg-white"
                      >
                        <option value="">-- Select Team --</option>
                        {teams.filter(t => t.memberIds.includes(user.id)).map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 flex items-end gap-3">
                      <div className="flex-1">
                        <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Sharing Notes / Instructions</label>
                        <input 
                          id="share-notes"
                          type="text"
                          value={shareNotes}
                          onChange={(e) => setShareNotes(e.target.value)}
                          placeholder="Let's build a submission consortium around this..."
                          className="block w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white"
                        />
                      </div>
                      <button
                        onClick={() => {
                          const selectEl = document.getElementById('share-target-team') as HTMLSelectElement | null;
                          const targetTeamId = selectEl?.value;
                          if (!targetTeamId) {
                            triggerToast("Please select a target team.", "error");
                            return;
                          }
                          shareGrantWithTeam(targetTeamId, selectedGrant.id, shareNotes);
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shrink-0 transition-colors cursor-pointer h-[34px] flex items-center justify-center"
                      >
                        Share Opportunity
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Actions Footer */}
            <div className="p-6 border-t border-gray-100 flex justify-between items-center bg-gray-50/50">
              <a 
                href={selectedGrant.url} 
                target="_blank" 
                rel="noreferrer"
                className="text-xs text-blue-600 font-bold hover:underline flex items-center gap-1 cursor-pointer"
              >
                Go to Official Call Portal <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <div className="flex gap-3">
                <button 
                  id="cancel-modal-btn"
                  onClick={() => setSelectedGrant(null)} 
                  className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 text-xs font-bold rounded-lg cursor-pointer transition-all"
                >
                  Close View
                </button>
                <button 
                  id="modal-draft-ai-btn"
                  onClick={() => handleOpenInAssistant(selectedGrant)}
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white text-xs font-extrabold rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer transition-all animate-pulse"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Draft with AI
                </button>
                <button 
                  id="save-track-btn"
                  onClick={() => handleTrackGrant(selectedGrant.id)}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer transition-all"
                >
                  Activate Pipeline Tracking
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
