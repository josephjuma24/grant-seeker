import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  Upload,
  User,
  X,
  XCircle,
} from 'lucide-react';

import { api, ApiError } from '../api';
import {
  bandFor,
  CAREER_STAGE_LABEL,
  DOCUMENT_KINDS,
  type ComponentResult,
  type DocumentKind,
  type Eligibility,
  type Evidence,
  type Field,
  type GateResult,
  type ProfileFieldKey,
  type StructuredProfile,
} from '../../shared/profile';
import type { SmartMatch, SmartMatchList, SmartProfilePayload } from '../types';

// Smart Profile & Grant Matching: documents in, an editable structured
// profile out, and ranked matches whose every point can be traced back to
// a line in a document, a form field or an edit.

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

interface Props {
  onToast: Toast;
  /** "Apply": opens the call in the AI Proposal Assistant with this match. */
  onApply: (grant: SmartMatch['grant']) => void;
}

/** New grants arrive from the harvester; the list refreshes on its own. */
const REFRESH_MS = 60_000;

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
const daysUntil = (date: string) => Math.ceil((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86_400_000);

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

const BAND_STYLE = {
  high: 'bg-emerald-600 text-white',
  medium: 'bg-amber-500 text-white',
  low: 'bg-gray-400 text-white',
} as const;
const BAND_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

const ELIGIBILITY_STYLE: Record<Eligibility, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  eligible: { label: 'Eligible', className: 'bg-emerald-50 text-emerald-800 border-emerald-200', Icon: CheckCircle2 },
  check: { label: 'Check eligibility', className: 'bg-amber-50 text-amber-800 border-amber-200', Icon: HelpCircle },
  ineligible: { label: 'Ineligible', className: 'bg-red-50 text-red-700 border-red-200', Icon: XCircle },
};

export function ScoreBadge({ score }: { score: number }) {
  const band = bandFor(score);
  return (
    <div className={`shrink-0 w-16 h-16 rounded-xl flex flex-col items-center justify-center ${BAND_STYLE[band]}`} aria-label={`Fit score ${score} of 100, ${BAND_LABEL[band]}`}>
      <span className="text-xl font-extrabold leading-none">{score}</span>
      <span className="text-[9px] font-bold uppercase tracking-wider mt-1 opacity-90">{BAND_LABEL[band]}</span>
    </div>
  );
}

export function EligibilityPill({ value }: { value: Eligibility }) {
  const { label, className, Icon } = ELIGIBILITY_STYLE[value];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${className}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {label}
    </span>
  );
}

const sourceIcon = (e: Evidence) => (e.docId ? FileText : e.source === 'Edited by you' ? Pencil : User);

/** Where a value came from: chips that open to the quoted line. */
export function EvidenceChips({ evidence, max = 3 }: { evidence: Evidence[]; max?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  // Country and region often come from the same line: show it once.
  const unique = evidence.filter((e, i) => evidence.findIndex((x) => x.source === e.source && x.quote === e.quote) === i);
  if (unique.length === 0) return null;
  const shown = unique.slice(0, max);
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1">
        {shown.map((e, i) => {
          const Icon = sourceIcon(e);
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              title={e.quote}
              className={`inline-flex items-center gap-1 max-w-[14rem] text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors ${open === i ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}
            >
              <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{e.source}</span>
            </button>
          );
        })}
        {unique.length > max && <span className="text-[10px] text-gray-400 self-center">+{unique.length - max} more</span>}
      </div>
      {open !== null && shown[open] && (
        <blockquote className="mt-1.5 text-[11px] text-gray-600 bg-gray-50 border-l-2 border-blue-300 px-2 py-1 rounded-r break-words">
          “{shown[open].quote}”
        </blockquote>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Completeness and documents                                          */
/* ------------------------------------------------------------------ */

function CompletenessMeter({ data, onUploadClick }: { data: SmartProfilePayload['completeness']; onUploadClick: () => void }) {
  const todo = data.items.filter((i) => !i.done).sort((a, b) => b.weight - a.weight);
  const color = data.percent >= 80 ? 'bg-emerald-500' : data.percent >= 50 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5" aria-labelledby="completeness-heading">
      <div className="flex items-baseline justify-between">
        <h3 id="completeness-heading" className="text-sm font-bold text-gray-900">Profile completeness</h3>
        <span className="text-2xl font-extrabold text-gray-900">{data.percent}%</span>
      </div>
      <div className="mt-3 w-full bg-gray-100 rounded-full h-2.5 overflow-hidden" role="progressbar" aria-valuenow={data.percent} aria-valuemin={0} aria-valuemax={100} aria-labelledby="completeness-heading">
        <div className={`h-2.5 rounded-full transition-all duration-500 ${color}`} style={{ width: `${data.percent}%` }} />
      </div>
      {todo.length === 0 ? (
        <p className="mt-3 text-xs text-emerald-700 font-semibold">Complete. Every score draws on a full profile.</p>
      ) : (
        <>
          <p className="mt-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">To improve your matches</p>
          <ul className="mt-2 space-y-2">
            {todo.slice(0, 4).map((i) => (
              <li key={i.key} className="flex gap-2 text-xs text-gray-700">
                <span className="shrink-0 mt-0.5 text-[10px] font-bold text-blue-700 bg-blue-50 rounded px-1">+{i.weight}</span>
                <span>{i.prompt}</span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onUploadClick} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg py-2 transition-colors">
            <Upload className="w-3.5 h-3.5" aria-hidden="true" /> Upload a document
          </button>
        </>
      )}
    </section>
  );
}

function DocumentsPanel({
  documents,
  busy,
  onUpload,
  onDelete,
  inputRef,
}: {
  documents: SmartProfilePayload['documents'];
  busy: boolean;
  onUpload: (file: File, kind: DocumentKind) => void;
  onDelete: (id: string, name: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [kind, setKind] = useState<DocumentKind>('cv');
  const [dragging, setDragging] = useState(false);
  const take = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onUpload(f, kind);
  };
  const kindLabel = (k: DocumentKind) => DOCUMENT_KINDS.find((d) => d.id === k)?.label ?? k;
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5" aria-labelledby="documents-heading">
      <h3 id="documents-heading" className="text-sm font-bold text-gray-900">Context documents</h3>
      <p className="text-[11px] text-gray-500 mt-0.5">PDF or DOCX, up to 10 MB. Only the text is kept.</p>
      <label className="block mt-3 text-[11px] font-bold text-gray-600" htmlFor="doc-kind">Document type</label>
      <select id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} className="mt-1 w-full text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white">
        {DOCUMENT_KINDS.map((k) => (
          <option key={k.id} value={k.id}>{k.label}</option>
        ))}
      </select>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}
        className={`mt-3 border-2 border-dashed rounded-lg p-4 text-center transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}
      >
        {busy ? (
          <p className="text-xs text-gray-600 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Reading document and rescoring…</p>
        ) : (
          <>
            <p className="text-xs text-gray-500">Drop a file here or</p>
            <button type="button" onClick={() => inputRef.current?.click()} className="mt-1 text-xs font-bold text-blue-700 hover:underline">choose a file</button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          aria-label="Upload a PDF or DOCX document"
          disabled={busy}
          onChange={(e) => { take(e.target.files); e.target.value = ''; }}
        />
      </div>
      {documents.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100">
          {documents.map((d) => (
            <li key={d.id} className="py-2 flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-800 truncate" title={d.filename}>{d.filename}</p>
                <p className="text-[10px] text-gray-500">
                  {kindLabel(d.kind)} · {d.pages ? `${d.pages} page${d.pages === 1 ? '' : 's'} · ` : ''}{Math.max(1, Math.round(d.sizeBytes / 1024))} KB
                </p>
              </div>
              <button type="button" disabled={busy} onClick={() => onDelete(d.id, d.filename)} className="p-1.5 text-gray-400 hover:text-red-600 rounded disabled:opacity-40" aria-label={`Remove ${d.filename}`}>
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Match cards                                                         */
/* ------------------------------------------------------------------ */

export function GateRow({ gate }: { gate: GateResult }) {
  const Icon = gate.status === 'pass' ? CheckCircle2 : gate.status === 'fail' ? XCircle : HelpCircle;
  const color = gate.status === 'pass' ? 'text-emerald-600' : gate.status === 'fail' ? 'text-red-600' : 'text-amber-600';
  return (
    <li className="flex gap-2">
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${color}`} aria-label={gate.status} />
      <div className="min-w-0">
        <p className="text-xs text-gray-800"><span className="font-bold">{gate.label}:</span> {gate.detail}</p>
        <EvidenceChips evidence={gate.evidence} max={2} />
      </div>
    </li>
  );
}

function ComponentRow({ c }: { c: ComponentResult }) {
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-bold text-gray-800">{c.label} <span className="font-semibold text-gray-400">· {Math.round(c.weight * 100)}%</span></span>
        <span className="font-mono text-gray-600 shrink-0">{c.score}/100 → +{c.points}</span>
      </div>
      <div className="mt-1 w-full bg-gray-100 rounded-full h-1.5 overflow-hidden" aria-hidden="true">
        <div className={`h-1.5 rounded-full ${c.score >= 80 ? 'bg-emerald-500' : c.score >= 50 ? 'bg-amber-400' : 'bg-red-300'}`} style={{ width: `${c.score}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-gray-600">{c.detail}</p>
      <EvidenceChips evidence={c.evidence} />
      {c.grantEvidence && (
        <p className="mt-1 text-[11px] text-gray-500"><span className="font-semibold">The call:</span> “{c.grantEvidence}”</p>
      )}
    </li>
  );
}

function MatchCard({ item, onApply }: { item: SmartMatch; onApply: Props['onApply'] }) {
  const [open, setOpen] = useState(false);
  const { match, grant } = item;
  const fit = match.fit;
  const eligibility = match.eligibility ?? fit?.eligibility ?? 'check';
  const days = grant.deadline ? daysUntil(grant.deadline) : null;
  const gaps = fit?.gaps ?? [];
  return (
    <article className={`bg-white rounded-xl border p-4 sm:p-5 ${eligibility === 'ineligible' ? 'border-red-100 opacity-80' : 'border-gray-200'}`} aria-labelledby={`m-${grant.id}`}>
      <div className="flex gap-3 sm:gap-4">
        <ScoreBadge score={match.matchScore} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <EligibilityPill value={eligibility} />
            <span className="text-[10px] font-semibold text-gray-500 truncate">{grant.funderName}</span>
          </div>
          <h4 id={`m-${grant.id}`} className="mt-1 text-sm font-bold text-gray-900 leading-snug">{grant.title}</h4>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" aria-hidden="true" />
              {grant.deadline ? `${grant.deadline}${days !== null && days >= 0 ? ` (${days} day${days === 1 ? '' : 's'} left)` : ''}` : 'Rolling / not stated'}
            </span>
            {grant.fundingAmount > 0 && <span>{money(grant.fundingAmount)}</span>}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Why you match</p>
        <p className="mt-1 text-xs text-gray-700 leading-relaxed">{fit?.explanation ?? match.rationale}</p>
      </div>

      {gaps.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Gaps</p>
          <ul className="mt-1 space-y-1">
            {gaps.slice(0, open ? gaps.length : 2).map((g, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-gray-700">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" aria-hidden="true" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
          {!open && gaps.length > 2 && <p className="text-[11px] text-gray-400 mt-1">+{gaps.length - 2} more in the breakdown</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Applying happens in GrantSeeker; the funder's page stays one click away. */}
        <button
          type="button"
          onClick={() => onApply(grant)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Apply with AI assistant
        </button>
        {grant.url && /^https?:\/\//i.test(grant.url) && (
          <a
            href={grant.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-blue-700 border border-gray-200 hover:border-blue-200 rounded-lg px-3 py-2 transition-colors"
            aria-label={`Original call for ${grant.title} (opens the funder's site in a new tab)`}
          >
            Original call <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        )}
        {fit && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={`b-${grant.id}`}
            className="inline-flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-gray-900 px-2 py-2"
          >
            How this score was built <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && fit && (
        <div id={`b-${grant.id}`} className="mt-3 pt-3 border-t border-gray-100 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Eligibility gates (pass / fail)</p>
            <ul className="mt-2 space-y-2">
              {fit.gates.map((g) => <React.Fragment key={g.key}><GateRow gate={g} /></React.Fragment>)}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Weighted fit = {fit.score}</p>
            <ul className="mt-1 divide-y divide-gray-100">
              {fit.components.map((c) => <React.Fragment key={c.key}><ComponentRow c={c} /></React.Fragment>)}
            </ul>
          </div>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Profile editor                                                      */
/* ------------------------------------------------------------------ */

type FieldDef = { key: ProfileFieldKey; label: string; kind: 'text' | 'select' | 'list' | 'grants' | 'pubs' | 'registration' | 'budget' | 'number'; options?: [string, string][] };

const FIELDS: FieldDef[] = [
  { key: 'applicantType', label: 'Applicant type', kind: 'select', options: [['individual', 'Individual researcher'], ['organisation', 'Organisation']] },
  { key: 'country', label: 'Country', kind: 'text' },
  { key: 'region', label: 'Region', kind: 'text' },
  { key: 'careerStage', label: 'Career stage', kind: 'select', options: Object.entries(CAREER_STAGE_LABEL) },
  { key: 'institution', label: 'Institution / organisation', kind: 'text' },
  { key: 'qualifications', label: 'Qualifications', kind: 'list' },
  { key: 'themes', label: 'Thematic areas', kind: 'list' },
  { key: 'keywords', label: 'Keywords', kind: 'list' },
  { key: 'pastGrants', label: 'Past grants', kind: 'grants' },
  { key: 'publications', label: 'Publications', kind: 'pubs' },
  { key: 'partnerships', label: 'Partnerships', kind: 'list' },
  { key: 'registration', label: 'Registration', kind: 'registration' },
  { key: 'annualBudget', label: 'Annual budget', kind: 'budget' },
  { key: 'teamSize', label: 'Team size', kind: 'number' },
];

type GrantDraft = { funder: string; amount: string; currency: string; year: string };
type PubDraft = { title: string; year: string };

function display(def: FieldDef, value: unknown): React.ReactNode {
  const empty = <span className="text-gray-400 italic">Not found yet</span>;
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return empty;
  switch (def.kind) {
    case 'select':
      return def.options?.find(([v]) => v === value)?.[1] ?? String(value);
    case 'list':
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((v) => <span key={v} className="text-[11px] bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">{v}</span>)}
        </span>
      );
    case 'grants':
      return (
        <ul className="space-y-0.5">
          {(value as StructuredProfile['pastGrants']['value']).map((g, i) => (
            <li key={i}>{g.funder}{g.amount ? ` · ${money(g.amount, g.currency)}` : ''}{g.year ? ` · ${g.year}` : ''}</li>
          ))}
        </ul>
      );
    case 'pubs': {
      const pubs = value as StructuredProfile['publications']['value'];
      return (
        <ul className="space-y-0.5">
          {pubs.slice(0, 5).map((p, i) => <li key={i} className="truncate" title={p.title}>{p.title}</li>)}
          {pubs.length > 5 && <li className="text-gray-400">+{pubs.length - 5} more</li>}
        </ul>
      );
    }
    case 'registration': {
      const r = value as { registered: boolean; detail: string };
      return r.registered ? `Registered${r.detail ? ` — ${r.detail}` : ''}` : `Not registered${r.detail ? ` — ${r.detail}` : ''}`;
    }
    case 'budget': {
      const b = value as { amount: number; currency: string };
      return money(b.amount, b.currency);
    }
    default:
      return String(value);
  }
}

function FieldEditor({ def, field, busy, onSave, onCancel }: { def: FieldDef; field: Field<unknown>; busy: boolean; onSave: (value: unknown) => void; onCancel: () => void }) {
  const v = field.value;
  const [text, setText] = useState(() =>
    def.kind === 'list' ? ((v as string[]) ?? []).join('\n') : def.kind === 'number' || def.kind === 'text' || def.kind === 'select' ? (v == null ? '' : String(v)) : '',
  );
  const [grantsDraft, setGrantsDraft] = useState<GrantDraft[]>(() =>
    def.kind === 'grants' ? ((v as StructuredProfile['pastGrants']['value']) ?? []).map((g) => ({ funder: g.funder, amount: g.amount ? String(g.amount) : '', currency: g.currency, year: g.year ? String(g.year) : '' })) : [],
  );
  const [pubsDraft, setPubsDraft] = useState<PubDraft[]>(() =>
    def.kind === 'pubs' ? ((v as StructuredProfile['publications']['value']) ?? []).map((p) => ({ title: p.title, year: p.year ? String(p.year) : '' })) : [],
  );
  const reg = def.kind === 'registration' ? (v as { registered: boolean; detail: string } | null) : null;
  const [registered, setRegistered] = useState(reg?.registered ?? true);
  const [regDetail, setRegDetail] = useState(reg?.detail ?? '');
  const budget = def.kind === 'budget' ? (v as { amount: number; currency: string } | null) : null;
  const [amount, setAmount] = useState(budget ? String(budget.amount) : '');
  const [currency, setCurrency] = useState(budget?.currency ?? 'USD');

  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const value = (): unknown => {
    switch (def.kind) {
      case 'text': return text.trim() || null;
      case 'select': return text || null;
      case 'number': return num(text);
      case 'list': return text.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
      case 'grants': return grantsDraft.filter((g) => g.funder.trim()).map((g) => ({ funder: g.funder.trim(), amount: num(g.amount), currency: g.currency || 'USD', year: num(g.year) }));
      case 'pubs': return pubsDraft.filter((p) => p.title.trim()).map((p) => ({ title: p.title.trim(), year: num(p.year) }));
      case 'registration': return { registered, detail: regDetail.trim() };
      case 'budget': return amount.trim() ? { amount: Number(amount), currency } : null;
    }
  };
  const input = 'w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500';
  const id = `edit-${def.key}`;

  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => { e.preventDefault(); onSave(value()); }}
      aria-label={`Edit ${def.label}`}
    >
      {def.kind === 'text' && <input id={id} className={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={200} aria-label={def.label} />}
      {def.kind === 'number' && <input id={id} type="number" min={0} className={input} value={text} onChange={(e) => setText(e.target.value)} aria-label={def.label} />}
      {def.kind === 'select' && (
        <select id={id} className={input} value={text} onChange={(e) => setText(e.target.value)} aria-label={def.label}>
          <option value="">Not set</option>
          {def.options!.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      )}
      {def.kind === 'list' && (
        <>
          <textarea id={id} rows={4} className={input} value={text} onChange={(e) => setText(e.target.value)} aria-label={def.label} />
          <p className="text-[10px] text-gray-500">One per line, or separated by commas.</p>
        </>
      )}
      {def.kind === 'grants' && (
        <div className="space-y-2">
          {grantsDraft.map((g, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_5rem_5rem_auto] gap-1.5 items-center">
              <input className={`${input} col-span-2 sm:col-span-1`} placeholder="Funder" value={g.funder} aria-label="Funder" onChange={(e) => setGrantsDraft(grantsDraft.map((x, j) => (j === i ? { ...x, funder: e.target.value } : x)))} />
              <input className={input} placeholder="Amount" inputMode="numeric" value={g.amount} aria-label="Amount" onChange={(e) => setGrantsDraft(grantsDraft.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
              <input className={input} placeholder="USD" maxLength={3} value={g.currency} aria-label="Currency" onChange={(e) => setGrantsDraft(grantsDraft.map((x, j) => (j === i ? { ...x, currency: e.target.value.toUpperCase() } : x)))} />
              <input className={input} placeholder="Year" inputMode="numeric" maxLength={4} value={g.year} aria-label="Year" onChange={(e) => setGrantsDraft(grantsDraft.map((x, j) => (j === i ? { ...x, year: e.target.value.replace(/\D/g, '') } : x)))} />
              <button type="button" onClick={() => setGrantsDraft(grantsDraft.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-600 justify-self-end" aria-label="Remove grant"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setGrantsDraft([...grantsDraft, { funder: '', amount: '', currency: 'USD', year: '' }])} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700"><Plus className="w-3.5 h-3.5" /> Add grant</button>
        </div>
      )}
      {def.kind === 'pubs' && (
        <div className="space-y-2">
          {pubsDraft.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_auto] gap-1.5 items-center">
              <input className={input} placeholder="Title or citation" value={p.title} aria-label="Publication" onChange={(e) => setPubsDraft(pubsDraft.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <input className={input} placeholder="Year" inputMode="numeric" maxLength={4} value={p.year} aria-label="Year" onChange={(e) => setPubsDraft(pubsDraft.map((x, j) => (j === i ? { ...x, year: e.target.value.replace(/\D/g, '') } : x)))} />
              <button type="button" onClick={() => setPubsDraft(pubsDraft.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-600" aria-label="Remove publication"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setPubsDraft([...pubsDraft, { title: '', year: '' }])} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700"><Plus className="w-3.5 h-3.5" /> Add publication</button>
        </div>
      )}
      {def.kind === 'registration' && (
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={registered} onChange={(e) => setRegistered(e.target.checked)} /> Legally registered
          </label>
          <input className={input} placeholder="Registration number, authority" value={regDetail} onChange={(e) => setRegDetail(e.target.value)} aria-label="Registration details" />
        </div>
      )}
      {def.kind === 'budget' && (
        <div className="grid grid-cols-[1fr_5rem] gap-1.5">
          <input className={input} placeholder="Amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Annual budget" />
          <input className={input} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} aria-label="Currency" />
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />} Save and rescore
        </button>
        <button type="button" onClick={onCancel} className="text-xs font-bold text-gray-600 hover:text-gray-900 px-2">Cancel</button>
      </div>
    </form>
  );
}

function ProfileFields({ profile, busy, onSave, onReset }: { profile: StructuredProfile; busy: boolean; onSave: (key: ProfileFieldKey, value: unknown) => Promise<boolean>; onReset: (key: ProfileFieldKey) => void }) {
  const [editing, setEditing] = useState<ProfileFieldKey | null>(null);
  const org = profile.applicantType.value === 'organisation';
  // Fields that do not apply to this applicant type move to the end.
  const order = FIELDS.filter((f) => (org ? f.key !== 'careerStage' : true));
  return (
    <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
      {order.map((def) => {
        const field = profile[def.key] as Field<unknown>;
        return (
          <li key={def.key} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  {def.label}
                  {field.edited && <span className="normal-case tracking-normal text-[10px] font-bold text-blue-700 bg-blue-50 rounded px-1">Edited</span>}
                </p>
                {editing !== def.key && <div className="mt-1 text-xs text-gray-800 break-words">{display(def, field.value)}</div>}
                {editing !== def.key && <EvidenceChips evidence={field.evidence} />}
              </div>
              {editing !== def.key && (
                <div className="flex shrink-0 gap-1">
                  {field.edited && (
                    <button type="button" disabled={busy} onClick={() => onReset(def.key)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded disabled:opacity-40" aria-label={`Use the value read from your documents for ${def.label}`} title="Use the value read from your documents">
                      <RotateCcw className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => setEditing(def.key)} className="p-1.5 text-gray-400 hover:text-blue-700 rounded disabled:opacity-40" aria-label={`Edit ${def.label}`}>
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
            {editing === def.key && (
              <FieldEditor
                def={def}
                field={field}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={async (value) => { if (await onSave(def.key, value)) setEditing(null); }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* The view                                                            */
/* ------------------------------------------------------------------ */

export default function SmartProfile({ onToast, onApply }: Props) {
  const [data, setData] = useState<SmartProfilePayload | null>(null);
  const [list, setList] = useState<SmartMatchList | null>(null);
  const [view, setView] = useState<'matches' | 'profile'>('matches');
  const [showIneligible, setShowIneligible] = useState(false);
  const [band, setBand] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const loadMatches = useCallback(async () => {
    const next = await api.profile.matches({ includeIneligible: showIneligible, limit: 150 });
    setList(next);
    setRefreshedAt(new Date());
  }, [showIneligible]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.profile.get(), api.profile.matches({ includeIneligible: showIneligible, limit: 150 })])
      .then(([p, m]) => {
        if (!alive) return;
        setData(p);
        setList(m);
        setRefreshedAt(new Date());
        setLoadError(null);
      })
      .catch((err) => alive && setLoadError(errorText(err)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [showIneligible]);

  // New grants from the harvester appear without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy) loadMatches().catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadMatches, busy]);

  /** Runs a profile change, then reloads the matches it rescored. */
  const change = async (fn: () => Promise<SmartProfilePayload>, success: (p: SmartProfilePayload) => string) => {
    setBusy(true);
    try {
      const p = await fn();
      setData(p);
      await loadMatches();
      onToast(success(p), 'success');
      return true;
    } catch (err) {
      onToast(errorText(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rescored = (p: SmartProfilePayload) => (p.rescored ? ` · ${p.rescored} matches rescored` : '');
  const upload = (file: File, kind: DocumentKind) => {
    if (!/\.(pdf|docx)$/i.test(file.name)) return onToast('Only PDF and DOCX files are supported.', 'error');
    if (file.size > 10 * 1024 * 1024) return onToast('Files can be at most 10 MB.', 'error');
    void change(() => api.profile.upload(file, kind), (p) => `Read ${file.name}${rescored(p)}`);
  };
  const remove = (id: string, name: string) => {
    if (!window.confirm(`Remove ${name}? Values read only from it will be removed from your profile.`)) return;
    void change(() => api.profile.deleteDocument(id), (p) => `Removed ${name}${rescored(p)}`);
  };
  const save = (key: ProfileFieldKey, value: unknown) =>
    change(() => api.profile.edit({ fields: { [key]: value } }), (p) => `Profile updated${rescored(p)}`);
  const reset = (key: ProfileFieldKey) =>
    void change(() => api.profile.edit({ reset: [key] }), (p) => `Restored the value from your documents${rescored(p)}`);
  const rescore = async () => {
    setBusy(true);
    try {
      const r = await api.profile.rescore();
      await loadMatches();
      onToast(`${r.rescored} matches rescored`, 'success');
    } catch (err) {
      onToast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(
    () => (list?.matches ?? []).filter((m) => band === 'all' || bandFor(m.match.matchScore) === band),
    [list, band],
  );
  const bandCounts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const m of list?.matches ?? []) c[bandFor(m.match.matchScore)]++;
    return c;
  }, [list]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-gray-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Loading your profile and matches…
      </div>
    );
  }
  if (loadError || !data) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-5 text-sm">
        Could not load your profile: {loadError}
      </div>
    );
  }

  const needsOnboarding = data.documents.length === 0;

  return (
    <div id="subview-smart" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Smart Profile &amp; Matches</h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Ranked by fit. Every score shows the evidence it is built on.</p>
        </div>
        <button
          type="button"
          onClick={rescore}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg px-3 py-2 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" /> Rescore now
        </button>
      </div>

      {needsOnboarding && (
        <div className="bg-blue-600 text-white rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <Target className="w-8 h-8 shrink-0 opacity-90" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-bold text-sm">Start with your CV</p>
            <p className="text-xs text-blue-100 mt-0.5">
              Upload a CV, publications list, past proposal, organisation profile or annual report. GrantSeeker reads your track record,
              themes and capacity from it, so matches rest on evidence rather than guesses.
            </p>
          </div>
          <button type="button" onClick={() => fileInput.current?.click()} className="shrink-0 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-blue-700 bg-white hover:bg-blue-50 rounded-lg px-4 py-2">
            <Upload className="w-3.5 h-3.5" aria-hidden="true" /> Upload a document
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4 min-w-0 order-2 lg:order-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Matches or profile" className="inline-flex bg-gray-100 rounded-lg p-1">
              {(['matches', 'profile'] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  type="button"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-md transition-colors ${view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                >
                  {v === 'matches' ? `Matches${list ? ` (${list.counts.eligible + list.counts.check})` : ''}` : 'Extracted profile'}
                </button>
              ))}
            </div>
            {view === 'matches' && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="band-filter">Score band</label>
                <select id="band-filter" value={band} onChange={(e) => setBand(e.target.value as typeof band)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                  <option value="all">All scores</option>
                  <option value="high">High ≥80 ({bandCounts.high})</option>
                  <option value="medium">Medium 60–79 ({bandCounts.medium})</option>
                  <option value="low">Low &lt;60 ({bandCounts.low})</option>
                </select>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={showIneligible} onChange={(e) => setShowIneligible(e.target.checked)} />
                  Show ineligible ({list?.counts.ineligible ?? 0})
                </label>
              </div>
            )}
          </div>

          {view === 'matches' ? (
            <div className="space-y-3">
              {list && (
                <p className="text-[11px] text-gray-500">
                  {list.counts.eligible} eligible · {list.counts.check} to check · {list.counts.ineligible} ineligible
                  {refreshedAt && ` · updated ${refreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                </p>
              )}
              {shown.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
                  No matches in this view. {!showIneligible && (list?.counts.ineligible ?? 0) > 0 && 'Turn on “Show ineligible” to see calls you do not qualify for, and why.'}
                </div>
              ) : (
                shown.map((m) => <React.Fragment key={m.grant.id}><MatchCard item={m} onApply={onApply} /></React.Fragment>)
              )}
            </div>
          ) : (
            <>
              <p className="text-[11px] text-gray-500">
                Read from your sign-up form and documents. Correct anything that is wrong: your edits are kept when documents are re-read, and every
                change rescores your matches.
              </p>
              <ProfileFields profile={data.profile} busy={busy} onSave={save} onReset={reset} />
            </>
          )}
        </div>

        <aside className="space-y-4 order-1 lg:order-2" aria-label="Profile status">
          <CompletenessMeter data={data.completeness} onUploadClick={() => fileInput.current?.click()} />
          <DocumentsPanel documents={data.documents} busy={busy} onUpload={upload} onDelete={remove} inputRef={fileInput} />
        </aside>
      </div>
    </div>
  );
}
