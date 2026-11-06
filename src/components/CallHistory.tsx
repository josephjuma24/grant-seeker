import React, { useEffect, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronRight, ExternalLink, History, Loader2, Sparkles } from 'lucide-react';

import { api } from '../api';
import type { CallComparison, CallEdition, CallFieldChange, CallHistory as History_ } from '../types';

// The historical trail of a recurring call: every edition we have seen
// (later cycles, earlier cycles, earlier versions of the same page), oldest
// first, with what changed between each edition and the next. Helps anyone
// pursuing the call see how the funder's specification has moved.

interface Props {
  grantId: string;
  /** Opens another edition that is in the catalogue. */
  onOpenGrant?: (grantId: string) => void;
  compact?: boolean;
}

const LIFECYCLE_PILL: Record<CallEdition['lifecycle'], { label: string; className: string }> = {
  active: { label: 'Open', className: 'bg-green-50 text-green-700 border-green-200' },
  expired: { label: 'Expired', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  archived: { label: 'Archived', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  superseded: { label: 'Earlier version', className: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const DOT: Record<CallEdition['lifecycle'], string> = {
  active: 'bg-green-500',
  expired: 'bg-rose-400',
  archived: 'bg-gray-400',
  superseded: 'bg-amber-400',
};

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'No fixed deadline';

const fmtAmount = (amount: number | null, currency: string) =>
  amount ? `${currency} ${Math.round(amount).toLocaleString('en-US')}` : 'Amount not stated';

export function CallHistory({ grantId, onOpenGrant, compact = false }: Props) {
  const [history, setHistory] = useState<History_ | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setError(false);
    api
      .grantHistory(grantId)
      .then((h) => !cancelled && setHistory(h))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [grantId]);

  if (error) return null;
  if (!history) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 font-semibold">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading call history…
      </div>
    );
  }

  const { editions, comparisons } = history;
  const currentIndex = editions.findIndex((e) => e.isCurrent);
  const later = editions.slice(currentIndex + 1).filter((e) => e.kind === 'listing');
  const earlier = editions.slice(0, currentIndex);

  if (editions.length <= 1) {
    return (
      <section id="call-history" className="space-y-2">
        <Header count={1} />
        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3">
          This is the first edition of this call in GrantSeeker. If the funder publishes it again, the new edition is
          linked here with a summary of what changed.
        </p>
      </section>
    );
  }

  const newest = later[later.length - 1];
  const summary = newest
    ? `Repeated: a later edition ${newest.lifecycle === 'active' ? 'is open now' : 'was published'} (deadline ${fmtDate(newest.deadline)}).`
    : earlier.length
      ? `Run ${earlier.length} time${earlier.length === 1 ? '' : 's'} before this edition. Compare what changed before you apply.`
      : 'Earlier versions of this call are listed below.';

  const comparisonInto = new Map<string, CallComparison>(comparisons.map((c): [string, CallComparison] => [c.to, c]));

  return (
    <section id="call-history" className="space-y-3">
      <Header count={editions.length} />
      <p className="text-xs text-gray-600 font-semibold">{summary}</p>

      <ol className="relative">
        {editions.map((e, i) => {
          const cmp = comparisonInto.get(e.key);
          return (
            <li key={e.key} className="relative pl-6">
              {/* spine */}
              {i < editions.length - 1 && <span className="absolute left-[7px] top-4 bottom-0 w-px bg-gray-200" aria-hidden />}
              {cmp && <ChangeBlock comparison={cmp} compact={compact} />}
              <div className="relative">
                <span
                  className={`absolute -left-[21px] top-[18px] w-[9px] h-[9px] rounded-full ring-2 ring-white ${DOT[e.lifecycle]}`}
                  aria-hidden
                />
                <EditionCard edition={e} onOpenGrant={onOpenGrant} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Header({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2">
      <History className="w-4 h-4 text-indigo-600" />
      <h4 className="font-extrabold text-xs text-gray-900 uppercase tracking-wider">Call History</h4>
      <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
        {count} edition{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function EditionCard({ edition: e, onOpenGrant }: { edition: CallEdition; onOpenGrant?: (id: string) => void }) {
  const pill = LIFECYCLE_PILL[e.lifecycle];
  return (
    <div
      className={`my-2 p-3 rounded-lg border text-xs ${
        e.isCurrent ? 'border-indigo-300 bg-indigo-50/40 shadow-sm' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-extrabold text-gray-900">{fmtDate(e.deadline)}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${pill.className}`}>
              {pill.label}
            </span>
            {e.isCurrent && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-600 text-white">
                Viewing
              </span>
            )}
            {e.referenceCodes.map((c) => (
              <span key={c} className="font-mono text-[10px] text-gray-600 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">
                {c}
              </span>
            ))}
          </div>
          <p className="text-gray-600 mt-1 truncate" title={e.title}>
            {e.title}
          </p>
          <p className="text-gray-400 mt-0.5 font-semibold">
            {fmtAmount(e.amount, e.currency)}
            {e.kind === 'revision' && e.seenAt && <> · replaced on the funder&rsquo;s page on {fmtDate(e.seenAt)}</>}
            {e.duplicateIds.length > 0 && <> · also listed {e.duplicateIds.length} more time{e.duplicateIds.length === 1 ? '' : 's'}</>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {e.kind === 'listing' && !e.isCurrent && onOpenGrant && (
            <button
              onClick={() => onOpenGrant(e.grantId)}
              className="px-2 py-1 text-[10px] font-bold text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 rounded cursor-pointer"
            >
              Open
            </button>
          )}
          {e.url && (
            <a
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 text-gray-400 hover:text-gray-700"
              title="Funder page"
              aria-label="Funder page"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ChangeBlock({ comparison, compact }: { comparison: CallComparison; compact: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 ml-1 p-3 rounded-lg bg-gradient-to-br from-indigo-50/60 to-white border border-indigo-100 text-xs">
      <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-700 uppercase tracking-wider">
        <ArrowDown className="w-3 h-3" />
        What changed
      </div>
      <ul className="mt-1.5 space-y-1">
        {comparison.highlights.map((h) => (
          <li key={h} className="flex gap-1.5 text-gray-700">
            <Sparkles className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
            <span>{h}</span>
          </li>
        ))}
      </ul>
      {comparison.changes.length > 0 && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-2 flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
            aria-expanded={open}
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Field-by-field comparison ({comparison.changes.length})
          </button>
          {open && (
            <div className="mt-2 space-y-2">
              {comparison.changes.map((c) => (
                <FieldChangeRow key={c.field} change={c} compact={compact} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Chips({ items, tone }: { items: string[]; tone: 'add' | 'remove' }) {
  if (items.length === 0) return null;
  const cls =
    tone === 'add' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-rose-50 text-rose-700 border-rose-200 line-through';
  return (
    <span className="inline-flex flex-wrap gap-1">
      {items.map((x) => (
        <span key={x} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cls}`}>
          {tone === 'add' ? '+ ' : ''}
          {x}
        </span>
      ))}
    </span>
  );
}

// key is listed because the project has no React typings to supply it.
function FieldChangeRow({ change: c, compact }: { change: CallFieldChange; compact: boolean; key?: string }) {
  const [showText, setShowText] = useState(false);
  return (
    <div className="bg-white border border-gray-100 rounded-md p-2">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{c.label}</div>
      {c.kind === 'value' && (
        <div className="mt-1 text-gray-700">
          <span className="text-rose-600 line-through">{c.before ?? '—'}</span>
          <span className="mx-1.5 text-gray-400">→</span>
          <span className="text-green-700 font-semibold">{c.after ?? '—'}</span>
        </div>
      )}
      {c.kind === 'list' && (
        <div className="mt-1 flex flex-wrap gap-1">
          <Chips items={c.added} tone="add" />
          <Chips items={c.removed} tone="remove" />
        </div>
      )}
      {c.kind === 'text' && (
        <div className="mt-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-28 bg-gray-100 rounded-full overflow-hidden" aria-hidden>
              <div className="h-full bg-indigo-500" style={{ width: `${c.similarity}%` }} />
            </div>
            <span className="text-[10px] font-bold text-gray-500">{c.similarity}% similar</span>
          </div>
          {(c.addedTerms.length > 0 || c.removedTerms.length > 0) && (
            <div className="flex flex-wrap gap-1">
              <Chips items={c.addedTerms} tone="add" />
              <Chips items={c.removedTerms} tone="remove" />
            </div>
          )}
          <button
            onClick={() => setShowText((s) => !s)}
            className="text-[10px] font-bold text-gray-500 hover:text-gray-800 cursor-pointer"
          >
            {showText ? 'Hide wording' : 'Compare wording'}
          </button>
          {showText && (
            <div className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
              <div className="p-2 bg-rose-50/40 border border-rose-100 rounded text-[11px] text-gray-600 whitespace-pre-line max-h-48 overflow-y-auto">
                <div className="text-[9px] font-bold text-rose-600 uppercase mb-1">Before</div>
                {c.before || '—'}
              </div>
              <div className="p-2 bg-green-50/40 border border-green-100 rounded text-[11px] text-gray-600 whitespace-pre-line max-h-48 overflow-y-auto">
                <div className="text-[9px] font-bold text-green-700 uppercase mb-1">After</div>
                {c.after || '—'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
