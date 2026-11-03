import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Building,
  Check,
  CheckCircle,
  ClipboardList,
  Copy,
  DollarSign,
  Loader2,
  RefreshCw,
  Send,
  Undo2,
  UserMinus,
  Users,
  XCircle,
} from 'lucide-react';

import { api, ApiError } from '../api';
import type {
  AuditEntry,
  Budget,
  OfficeProposal,
  Organization,
  OrgMember,
  ProposalStatus,
  UserProfile,
} from '../types';

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

interface Props {
  user: UserProfile;
  onToast: Toast;
}

const LEVEL: Record<UserProfile['accessRole'], number> = {
  researcher: 20,
  grant_officer: 30,
  institution_admin: 40,
  super_admin: 50,
};

const STATUS_STYLE: Record<ProposalStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  review: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-blue-50 text-blue-800 border-blue-200',
  submitted: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  awarded: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};
const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
  submitted: 'Submitted',
  awarded: 'Awarded',
  rejected: 'Rejected',
};

type Filter = 'action' | 'submitted' | 'decided' | 'draft' | 'all';
const FILTERS: { id: Filter; label: string; match: (s: ProposalStatus) => boolean }[] = [
  { id: 'action', label: 'Needs action', match: (s) => s === 'review' || s === 'approved' },
  { id: 'submitted', label: 'Awaiting outcome', match: (s) => s === 'submitted' },
  { id: 'decided', label: 'Decided', match: (s) => s === 'awarded' || s === 'rejected' },
  { id: 'draft', label: 'Drafts', match: (s) => s === 'draft' },
  { id: 'all', label: 'All', match: () => true },
];

const money = (n: number | null | undefined, currency = 'USD') =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const daysUntil = (date: string | null) =>
  date ? Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000) : null;

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function StatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ------------------------------------------------------------------ */

export default function ResearchOffice({ user, onToast }: Props) {
  const isAdmin = LEVEL[user.accessRole] >= LEVEL.institution_admin;
  const [view, setView] = useState<'queue' | 'members' | 'activity'>('queue');
  const [org, setOrg] = useState<Organization | null>(null);

  useEffect(() => {
    api.organization().then(setOrg).catch((e) => onToast(errorText(e, 'Could not load your organization'), 'error'));
  }, []);

  const tabs = [
    { id: 'queue' as const, label: 'Review Queue', icon: ClipboardList },
    ...(isAdmin ? [{ id: 'members' as const, label: 'Members & Invites', icon: Users }] : []),
    { id: 'activity' as const, label: 'Activity', icon: Activity },
  ];

  return (
    <div id="subview-office" className="space-y-6">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Research Office</h1>
          <p className="text-gray-500 text-sm mt-1 flex items-center gap-2 flex-wrap">
            <Building className="w-4 h-4" aria-hidden="true" />
            <span>{org?.name ?? user.organization ?? 'Your organization'}</span>
            {org && org.status !== 'active' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200">
                {org.status}
              </span>
            )}
          </p>
        </div>
        <div role="tablist" aria-label="Research office sections" className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              id={`office-tab-${id}`}
              aria-selected={view === id}
              aria-controls={`office-panel-${id}`}
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold transition-colors ${
                view === id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {org?.status === 'pending' && (
        <div role="note" className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs p-4 rounded-xl">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            This organization is awaiting activation by a platform administrator. Proposals can be reviewed now; invite codes
            open once it is activated.
          </span>
        </div>
      )}

      <div role="tabpanel" id={`office-panel-${view}`} aria-labelledby={`office-tab-${view}`}>
        {view === 'queue' && <ReviewQueue user={user} onToast={onToast} />}
        {view === 'members' && isAdmin && <MembersPanel user={user} org={org} onOrgChange={setOrg} onToast={onToast} />}
        {view === 'activity' && <ActivityPanel onToast={onToast} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Review queue                                                        */
/* ------------------------------------------------------------------ */

type Action = {
  to: ProposalStatus;
  label: string;
  icon: typeof Check;
  tone: 'primary' | 'neutral' | 'danger' | 'success';
  /** Only an officer other than the owner may take it. */
  officerOnly: boolean;
  needsComment?: boolean;
};

// Mirrors ORG_WORKFLOW in server/routes/proposals.routes.ts; the server
// is the authority, this only decides which buttons to offer.
const ACTIONS: Partial<Record<ProposalStatus, Action[]>> = {
  review: [
    { to: 'approved', label: 'Approve', icon: Check, tone: 'primary', officerOnly: true },
    { to: 'draft', label: 'Send back for changes', icon: Undo2, tone: 'neutral', officerOnly: false, needsComment: true },
  ],
  approved: [
    { to: 'submitted', label: 'Submit to funder', icon: Send, tone: 'primary', officerOnly: true },
    { to: 'draft', label: 'Reopen as draft', icon: Undo2, tone: 'neutral', officerOnly: true, needsComment: true },
  ],
  submitted: [
    { to: 'awarded', label: 'Record award', icon: CheckCircle, tone: 'success', officerOnly: false },
    { to: 'rejected', label: 'Record rejection', icon: XCircle, tone: 'danger', officerOnly: false },
  ],
};

const TONE: Record<Action['tone'], string> = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600',
  danger: 'bg-white hover:bg-red-50 text-red-700 border-red-300',
  neutral: 'bg-white hover:bg-gray-50 text-gray-700 border-gray-300',
};

function ReviewQueue({ user, onToast }: Props) {
  const [proposals, setProposals] = useState<OfficeProposal[] | null>(null);
  const [filter, setFilter] = useState<Filter>('action');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = async () => {
    try {
      setProposals(await api.orgProposals());
    } catch (e) {
      onToast(errorText(e, 'Could not load proposals'), 'error');
      setProposals([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    const c = { review: 0, approved: 0, submitted: 0, awarded: 0 };
    for (const p of proposals ?? []) if (p.status in c) c[p.status as keyof typeof c]++;
    return c;
  }, [proposals]);

  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.id === filter)!.match;
    return (proposals ?? [])
      .filter((p) => match(p.status))
      .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
  }, [proposals, filter]);

  const selected = visible.find((p) => p.id === selectedId) ?? visible[0] ?? null;

  if (proposals === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 p-8" aria-busy="true">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading proposals…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Awaiting review', value: counts.review, tone: 'text-amber-700' },
          { label: 'Approved, not submitted', value: counts.approved, tone: 'text-blue-700' },
          { label: 'Awaiting funder outcome', value: counts.submitted, tone: 'text-indigo-700' },
          { label: 'Awarded', value: counts.awarded, tone: 'text-emerald-700' },
        ].map((k) => (
          <div key={k.label} className="bg-white p-4 rounded-xl border border-gray-200">
            <dt className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{k.label}</dt>
            <dd className={`text-2xl font-black mt-1 ${k.tone}`}>{k.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
              filter === f.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={load}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-100"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="bg-white p-10 rounded-xl border border-gray-200 text-center text-sm text-gray-500">
          {filter === 'action' ? 'Nothing is waiting on the research office.' : 'No proposals in this view.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 items-start">
          <ul className="space-y-2" aria-label="Proposals">
            {visible.map((p) => {
              const left = daysUntil(p.deadline);
              const isSelected = selected?.id === p.id;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`w-full text-left bg-white p-4 rounded-xl border transition-all ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex justify-between gap-3 items-start">
                      <span className="font-bold text-xs text-gray-900 line-clamp-2">{p.title}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                      <span>{p.ownerId === user.id ? 'Your proposal' : p.ownerName}</span>
                      <span>{money(p.amount)}</span>
                      <span className={left != null && left <= 14 && left >= 0 ? 'text-red-700 font-semibold' : ''}>
                        {p.deadline ? `Due ${day(p.deadline)}${left != null && left >= 0 ? ` (${left}d)` : ' (past)'}` : 'No deadline'}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected && <ProposalDetail proposal={selected} user={user} onToast={onToast} onChanged={load} />}
        </div>
      )}
    </div>
  );
}

function ProposalDetail({
  proposal: p,
  user,
  onToast,
  onChanged,
}: {
  proposal: OfficeProposal;
  user: UserProfile;
  onToast: Toast;
  onChanged: () => Promise<void> | void;
}) {
  const isOwner = p.ownerId === user.id;
  const [budget, setBudget] = useState<Budget | null | undefined>(undefined);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // A different proposal selected: start clean.
  useEffect(() => {
    setComment('');
    setBudget(undefined);
    let current = true;
    api
      .budget(p.id)
      .then((b) => current && setBudget(b))
      .catch(() => current && setBudget(null));
    return () => {
      current = false;
    };
  }, [p.id]);

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      onToast(success);
      setComment('');
      await onChanged();
    } catch (e) {
      onToast(errorText(e, 'That action failed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const actions = ACTIONS[p.status] ?? [];
  const history = [...p.history].reverse();

  return (
    <section aria-labelledby="office-detail-title" className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
      <div className="p-6 space-y-3">
        <div className="flex justify-between gap-4 items-start">
          <h2 id="office-detail-title" className="text-lg font-black text-gray-900 leading-snug">{p.title}</h2>
          <StatusBadge status={p.status} />
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div><dt className="text-gray-500">Applicant</dt><dd className="font-semibold text-gray-900">{isOwner ? `${p.ownerName} (you)` : p.ownerName}</dd></div>
          <div><dt className="text-gray-500">Funder</dt><dd className="font-semibold text-gray-900">{p.funderName || '—'}</dd></div>
          <div><dt className="text-gray-500">Requested</dt><dd className="font-semibold text-gray-900">{money(p.amount)}</dd></div>
          <div><dt className="text-gray-500">Deadline</dt><dd className="font-semibold text-gray-900">{day(p.deadline)}</dd></div>
          {p.grantTitle !== p.title && (
            <div className="col-span-2"><dt className="text-gray-500">Call</dt><dd className="font-semibold text-gray-900">{p.grantTitle}</dd></div>
          )}
        </dl>
        {p.notes && (
          <p className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-line">{p.notes}</p>
        )}
      </div>

      {/* Budget */}
      <div className="p-6 space-y-3">
        <div className="flex justify-between items-center gap-3">
          <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" aria-hidden="true" /> Budget
          </h3>
          {budget && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
              budget.status === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-gray-100 text-gray-700 border-gray-200'
            }`}>
              {budget.status === 'approved' ? `Approved ${day(budget.approvedAt)}` : 'Not yet approved'}
            </span>
          )}
        </div>
        {budget === undefined ? (
          <p className="text-xs text-gray-500">Loading budget…</p>
        ) : budget === null || budget.lines.length === 0 ? (
          <p className="text-xs text-gray-500">The applicant has not entered a budget yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider">
                    <th scope="col" className="py-1.5 pr-3 font-bold">Category</th>
                    <th scope="col" className="py-1.5 pr-3 font-bold">Description</th>
                    <th scope="col" className="py-1.5 pr-3 font-bold">Year</th>
                    <th scope="col" className="py-1.5 font-bold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {budget.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1.5 pr-3 capitalize">{l.category}</td>
                      <td className="py-1.5 pr-3 text-gray-600">{l.description || '—'}</td>
                      <td className="py-1.5 pr-3">{l.year}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{money(l.amount, budget.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <th scope="row" colSpan={3} className="py-2 text-left font-black">Total</th>
                    <td className="py-2 text-right font-black tabular-nums">{money(budget.total, budget.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {budget.status !== 'approved' && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  disabled={isOwner || busy !== null}
                  onClick={() => run('budget', async () => setBudget(await api.approveBudget(p.id)), 'Budget approved.')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy === 'budget' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                  Approve budget
                </button>
                {isOwner && <span className="text-[11px] text-gray-500">Another officer must approve your own budget.</span>}
              </div>
            )}
          </>
        )}
      </div>

      {/* Decision */}
      {actions.length > 0 && (
        <div className="p-6 space-y-3">
          <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Decision</h3>
          <div>
            <label htmlFor={`office-comment-${p.id}`} className="block text-[11px] font-semibold text-gray-600 mb-1">
              Comment for the applicant {actions.some((a) => a.needsComment) && <span className="font-normal">(required to send back)</span>}
            </label>
            <textarea
              id={`office-comment-${p.id}`}
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={5000}
              placeholder="e.g. Approved. Please attach the data-management plan before submission."
              className="block w-full p-2.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => {
              const blockedByOwnership = a.officerOnly && isOwner;
              const blockedByComment = a.needsComment && comment.trim() === '';
              const Icon = a.icon;
              return (
                <button
                  key={a.to}
                  disabled={blockedByOwnership || blockedByComment || busy !== null}
                  title={blockedByOwnership ? 'Another officer must do this for your own proposal' : blockedByComment ? 'Add a comment first' : undefined}
                  onClick={() => run(a.to, () => api.transition(p.id, a.to, comment.trim() || undefined), `Proposal moved to ${STATUS_LABEL[a.to].toLowerCase()}.`)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border disabled:opacity-50 disabled:cursor-not-allowed ${TONE[a.tone]}`}
                >
                  {busy === a.to ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
                  {a.label}
                </button>
              );
            })}
          </div>
          {isOwner && actions.some((a) => a.officerOnly) && (
            <p className="text-[11px] text-gray-500">This is your own proposal: approving and submitting it needs another officer.</p>
          )}
          {p.status === 'approved' && budget && budget.status !== 'approved' && budget.lines.length > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              The budget is not approved yet. Approve it before submitting to the funder.
            </p>
          )}
        </div>
      )}

      {/* Timeline */}
      <div className="p-6 space-y-3">
        <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Timeline</h3>
        <ol className="space-y-3">
          {history.map((h) => (
            <li key={h.id} className="flex gap-3 text-xs">
              <span className="mt-1 w-2 h-2 rounded-full bg-gray-300 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={h.status} />
                  <span className="text-gray-500">{when(h.timestamp)} · {h.actor}</span>
                </div>
                {h.notes && <p className="text-gray-700 mt-1 whitespace-pre-line">{h.notes}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Members & invites (institution admins)                              */
/* ------------------------------------------------------------------ */

const ROLE_LABEL: Record<UserProfile['accessRole'], string> = {
  researcher: 'Researcher',
  grant_officer: 'Grant officer',
  institution_admin: 'Institution admin',
  super_admin: 'Platform admin',
};

function MembersPanel({
  user,
  org,
  onOrgChange,
  onToast,
}: {
  user: UserProfile;
  org: Organization | null;
  onOrgChange: (o: Organization) => void;
  onToast: Toast;
}) {
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api.orgMembers().then(setMembers).catch((e) => {
      onToast(errorText(e, 'Could not load members'), 'error');
      setMembers([]);
    });
  useEffect(() => {
    load();
  }, []);

  const rotate = async () => {
    if (org?.inviteCode && !confirm('Generate a new invite code? The current code will stop working.')) return;
    setBusy('invite');
    try {
      const inviteCode = await api.rotateInviteCode();
      if (org) onOrgChange({ ...org, inviteCode });
      onToast('New invite code generated.');
    } catch (e) {
      onToast(errorText(e, 'Could not generate a code'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!org?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(org.inviteCode);
      onToast('Invite code copied.');
    } catch {
      onToast('Copy failed; select the code and copy it manually.', 'error');
    }
  };

  const changeRole = async (m: OrgMember, role: 'researcher' | 'grant_officer') => {
    setBusy(m.id);
    try {
      await api.setMemberRole(m.id, role);
      setMembers((cur) => cur?.map((x) => (x.id === m.id ? { ...x, accessRole: role } : x)) ?? null);
      onToast(`${m.name} is now a ${ROLE_LABEL[role].toLowerCase()}.`);
    } catch (e) {
      onToast(errorText(e, 'Role change failed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: OrgMember) => {
    if (!confirm(`Remove ${m.name} from ${org?.name ?? 'the organization'}? Their own proposals stay with them.`)) return;
    setBusy(m.id);
    try {
      await api.removeMember(m.id);
      setMembers((cur) => cur?.filter((x) => x.id !== m.id) ?? null);
      onToast(`${m.name} was removed.`);
    } catch (e) {
      onToast(errorText(e, 'Could not remove member'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const active = org?.status === 'active';

  return (
    <div className="space-y-6">
      <section aria-labelledby="invite-heading" className="bg-white p-6 rounded-xl border border-gray-200 space-y-3">
        <h2 id="invite-heading" className="text-sm font-black text-gray-900">Invite code</h2>
        <p className="text-xs text-gray-500">
          New colleagues enter this code when they create an account to join {org?.name ?? 'your organization'} as researchers.
          Generating a new code stops the old one from working.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <code className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm font-bold tracking-widest text-gray-900 min-w-[12rem]">
            {org?.inviteCode ?? (active ? 'No code yet' : 'Unavailable until activation')}
          </code>
          {org?.inviteCode && (
            <button onClick={copy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-gray-300 bg-white hover:bg-gray-50 text-gray-700">
              <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copy
            </button>
          )}
          <button
            onClick={rotate}
            disabled={!active || busy !== null}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-blue-600 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === 'invite' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
            {org?.inviteCode ? 'Generate new code' : 'Generate code'}
          </button>
        </div>
      </section>

      <section aria-labelledby="members-heading" className="bg-white rounded-xl border border-gray-200">
        <div className="p-6 pb-3 flex justify-between items-center">
          <h2 id="members-heading" className="text-sm font-black text-gray-900">
            Members {members && <span className="text-gray-400 font-bold">({members.length})</span>}
          </h2>
        </div>
        {members === null ? (
          <p className="px-6 pb-6 text-xs text-gray-500">Loading members…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider border-y border-gray-100 bg-gray-50/50">
                  <th scope="col" className="px-6 py-2 font-bold">Member</th>
                  <th scope="col" className="px-3 py-2 font-bold">Role</th>
                  <th scope="col" className="px-3 py-2 font-bold">Status</th>
                  <th scope="col" className="px-3 py-2 font-bold">Last sign-in</th>
                  <th scope="col" className="px-6 py-2 font-bold text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.map((m) => {
                  const isSelf = m.id === user.id;
                  // Admins manage researchers and grant officers; anything
                  // above that is a platform admin's call (the API agrees).
                  const manageable = !isSelf && (m.accessRole === 'researcher' || m.accessRole === 'grant_officer');
                  return (
                    <tr key={m.id}>
                      <td className="px-6 py-3">
                        <div className="font-semibold text-gray-900">{m.name}{isSelf && <span className="text-gray-400 font-normal"> (you)</span>}</div>
                        <div className="text-gray-500">{m.email}</div>
                      </td>
                      <td className="px-3 py-3">
                        {manageable ? (
                          <>
                            <label htmlFor={`role-${m.id}`} className="sr-only">Role for {m.name}</label>
                            <select
                              id={`role-${m.id}`}
                              value={m.accessRole}
                              disabled={busy !== null}
                              onChange={(e) => changeRole(m, e.target.value as 'researcher' | 'grant_officer')}
                              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                            >
                              <option value="researcher">Researcher</option>
                              <option value="grant_officer">Grant officer</option>
                            </select>
                          </>
                        ) : (
                          <span className="font-semibold text-gray-700">{ROLE_LABEL[m.accessRole]}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {m.suspended ? (
                          <span className="text-red-700 font-semibold">Suspended</span>
                        ) : m.emailVerified ? (
                          <span className="text-emerald-700 font-semibold">Active</span>
                        ) : (
                          <span className="text-amber-700 font-semibold">Unverified</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-600">{m.lastLoginAt ? day(m.lastLoginAt) : 'Never'}</td>
                      <td className="px-6 py-3 text-right">
                        {manageable && (
                          <button
                            onClick={() => remove(m)}
                            disabled={busy !== null}
                            aria-label={`Remove ${m.name} from the organization`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            {busy === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <UserMinus className="w-3.5 h-3.5" aria-hidden="true" />}
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Activity (org-scoped audit log)                                     */
/* ------------------------------------------------------------------ */

const ACTION_LABEL: Record<string, string> = {
  'proposal.create': 'started a proposal',
  'proposal.review': 'sent a proposal for review',
  'proposal.approved': 'approved a proposal',
  'proposal.draft': 'returned a proposal to draft',
  'proposal.submitted': 'submitted a proposal',
  'proposal.awarded': 'recorded an award',
  'proposal.rejected': 'recorded a rejection',
  'proposal.update': 'edited a proposal',
  'proposal.note': 'added a timeline note',
  'proposal.delete': 'deleted a proposal',
  'budget.update': 'updated a budget',
  'budget.approve': 'approved a budget',
  'org.member_role': 'changed a member role',
  'org.member_remove': 'removed a member',
  'org.invite_rotate': 'generated a new invite code',
  'user.register': 'joined',
  'user.login': 'signed in',
  'user.logout': 'signed out',
  'user.logout_all': 'signed out everywhere',
  'user.profile_update': 'updated their profile',
  'match.feedback': 'rated a grant match',
  'grant.bookmark': 'bookmarked a grant',
  'grant.unbookmark': 'removed a bookmark',
  'assistant.generate': 'used the proposal assistant',
  'team.create': 'created a team',
  'team.join': 'joined a team',
  'team.leave': 'left a team',
  'team.transfer': 'handed over a team',
  'team.delete': 'closed a team',
  'team.member_add': 'added someone to a team',
  'team.member_remove': 'removed someone from a team',
  'team.grant_share': 'shared a grant with a team',
  'team.grant_status': 'updated a team grant',
};

// The office sees names of current members only; someone who has since
// left still has an actor id but no visible name.
const actorLabel = (e: AuditEntry) => e.actorName ?? (e.actorId ? 'Former member' : 'System');

function ActivityPanel({ onToast }: { onToast: Toast }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    api.orgActivity().then(setEntries).catch((e) => {
      onToast(errorText(e, 'Could not load activity'), 'error');
      setEntries([]);
    });
  }, []);

  if (entries === null) return <p className="text-xs text-gray-500 p-6">Loading activity…</p>;
  if (entries.length === 0) {
    return <div className="bg-white p-10 rounded-xl border border-gray-200 text-center text-sm text-gray-500">No recorded activity yet.</div>;
  }
  return (
    <section aria-label="Recent organization activity" className="bg-white rounded-xl border border-gray-200">
      <ol className="divide-y divide-gray-100">
        {entries.map((e) => (
          <li key={e.id} className="px-6 py-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <time dateTime={e.at} className="text-gray-500 w-36 shrink-0">{when(e.at)}</time>
            <span className="text-gray-900">
              <span className="font-semibold">{actorLabel(e)}</span>{' '}
              {ACTION_LABEL[e.action] ?? <code className="text-gray-600">{e.action}</code>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
