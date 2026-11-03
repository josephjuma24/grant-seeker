import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  Minus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Users,
} from 'lucide-react';

import { api, ApiError } from '../api';
import type { AccessPolicy, AccessReview, AccessRole, AdminUser, SessionInfo, UserProfile } from '../types';

// General settings for the whole system, built on least privilege: each
// person sees and changes only what their role allows (the API enforces
// the same rules), roles are raised one person at a time with a reason,
// and privileged access nobody uses is surfaced for review.

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

interface Props {
  user: UserProfile;
  onToast: Toast;
  onSignedOut: () => void;
  onOpenProfile: () => void;
  onOpenOffice: () => void;
}

type Section = 'account' | 'roles' | 'users' | 'review' | 'policy';

const ROLE_LABEL: Record<AccessRole, string> = {
  researcher: 'Researcher',
  grant_officer: 'Grant officer',
  institution_admin: 'Institution admin',
  super_admin: 'Super admin',
};
const ROLE_ORDER: AccessRole[] = ['researcher', 'grant_officer', 'institution_admin', 'super_admin'];
const LEVEL: Record<AccessRole, number> = { researcher: 20, grant_officer: 30, institution_admin: 40, super_admin: 50 };

/** What each role may do. Mirrors the API's role checks and database policies. */
const CAPABILITIES: { label: string; min: AccessRole | 'guest'; note?: string }[] = [
  { label: 'Browse and search open grant calls', min: 'guest' },
  { label: 'Smart profile, ranked matches and the AI Proposal Assistant', min: 'researcher' },
  { label: 'Create and track your own applications', min: 'researcher' },
  { label: 'Teams and the Collaboration Hub', min: 'researcher' },
  { label: "Review, approve and submit your organisation's proposals", min: 'grant_officer' },
  { label: "Approve budgets and read your organisation's audit log", min: 'grant_officer' },
  { label: 'Invite members and set their roles (up to the policy cap)', min: 'institution_admin' },
  { label: 'All users, roles, suspension and the access policy', min: 'super_admin' },
  { label: 'AI Web Scraper panel and the full audit log', min: 'super_admin' },
];

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
/** "Chrome on Windows" from a user-agent string. */
function deviceName(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|node|python/i.test(ua) ? 'Script or API client' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');
const card = 'bg-white rounded-xl border border-gray-200 p-5 sm:p-6';
const h2 = 'text-sm font-bold text-gray-900';
const sub = 'text-xs text-gray-500 mt-0.5';
const btn = 'inline-flex items-center justify-center gap-1.5 text-xs font-bold rounded-lg px-3 py-2 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1';
const input = 'w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600';

function RoleBadge({ role }: { role: AccessRole }) {
  const style: Record<AccessRole, string> = {
    researcher: 'bg-gray-100 text-gray-700 border-gray-200',
    grant_officer: 'bg-blue-50 text-blue-800 border-blue-200',
    institution_admin: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    super_admin: 'bg-amber-50 text-amber-800 border-amber-200',
  };
  return <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${style[role]}`}>{ROLE_LABEL[role]}</span>;
}

/* ------------------------------------------------------------------ */
/* Account and sessions (everyone)                                     */
/* ------------------------------------------------------------------ */

function AccountSection({ user, onToast, onSignedOut, onOpenProfile }: Props) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api.sessions().then(setSessions).catch(() => setSessions([])), []);
  useEffect(() => { void load(); }, [load]);

  const revoke = async (familyId: string) => {
    setBusy(familyId);
    try {
      await api.revokeSession(familyId);
      onToast('That device is signed out.', 'success');
      await load();
    } catch (err) {
      onToast(errorText(err), 'error');
    } finally {
      setBusy(null);
    }
  };
  const everywhere = async () => {
    if (!window.confirm('Sign out on every device, including this one?')) return;
    setBusy('all');
    try {
      await api.logoutEverywhere();
      onSignedOut();
    } catch (err) {
      onToast(errorText(err), 'error');
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className={card} aria-labelledby="acct-h">
        <h2 id="acct-h" className={h2}>Your account</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3 text-xs">
          <div><dt className="text-gray-500">Name</dt><dd className="mt-0.5 font-semibold text-gray-900">{user.name}</dd></div>
          <div><dt className="text-gray-500">Email</dt><dd className="mt-0.5 font-semibold text-gray-900 break-all">{user.email}</dd></div>
          <div><dt className="text-gray-500">Access role</dt><dd className="mt-1"><RoleBadge role={user.accessRole} /></dd></div>
        </dl>
        <p className="mt-4 text-xs text-gray-600">
          Your role is set by an administrator and gives you only what your work needs. To change your research details, use{' '}
          <button type="button" onClick={onOpenProfile} className="font-bold text-blue-700 hover:underline">Match Profile Settings</button>.
        </p>
      </section>

      <section className={card} aria-labelledby="sess-h">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="sess-h" className={h2}>Signed-in devices</h2>
            <p className={sub}>Sign out any device you don’t recognise.</p>
          </div>
          <button type="button" onClick={everywhere} disabled={busy !== null} className={`${btn} text-red-700 border border-red-200 hover:bg-red-50`}>
            {busy === 'all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <LogOut className="w-3.5 h-3.5" aria-hidden="true" />} Sign out everywhere
          </button>
        </div>
        {sessions === null ? (
          <p className="mt-4 text-xs text-gray-500 inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="mt-4 text-xs text-gray-500">No other active sessions.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {sessions.map((s) => (
              <li key={s.familyId} className="py-3 flex items-center gap-3">
                <Laptop className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-800 truncate" title={s.userAgent ?? undefined}>{deviceName(s.userAgent)}</p>
                  <p className="text-[11px] text-gray-500">{s.ip ?? 'Unknown address'} · last active {when(s.lastUsedAt)}</p>
                </div>
                <button type="button" onClick={() => revoke(s.familyId)} disabled={busy !== null} className={`${btn} text-gray-700 border border-gray-200 hover:bg-gray-50`}>
                  {busy === s.familyId ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null} Sign out
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roles and permissions (everyone, read-only)                         */
/* ------------------------------------------------------------------ */

function RolesSection({ user, onOpenOffice }: Pick<Props, 'user' | 'onOpenOffice'>) {
  const allowed = (min: AccessRole | 'guest', role: AccessRole) => min === 'guest' || LEVEL[role] >= LEVEL[min];
  return (
    <div className="space-y-6">
      <section className={card} aria-labelledby="lp-h">
        <h2 id="lp-h" className={`${h2} flex items-center gap-2`}><ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" /> Least privilege</h2>
        <ul className="mt-3 space-y-2 text-xs text-gray-700 list-disc pl-5">
          <li>Every account starts as a <b>Researcher</b>, the lowest role, and gets more only when their work needs it.</li>
          <li>Higher roles are granted <b>one person at a time</b>, by someone allowed to grant them, with a reason recorded in the audit log.</li>
          <li>Nobody can change their own role, and institution admins can grant only up to the level the access policy allows.</li>
          <li>Privileged accounts that go unused are flagged for review, then lowered or suspended.</li>
          <li>The same rules are enforced by the server and the database, not only by what this screen shows.</li>
        </ul>
        {user.accessRole === 'institution_admin' && (
          <p className="mt-4 text-xs text-gray-700">
            You manage your organisation’s members and invite codes in{' '}
            <button type="button" onClick={onOpenOffice} className="font-bold text-blue-700 hover:underline">Research Office</button>.
          </p>
        )}
      </section>

      <section className={card} aria-labelledby="matrix-h">
        <h2 id="matrix-h" className={h2}>What each role can do</h2>
        <p className={sub}>Your role is highlighted. Signed-out visitors and unverified accounts can only browse calls.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-xs border-collapse">
            <thead>
              <tr>
                <th scope="col" className="text-left font-semibold text-gray-500 pb-2 pr-3">Permission</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} scope="col" className={`pb-2 px-2 font-bold text-center ${r === user.accessRole ? 'text-blue-700' : 'text-gray-700'}`}>
                    {ROLE_LABEL[r]}{r === user.accessRole && <span className="block text-[10px] font-semibold">(you)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <tr key={c.label} className="border-t border-gray-100">
                  <th scope="row" className="text-left font-normal text-gray-700 py-2 pr-3">{c.label}</th>
                  {ROLE_ORDER.map((r) => (
                    <td key={r} className={`py-2 px-2 text-center ${r === user.accessRole ? 'bg-blue-50/60' : ''}`}>
                      {allowed(c.min, r)
                        ? <Check className="w-4 h-4 text-emerald-600 inline" aria-label="Allowed" />
                        : <Minus className="w-4 h-4 text-gray-300 inline" aria-label="Not allowed" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Users and access (super admin)                                      */
/* ------------------------------------------------------------------ */

type Pending = { kind: 'role'; user: AdminUser; role: AccessRole } | { kind: 'suspend'; user: AdminUser };

function UserActionForm({ pending, policy, onDone, onCancel, onToast }: { pending: Pending; policy: AccessPolicy | null; onDone: () => void; onCancel: () => void; onToast: Toast }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const raising = pending.kind === 'role' && LEVEL[pending.role] > LEVEL[pending.user.accessRole];
  const needsReason = pending.kind === 'suspend' || (raising && (policy?.requireReasonToElevate ?? true));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (pending.kind === 'role') {
        await api.setUserRole(pending.user.id, pending.role, reason.trim() || undefined);
        onToast(`${pending.user.name} is now ${ROLE_LABEL[pending.role]}.`, 'success');
      } else {
        await api.suspendUser(pending.user.id, reason.trim());
        onToast(`${pending.user.name} is suspended and signed out everywhere.`, 'success');
      }
      onDone();
    } catch (err) {
      onToast(errorText(err), 'error');
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-2 p-3 rounded-lg border border-amber-200 bg-amber-50/60 space-y-2">
      <p className="text-xs text-gray-800">
        {pending.kind === 'role'
          ? <>Change <b>{pending.user.name}</b> from {ROLE_LABEL[pending.user.accessRole]} to <b>{ROLE_LABEL[pending.role]}</b>{raising ? ' (more access)' : ' (less access)'}.</>
          : <>Suspend <b>{pending.user.name}</b>: they are signed out everywhere and cannot sign in until restored.</>}
      </p>
      <label className="block">
        <span className="text-[11px] font-semibold text-gray-700">{needsReason ? 'Reason (required, kept in the audit log)' : 'Reason (optional)'}</span>
        <input className={`${input} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} required={needsReason} minLength={needsReason ? 5 : undefined} maxLength={500} placeholder={pending.kind === 'suspend' ? 'e.g. Left the institution' : 'e.g. Leads grant review for the Faculty of Health'} autoFocus />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`${btn} text-white ${pending.kind === 'suspend' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />} {pending.kind === 'suspend' ? 'Suspend' : 'Confirm change'}
        </button>
        <button type="button" onClick={onCancel} className={`${btn} text-gray-700 hover:bg-white`}>Cancel</button>
      </div>
    </form>
  );
}

function UsersSection({ user: me, onToast }: Pick<Props, 'user' | 'onToast'>) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ users: AdminUser[]; total: number } | null>(null);
  const [policy, setPolicy] = useState<AccessPolicy | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const PAGE = 25;

  const load = useCallback(async () => {
    try {
      setData(await api.adminUsers({ q: q.trim() || undefined, role: role || undefined, limit: PAGE, offset: page * PAGE }));
    } catch (err) {
      onToast(errorText(err), 'error');
    }
  }, [q, role, page, onToast]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => { api.accessPolicy().then(setPolicy).catch(() => {}); }, []);

  const restore = async (u: AdminUser) => {
    try {
      await api.unsuspendUser(u.id);
      onToast(`${u.name} can sign in again.`, 'success');
      void load();
    } catch (err) {
      onToast(errorText(err), 'error');
    }
  };

  return (
    <section className={card} aria-labelledby="users-h">
      <h2 id="users-h" className={h2}>Users and access</h2>
      <p className={sub}>Raise access only for the people and length of time it is needed. You can’t change your own role.</p>
      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search users</span>
          <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input className={`${input} pl-8`} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search by name or email" />
        </label>
        <label>
          <span className="sr-only">Filter by role</span>
          <select className={input} value={role} onChange={(e) => { setRole(e.target.value); setPage(0); }}>
            <option value="">All roles</option>
            {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
      </div>

      {!data ? (
        <p className="mt-4 text-xs text-gray-500 inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading users…</p>
      ) : data.users.length === 0 ? (
        <p className="mt-4 text-xs text-gray-500">No users match.</p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
          {data.users.map((u) => {
            const self = u.id === me.id;
            return (
              <li key={u.id} className="py-3">
                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-gray-900 truncate">
                      {u.name} {self && <span className="text-[10px] font-semibold text-blue-700">(you)</span>}
                      {u.suspendedAt && <span className="ml-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1">Suspended</span>}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate">{u.email}{u.organization ? ` · ${u.organization}` : ''} · last sign-in {when(u.lastLoginAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label>
                      <span className="sr-only">Role for {u.name}</span>
                      <select
                        className={`${input} w-40`}
                        value={u.accessRole}
                        disabled={self || !!u.suspendedAt}
                        title={self ? 'You cannot change your own role' : undefined}
                        onChange={(e) => setPending({ kind: 'role', user: u, role: e.target.value as AccessRole })}
                      >
                        {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </label>
                    {!self && (u.suspendedAt
                      ? <button type="button" onClick={() => restore(u)} className={`${btn} text-gray-700 border border-gray-200 hover:bg-gray-50`}>Restore</button>
                      : <button type="button" onClick={() => setPending({ kind: 'suspend', user: u })} className={`${btn} text-red-700 border border-red-200 hover:bg-red-50`}>Suspend</button>)}
                  </div>
                </div>
                {pending?.user.id === u.id && (
                  <UserActionForm pending={pending} policy={policy} onToast={onToast} onCancel={() => setPending(null)} onDone={() => { setPending(null); void load(); }} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data && data.total > PAGE && (
        <div className="mt-4 flex items-center justify-between text-xs text-gray-600">
          <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, data.total)} of {data.total}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className={`${btn} border border-gray-200 hover:bg-gray-50`}>Previous</button>
            <button type="button" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)} className={`${btn} border border-gray-200 hover:bg-gray-50`}>Next</button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Access review (super admin)                                         */
/* ------------------------------------------------------------------ */

function ReviewSection({ user: me, onToast }: Pick<Props, 'user' | 'onToast'>) {
  const [data, setData] = useState<AccessReview | null>(null);
  const [policy, setPolicy] = useState<AccessPolicy | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const load = useCallback(() => api.accessReview().then(setData).catch((err) => onToast(errorText(err), 'error')), [onToast]);
  useEffect(() => { void load(); api.accessPolicy().then(setPolicy).catch(() => {}); }, [load]);

  if (!data) return <p className="text-xs text-gray-500 inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading access review…</p>;
  const privilegedShare = data.totalUsers ? Math.round(((data.counts.super_admin + data.counts.institution_admin + data.counts.grant_officer) / data.totalUsers) * 100) : 0;
  const tiles = [
    { label: 'Super admins', value: data.counts.super_admin },
    { label: 'Institution admins', value: data.counts.institution_admin },
    { label: 'Grant officers', value: data.counts.grant_officer },
    { label: `Unused ${data.dormantAfterDays}+ days`, value: data.counts.dormant, warn: data.counts.dormant > 0 },
  ];

  return (
    <div className="space-y-6">
      <section className={card} aria-labelledby="review-h">
        <h2 id="review-h" className={h2}>Access review</h2>
        <p className={sub}>{privilegedShare}% of {data.totalUsers} accounts hold more than researcher access. Keep that number small.</p>
        <dl className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tiles.map((t) => (
            <div key={t.label} className={`rounded-lg border p-3 ${t.warn ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
              <dt className="text-[11px] text-gray-600">{t.label}</dt>
              <dd className={`text-xl font-extrabold ${t.warn ? 'text-amber-800' : 'text-gray-900'}`}>{t.value}</dd>
            </div>
          ))}
        </dl>
        {data.counts.super_admin < 2 && (
          <p className="mt-4 text-xs text-gray-700 flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" /> Only one active super admin. Consider a second, so access isn’t lost if one account is locked out.</p>
        )}
      </section>

      <section className={card} aria-labelledby="priv-h">
        <h2 id="priv-h" className={h2}>Privileged accounts</h2>
        <p className={sub}>Lower or suspend access that is no longer needed. Flagged accounts haven’t signed in for {data.dormantAfterDays} days.</p>
        <ul className="mt-4 divide-y divide-gray-100">
          {data.privileged.map((u) => {
            const self = u.id === me.id;
            const asAdminUser = { ...u, emailVerifiedAt: null, lockedUntil: null } as AdminUser;
            return (
              <li key={u.id} className="py-3">
                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-gray-900 truncate flex flex-wrap items-center gap-1.5">
                      {u.name} <RoleBadge role={u.accessRole} />
                      {self && <span className="text-[10px] font-semibold text-blue-700">(you)</span>}
                      {u.suspendedAt ? <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1">Suspended</span>
                        : u.dormant && <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1">Unused</span>}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate">{u.email}{u.organization ? ` · ${u.organization}` : ''} · last sign-in {when(u.lastLoginAt)}</p>
                  </div>
                  {!self && !u.suspendedAt && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setPending({ kind: 'role', user: asAdminUser, role: 'researcher' })} className={`${btn} text-gray-700 border border-gray-200 hover:bg-gray-50`}>Lower to researcher</button>
                      <button type="button" onClick={() => setPending({ kind: 'suspend', user: asAdminUser })} className={`${btn} text-red-700 border border-red-200 hover:bg-red-50`}>Suspend</button>
                    </div>
                  )}
                </div>
                {pending?.user.id === u.id && (
                  <UserActionForm pending={pending} policy={policy} onToast={onToast} onCancel={() => setPending(null)} onDone={() => { setPending(null); void load(); }} />
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Access policy (super admin)                                         */
/* ------------------------------------------------------------------ */

function PolicySection({ onToast }: Pick<Props, 'onToast'>) {
  const [policy, setPolicy] = useState<AccessPolicy | null>(null);
  const [draft, setDraft] = useState<AccessPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.accessPolicy().then((p) => { setPolicy(p); setDraft(p); }).catch((err) => onToast(errorText(err), 'error')); }, [onToast]);
  if (!draft || !policy) return <p className="text-xs text-gray-500 inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading policy…</p>;

  const dirty = (['registrationMode', 'institutionAdminMaxRole', 'requireReasonToElevate', 'dormantAfterDays'] as const).some((k) => draft[k] !== policy[k]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { updatedAt: _a, updatedBy: _b, ...body } = draft;
      const saved = await api.saveAccessPolicy(body);
      setPolicy(saved);
      setDraft(saved);
      onToast('Access policy saved. It applies immediately.', 'success');
    } catch (err) {
      onToast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const row = 'py-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_16rem] md:items-center';

  return (
    <form onSubmit={save} className={card} aria-labelledby="policy-h">
      <h2 id="policy-h" className={h2}>Access policy</h2>
      <p className={sub}>System-wide rules for who gets in and how access grows. Last changed {when(policy.updatedAt)}.</p>
      <div className="mt-2 divide-y divide-gray-100">
        <div className={row}>
          <div>
            <p className="text-xs font-bold text-gray-900">Who can create an account</p>
            <p className="text-[11px] text-gray-500">Invite-only lets people in only with an organisation invite code, including through Google.</p>
          </div>
          <select className={input} value={draft.registrationMode} onChange={(e) => setDraft({ ...draft, registrationMode: e.target.value as AccessPolicy['registrationMode'] })} aria-label="Who can create an account">
            <option value="open">Anyone (open registration)</option>
            <option value="invite_only">Invite-only</option>
          </select>
        </div>
        <div className={row}>
          <div>
            <p className="text-xs font-bold text-gray-900">Highest role institution admins can grant</p>
            <p className="text-[11px] text-gray-500">Limit this to researcher to keep grant-officer access with super admins.</p>
          </div>
          <select className={input} value={draft.institutionAdminMaxRole} onChange={(e) => setDraft({ ...draft, institutionAdminMaxRole: e.target.value as AccessPolicy['institutionAdminMaxRole'] })} aria-label="Highest role institution admins can grant">
            <option value="grant_officer">Grant officer</option>
            <option value="researcher">Researcher</option>
          </select>
        </div>
        <div className={row}>
          <div>
            <p className="text-xs font-bold text-gray-900">Require a reason to raise a role</p>
            <p className="text-[11px] text-gray-500">The reason is kept in the tamper-evident audit log.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={draft.requireReasonToElevate} onChange={(e) => setDraft({ ...draft, requireReasonToElevate: e.target.checked })} />
            Required
          </label>
        </div>
        <div className={row}>
          <div>
            <p className="text-xs font-bold text-gray-900">Flag unused privileged accounts after</p>
            <p className="text-[11px] text-gray-500">Shown in the access review for lowering or suspension. 14 to 365 days.</p>
          </div>
          <label className="flex items-center gap-2">
            <input type="number" min={14} max={365} className={`${input} w-24`} value={draft.dormantAfterDays} onChange={(e) => setDraft({ ...draft, dormantAfterDays: Number(e.target.value) })} aria-label="Days before a privileged account is flagged" />
            <span className="text-xs text-gray-600">days</span>
          </label>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={!dirty || busy} className={`${btn} text-white bg-blue-600 hover:bg-blue-700`}>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />} Save policy
        </button>
        {dirty && <button type="button" onClick={() => setDraft(policy)} className={`${btn} text-gray-700 hover:bg-gray-50`}>Discard changes</button>}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */

export default function GeneralSettings(props: Props) {
  const superAdmin = props.user.accessRole === 'super_admin';
  // Least privilege in the interface too: sections you can't use aren't shown.
  const sections: { id: Section; label: string; Icon: typeof Users }[] = [
    { id: 'account', label: 'Account & sessions', Icon: KeyRound },
    { id: 'roles', label: 'Roles & permissions', Icon: ShieldCheck },
    ...(superAdmin
      ? ([
          { id: 'users', label: 'Users & access', Icon: Users },
          { id: 'review', label: 'Access review', Icon: UserCog },
          { id: 'policy', label: 'Access policy', Icon: SlidersHorizontal },
        ] as const)
      : []),
  ];
  const [section, setSection] = useState<Section>('account');

  return (
    <div id="subview-settings" className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900 tracking-tight">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Your account, and how access to GrantSeeker is controlled under least privilege.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex flex-wrap lg:flex-col gap-1">
          {sections.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id ? 'page' : undefined}
              className={`shrink-0 flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${section === id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" /> {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {section === 'account' && <AccountSection {...props} />}
          {section === 'roles' && <RolesSection user={props.user} onOpenOffice={props.onOpenOffice} />}
          {section === 'users' && superAdmin && <UsersSection user={props.user} onToast={props.onToast} />}
          {section === 'review' && superAdmin && <ReviewSection user={props.user} onToast={props.onToast} />}
          {section === 'policy' && superAdmin && <PolicySection onToast={props.onToast} />}
        </div>
      </div>
    </div>
  );
}
