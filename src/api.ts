/**
 * The only module that talks to the backend.
 *
 * Session model:
 *   - The access token (15 min JWT) lives in this module's memory only,
 *     never in localStorage, so injected scripts cannot read it from
 *     storage and it disappears when the tab closes.
 *   - The refresh token is an httpOnly cookie scoped to /api/auth. On load,
 *     on a 401 and shortly before expiry we exchange it for a new access
 *     token. Concurrent callers share one refresh (single flight).
 *   - Logging out in one tab logs out the others (BroadcastChannel).
 *
 * It also normalises responses: the API returns null for empty fields,
 * while the UI was written against the prototype's always-filled shapes.
 */
import type {
  ApplicationTracker,
  AuditEntry,
  Budget,
  Consortium,
  DashboardStats,
  Funder,
  Grant,
  GrantMatch,
  Notification,
  OfficeProposal,
  Organization,
  OrgMember,
  ScraperLog,
  ScraperSchedule,
  TeamMessage,
  TeamSharedGrant,
  UserProfile,
  AccessPolicy,
  AccessReview,
  AccessRole,
  AdminUser,
  ApplicationContext,
  AssistantMode,
  SessionInfo,
  SmartMatchList,
  SmartProfilePayload,
} from './types';
import type { ApplicantType, DocumentKind, FitResult, ProfileFieldKey } from '../shared/profile';

const CSRF_HEADER = 'x-grantseeker-csrf';
const REFRESH_EARLY_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: { issues?: { path: string; message: string }[] } } };

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as ErrorBody;
  const err = body.error ?? {};
  // Validation errors: surface the first field problem, which is what the
  // user can act on, instead of "Request validation failed".
  const issue = err.details?.issues?.[0];
  const message = issue ? `${issue.path ? `${issue.path}: ` : ''}${issue.message}` : err.message ?? res.statusText;
  return new ApiError(res.status, err.code ?? 'http_error', message, err.details);
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

let accessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshInFlight: Promise<boolean> | null = null;
let onExpired: (() => void) | null = null;

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('grantseeker-auth') : null;
channel?.addEventListener('message', (e) => {
  if (e.data === 'logout') {
    setSession(null);
    onExpired?.();
  }
});

function setSession(token: string | null, expiresIn?: number) {
  accessToken = token;
  clearTimeout(refreshTimer);
  if (token && expiresIn) {
    refreshTimer = setTimeout(() => void refresh(), Math.max(5_000, expiresIn * 1000 - REFRESH_EARLY_MS));
  }
}

/** Called when the session cannot be renewed (expired, revoked, logged out elsewhere). */
export function onSessionExpired(handler: () => void) {
  onExpired = handler;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doRefresh(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { [CSRF_HEADER]: '1' },
    }).catch(() => null);
    if (!res) return false; // offline: keep the current token, try again on next 401
    if (res.ok) {
      const data = (await res.json()) as { token: string; expiresIn: number };
      setSession(data.token, data.expiresIn);
      return true;
    }
    // Another tab rotated the cookie a moment ago; the browser now holds
    // the successor, so retrying shortly succeeds.
    if (res.status === 409) {
      await sleep(250 * (attempt + 1));
      continue;
    }
    break;
  }
  setSession(null);
  return false;
}

function refresh(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  // FormData (file uploads) sets its own multipart content type.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !retried && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) {
    const hadSession = accessToken !== null;
    if (await refresh()) return request<T>(method, path, body, true);
    if (hadSession) onExpired?.();
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/* ------------------------------------------------------------------ */
/* Normalisers                                                         */
/* ------------------------------------------------------------------ */

type Raw = Record<string, any>;

export function normalizeUser(u: Raw): UserProfile {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? '',
    role: u.persona ?? u.role ?? 'academic',
    persona: u.persona ?? u.role ?? 'academic',
    accessRole: u.accessRole ?? 'researcher',
    organizationId: u.organizationId ?? null,
    organization: u.organization ?? '',
    region: u.region ?? '',
    researchInterests: u.researchInterests ?? [],
    qualifications: u.qualifications ?? '',
    fundingNeedsMin: u.fundingNeedsMin ?? 0,
    pastProjects: u.pastProjects ?? '',
    teamMembers: u.teamMembers ?? '',
    pastPublications: u.pastPublications ?? '',
    projectDescriptions: u.projectDescriptions ?? '',
    isPublicProfile: u.isPublicProfile ?? false,
    collaborationInterests: u.collaborationInterests ?? [],
    emailVerified: u.emailVerified ?? true,
  };
}

export function normalizeGrant(g: Raw): Grant {
  return {
    id: g.id,
    title: g.title,
    subject: g.subject ?? '',
    fundingAmount: g.fundingAmount ?? 0,
    deadline: g.deadline ?? '',
    eligibleRegions: g.eligibleRegions ?? [],
    eligibleOrgTypes: g.eligibleOrgTypes ?? [],
    description: g.description ?? '',
    source: g.source ?? '',
    category: g.category ?? 'Other',
    url: g.url,
    status: g.status,
    lifecycle: g.lifecycle ?? (g.status === 'closed' ? 'expired' : 'active'),
    archivedAt: g.archivedAt ?? null,
    funderId: g.funderId ?? '',
    funderName: g.funderName ?? 'Unknown funder',
    extractedKeywords: g.extractedKeywords ?? [],
    objectives: g.objectives ?? undefined,
    requiredOutcomes: g.requiredOutcomes ?? undefined,
    scope: g.scope ?? undefined,
  };
}

export function normalizeMatch(m: Raw): GrantMatch {
  return {
    grantId: m.grantId,
    userId: m.userId,
    matchScore: m.matchScore,
    rationale: m.rationale ?? '',
    isGemini: m.isGemini,
    relevanceBreakdown: m.relevanceBreakdown ?? { subject: 0, eligibility: 0, amount: 0, urgency: 0 },
    fit: m.fit ?? null,
    eligibility: m.eligibility ?? null,
    feedback: m.feedback ?? null,
  };
}

export function normalizeApplication(p: Raw): ApplicationTracker {
  return {
    id: p.id,
    userId: p.ownerId,
    grantId: p.grantId ?? '',
    grantTitle: p.grantTitle ?? p.title,
    funderName: p.funderName ?? '',
    amount: p.amount ?? 0,
    deadline: p.deadline ?? '',
    status: p.status,
    submittedDate: p.submittedDate ?? undefined,
    notes: p.notes ?? '',
    orgId: p.orgId ?? null,
    history: (p.history ?? []).map((h: Raw) => ({
      id: h.id,
      status: h.status,
      timestamp: h.timestamp,
      notes: h.notes ?? '',
      actor: h.actor ?? 'Research office',
    })),
  };
}

const normalizeNotification = (n: Raw): Notification => ({
  id: n.id,
  userId: n.userId,
  title: n.title,
  message: n.message,
  date: n.date,
  read: n.read,
  type: n.type,
  grantId: n.grantId ?? undefined,
});

const RUN_STATUS: Record<string, ScraperLog['status']> = { ok: 'success', partial: 'success', failed: 'failed', running: 'running' };

const normalizeRun = (r: Raw): ScraperLog => ({
  id: r.id,
  timestamp: r.startedAt,
  source: r.source ?? 'All sources',
  status: RUN_STATUS[r.status] ?? 'failed',
  itemsExtracted: r.itemsFound ?? 0,
  message:
    r.error ??
    (r.status === 'running'
      ? 'Harvest in progress…'
      : `${r.itemsNew ?? 0} new of ${r.itemsFound ?? 0} listings found (${r.trigger}).`),
});

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

type Session = { user: UserProfile };

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  persona: UserProfile['role'];
  region?: string;
  organization?: string;
  inviteCode?: string;
  researchInterests: string[];
  qualifications?: string;
  fundingNeedsMin?: number;
  applicantType?: ApplicantType;
  /** Keep me signed in */
  remember?: boolean;
}

export const api = {
  /* auth */
  async restoreSession(): Promise<UserProfile | null> {
    // Remove the prototype's token if an old build left one behind.
    try {
      localStorage.removeItem('grantseeker_token');
    } catch {
      /* storage blocked */
    }
    if (!(await refresh())) return null;
    try {
      return normalizeUser((await get<{ user: Raw }>('/api/auth/me')).user);
    } catch {
      return null;
    }
  },

  async login(email: string, password: string, remember = true): Promise<Session> {
    const data = await post<{ token: string; expiresIn: number; user: Raw }>('/api/auth/login', { email, password, remember });
    setSession(data.token, data.expiresIn);
    return { user: normalizeUser(data.user) };
  },

  /* password reset */
  forgotPassword: (email: string) => post<{ ok: true; message: string }>('/api/auth/password/forgot', { email }),
  checkResetToken: (token: string) => post<{ valid: boolean; email?: string }>('/api/auth/password/reset/check', { token }),
  resetPassword: (token: string, password: string) =>
    post<{ ok: true; email: string }>('/api/auth/password/reset', { token, password }),

  /** Sign-in methods this server offers (Google only when configured). */
  providers: () => get<{ password: boolean; google: { clientId: string } | null; registration: 'open' | 'invite_only' }>('/api/auth/providers'),

  /** Completes Google sign-in with the popup's authorization code; creates the account on first use. */
  async googleSignIn(code: string, remember = true): Promise<Session & { created: boolean }> {
    const data = await post<{ token: string; expiresIn: number; user: Raw; created: boolean }>('/api/auth/google', { code, remember });
    setSession(data.token, data.expiresIn);
    return { user: normalizeUser(data.user), created: data.created };
  },

  async register(input: RegisterInput): Promise<Session> {
    const data = await post<{ token: string; expiresIn: number; user: Raw }>('/api/auth/register', input);
    setSession(data.token, data.expiresIn);
    return { user: normalizeUser(data.user) };
  },

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { [CSRF_HEADER]: '1' } }).catch(() => {});
    setSession(null);
    channel?.postMessage('logout');
  },

  /** Signs this account out on every device, this one included. */
  async logoutEverywhere(): Promise<void> {
    await post('/api/auth/logout-all');
    setSession(null);
    channel?.postMessage('logout');
  },

  /* settings: sessions */
  sessions: async () => (await get<{ sessions: SessionInfo[] }>('/api/auth/sessions')).sessions,
  revokeSession: (familyId: string) => del(`/api/auth/sessions/${familyId}`),

  /* settings: access control (super admin; the API enforces it) */
  adminUsers: (params: { q?: string; role?: string; limit?: number; offset?: number }) =>
    get<{ users: AdminUser[]; total: number }>(`/api/admin/users${qs({ limit: 25, ...params })}`),
  setUserRole: (id: string, role: AccessRole, reason?: string) =>
    patch<{ user: { id: string; accessRole: AccessRole } }>(`/api/admin/users/${id}`, { role, ...(reason ? { reason } : {}) }),
  suspendUser: (id: string, reason: string) => post(`/api/admin/users/${id}/suspend`, { reason }),
  unsuspendUser: (id: string) => post(`/api/admin/users/${id}/unsuspend`),
  accessPolicy: async () => (await get<{ policy: AccessPolicy }>('/api/admin/access-policy')).policy,
  saveAccessPolicy: async (policy: Omit<AccessPolicy, 'updatedAt' | 'updatedBy'>) =>
    (await request<{ policy: AccessPolicy }>('PUT', '/api/admin/access-policy', policy)).policy,
  accessReview: () => get<AccessReview>('/api/admin/access-review'),

  /* profile & notifications */
  async updateProfile(changes: Partial<UserProfile>): Promise<UserProfile> {
    // Only fields the API accepts, and never null (it rejects null).
    const allowed = [
      'name', 'region', 'researchInterests', 'collaborationInterests', 'qualifications', 'fundingNeedsMin',
      'pastProjects', 'pastPublications', 'projectDescriptions', 'teamMembers', 'isPublicProfile',
    ] as const;
    const body: Raw = { persona: changes.role };
    for (const k of allowed) if (changes[k] !== undefined && changes[k] !== null) body[k] = changes[k];
    return normalizeUser((await patch<{ user: Raw }>('/api/users/me', body)).user);
  },

  async notifications(): Promise<Notification[]> {
    return (await get<{ notifications: Raw[] }>('/api/users/me/notifications?limit=100')).notifications.map(normalizeNotification);
  },
  markNotificationRead: (id: string) => post(`/api/users/me/notifications/${id}/read`),
  markAllNotificationsRead: () => post('/api/users/me/notifications/read-all'),

  /* grants */
  async allGrants(): Promise<Grant[]> {
    // The explorer filters client-side, so load the catalogue in pages.
    const out: Grant[] = [];
    for (let offset = 0; offset < 2_000; offset += 100) {
      const page = await get<{ grants: Raw[]; total: number }>(`/api/grants${qs({ limit: 100, offset, sort: 'deadline' })}`);
      out.push(...page.grants.map(normalizeGrant));
      if (out.length >= page.total || page.grants.length === 0) break;
    }
    return out;
  },
  async funders(): Promise<Funder[]> {
    return (await get<{ funders: Funder[] }>('/api/grants/funders')).funders.map((f) => ({ ...f, website: f.website ?? '' }));
  },
  async stats(): Promise<DashboardStats> {
    return get<DashboardStats>('/api/grants/stats');
  },
  /* archive (super admin) */
  async archiveGrant(id: string): Promise<Grant> {
    return normalizeGrant((await post<{ grant: Raw }>(`/api/grants/${id}/archive`)).grant);
  },
  async restoreGrant(id: string): Promise<Grant> {
    return normalizeGrant((await post<{ grant: Raw }>(`/api/grants/${id}/restore`)).grant);
  },
  async archiveExpiredGrants(olderThanDays = 0): Promise<number> {
    return (await post<{ archived: number }>('/api/grants/archive-expired', { olderThanDays })).archived;
  },

  /* matching */
  async matches(): Promise<(GrantMatch & { grant: Grant })[]> {
    const data = await get<{ matches: Raw[] }>('/api/grants/matches?limit=300');
    return data.matches.map((m) => ({ ...normalizeMatch(m), grant: normalizeGrant(m.grant) }));
  },
  async match(grantId: string): Promise<GrantMatch> {
    return normalizeMatch((await get<{ match: Raw }>(`/api/grants/${grantId}/match`)).match);
  },
  saveFeedback: (grantId: string, feedback: GrantMatch['feedback']) =>
    post(`/api/grants/${grantId}/match/feedback`, { feedback: feedback ?? null }),

  /* proposals (the tracker) */
  async applications(): Promise<ApplicationTracker[]> {
    const data = await get<{ proposals: Raw[] }>('/api/proposals?scope=mine&limit=100&includeHistory=true');
    return data.proposals.map(normalizeApplication);
  },
  trackGrant: (grantId: string, status: ApplicationTracker['status'], notes: string) =>
    post('/api/proposals', { grantId, status, notes: notes || undefined }),
  transition: (id: string, to: ApplicationTracker['status'], comment?: string) =>
    post(`/api/proposals/${id}/transition`, { to, comment: comment || undefined }),
  updateNotes: (id: string, notes: string) => patch(`/api/proposals/${id}`, { notes }),
  addNote: (id: string, comment: string) => post(`/api/proposals/${id}/events`, { comment }),
  deleteApplication: (id: string) => del(`/api/proposals/${id}`),

  /* scraper (super admins) */
  async scraperRuns(): Promise<ScraperLog[]> {
    return (await get<{ runs: Raw[] }>('/api/admin/scraper/runs?limit=50')).runs.map(normalizeRun);
  },
  scraperSchedule: () => get<ScraperSchedule>('/api/admin/scraper/schedule'),
  async scraperSources(): Promise<{ id: string; label: string; adapter: string }[]> {
    return (await get<{ sources: { id: string; label: string; adapter: string }[] }>('/api/admin/scraper/sources')).sources;
  },
  requestScrape: (source?: string) => post<{ note: string }>('/api/admin/scraper/run', { source: source || undefined }),

  /* collaboration */
  async collaborators(filters: { search?: string; expertise?: string; institution?: string }): Promise<UserProfile[]> {
    const data = await get<{ users: Raw[] }>(`/api/collaboration/users${qs(filters)}`);
    return data.users.map((u) => normalizeUser({ ...u, email: '' }));
  },
  async teams(): Promise<Consortium[]> {
    return (await get<{ teams: Consortium[] }>('/api/collaboration/teams')).teams;
  },
  async createTeam(name: string, description: string, isPrivate: boolean): Promise<Consortium> {
    return (await post<{ team: Consortium }>('/api/collaboration/teams', { name, description: description || undefined, isPrivate })).team;
  },
  async joinTeam(teamId: string): Promise<Consortium> {
    return (await post<{ team: Consortium }>(`/api/collaboration/teams/${teamId}/join`)).team;
  },
  leaveTeam: (teamId: string) => post<{ message: string }>(`/api/collaboration/teams/${teamId}/leave`),
  addTeamMember: (teamId: string, memberId: string) => post(`/api/collaboration/teams/${teamId}/members`, { memberId }),
  async teamMembers(teamId: string): Promise<UserProfile[]> {
    const data = await get<{ members: Raw[] }>(`/api/collaboration/teams/${teamId}/members`);
    return data.members.map((m) => normalizeUser({ ...m, email: '' }));
  },
  async teamMessages(teamId: string, after?: string): Promise<TeamMessage[]> {
    return (await get<{ messages: TeamMessage[] }>(`/api/collaboration/teams/${teamId}/messages${qs({ after })}`)).messages;
  },
  sendTeamMessage: (teamId: string, content: string) => post(`/api/collaboration/teams/${teamId}/messages`, { content }),
  async teamGrants(teamId: string): Promise<(TeamSharedGrant & { grant?: Grant })[]> {
    const data = await get<{ sharedGrants: Raw[] }>(`/api/collaboration/teams/${teamId}/grants`);
    return data.sharedGrants.map((g) => ({ ...(g as TeamSharedGrant), grant: g.grant ? normalizeGrant(g.grant) : undefined }));
  },
  shareGrant: (teamId: string, grantId: string, notes: string) =>
    post(`/api/collaboration/teams/${teamId}/grants`, { grantId, notes: notes || undefined }),
  setSharedGrantStatus: (teamId: string, grantId: string, status: string) =>
    request('PUT', `/api/collaboration/teams/${teamId}/grants/${grantId}/status`, { status }),

  /* research office (grant officers and institution admins) */
  async orgProposals(): Promise<OfficeProposal[]> {
    const data = await get<{ proposals: Raw[] }>('/api/proposals?scope=org&includeHistory=true&limit=100');
    return data.proposals.map((p) => ({
      id: p.id,
      ownerId: p.ownerId,
      ownerName: p.ownerName ?? 'Member',
      grantId: p.grantId ?? null,
      grantTitle: p.grantTitle ?? p.title,
      funderName: p.funderName ?? '',
      title: p.title,
      status: p.status,
      amount: p.amount ?? null,
      deadline: p.deadline ?? null,
      submittedDate: p.submittedDate ?? null,
      notes: p.notes ?? '',
      updatedAt: p.updatedAt,
      history: normalizeApplication(p).history ?? [],
    }));
  },
  async budget(proposalId: string): Promise<Budget | null> {
    return (await get<{ budget: Budget | null }>(`/api/proposals/${proposalId}/budget`)).budget;
  },
  async approveBudget(proposalId: string): Promise<Budget> {
    return (await post<{ budget: Budget }>(`/api/proposals/${proposalId}/budget/approve`)).budget;
  },
  async organization(): Promise<Organization> {
    return (await get<{ organization: Organization }>('/api/users/org')).organization;
  },
  async orgMembers(): Promise<OrgMember[]> {
    return (await get<{ members: OrgMember[] }>('/api/users/org/members?limit=100')).members;
  },
  setMemberRole: (memberId: string, role: 'researcher' | 'grant_officer') =>
    patch(`/api/users/org/members/${memberId}/role`, { role }),
  removeMember: (memberId: string) => del(`/api/users/org/members/${memberId}`),
  async rotateInviteCode(): Promise<string> {
    return (await post<{ inviteCode: string }>('/api/users/org/invite-code')).inviteCode;
  },
  async orgActivity(): Promise<AuditEntry[]> {
    return (await get<{ entries: AuditEntry[] }>('/api/admin/audit?limit=40')).entries;
  },

  /* AI proposal assistant */
  generate: (input: {
    grantId: string;
    mode: AssistantMode;
    pastProjects?: string;
    teamMembers?: string;
    researchArea?: string;
    draftText?: string;
    /** Saves the output into this application. */
    proposalId?: string;
  }) => post<{ text: string; isSimulated: boolean; savedTo: string | null }>('/api/assistant/generate', input),

  /** The call, your fit assessment and your application for it (if started). */
  async applicationContext(grantId: string): Promise<ApplicationContext> {
    const data = await get<{ grant: Raw; fit: FitResult | null; proposal: ApplicationContext['proposal']; hasProfile: boolean }>(
      `/api/assistant/context/${grantId}`,
    );
    return { ...data, grant: normalizeGrant(data.grant) };
  },
  /** Starts an in-app application for a grant (a draft in My Saved Applications). */
  startApplication: (grantId: string, body: Record<string, unknown>, notes: string) =>
    post<{ proposal: Raw }>('/api/proposals', { grantId, body, notes, status: 'draft' }),
  updateApplicationBody: (id: string, body: Record<string, unknown>) => patch(`/api/proposals/${id}`, { body }),

  /* Smart profile and ranked matches */
  profile: {
    get: () => get<SmartProfilePayload>('/api/profile'),
    upload(file: File, kind: DocumentKind) {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      return request<SmartProfilePayload & { documentId: string }>('POST', '/api/profile/documents', form);
    },
    deleteDocument: (id: string) => del<SmartProfilePayload>(`/api/profile/documents/${id}`),
    edit: (input: { fields?: Partial<{ [K in ProfileFieldKey]: unknown }>; reset?: ProfileFieldKey[] }) =>
      put<SmartProfilePayload>('/api/profile', { fields: input.fields ?? {}, reset: input.reset ?? [] }),
    rescore: () => post<{ rescored: number }>('/api/profile/rescore'),
    async matches(opts: { includeIneligible?: boolean; limit?: number } = {}): Promise<SmartMatchList> {
      const data = await get<{ matches: Raw[]; counts: SmartMatchList['counts'] }>(
        `/api/profile/matches${qs({ limit: opts.limit ?? 100, include: opts.includeIneligible ? 'ineligible' : undefined })}`,
      );
      return {
        matches: data.matches.map((m) => ({ match: normalizeMatch(m), grant: normalizeGrant(m.grant) })),
        counts: data.counts,
      };
    },
  },
};


