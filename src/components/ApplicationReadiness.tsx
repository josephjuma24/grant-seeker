import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, CheckCircle2, ClipboardCheck, ExternalLink, FileText, Loader2, Rocket, ShieldCheck, Users } from 'lucide-react';

import { api, ApiError } from '../api';
import type { ApplicationBody, ApplicationContext, AssistantMode, ChecklistItem } from '../types';
import { EligibilityPill, GateRow, ScoreBadge } from './SmartProfile';

// The top of the AI Proposal Assistant when you apply from a match: your
// fit for the call (gates, gaps, evidence), the in-app application with a
// checklist of gaps to close, and the next assistant steps. The funder's
// own page is an optional link, never the way in.

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

interface Props {
  grantId: string;
  /** Bumped by the assistant after a run, so saved drafts show up. */
  refreshKey: number;
  onToast: Toast;
  onRunMode: (mode: AssistantMode) => void;
  /** Tells the assistant which application to save runs into. */
  onContext: (ctx: ApplicationContext | null) => void;
}

const STEPS: { mode: AssistantMode; label: string; hint: string; Icon: typeof ShieldCheck }[] = [
  { mode: 'eligibility', label: 'Eligibility review', hint: 'Go / no-go, requirement by requirement', Icon: ShieldCheck },
  { mode: 'outline', label: 'Draft the outline', hint: 'Aims, methods, budget, gaps answered', Icon: FileText },
  { mode: 'collaborators', label: 'Find partners', hint: 'Who closes your gaps', Icon: Users },
  { mode: 'feedback', label: 'Compliance check', hint: 'Review your draft before submitting', Icon: ClipboardCheck },
];

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export default function ApplicationReadiness({ grantId, refreshKey, onToast, onRunMode, onContext }: Props) {
  const [ctx, setCtx] = useState<ApplicationContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.applicationContext(grantId);
      setCtx(next);
      onContext(next);
      setError(null);
    } catch (err) {
      setError(errorText(err));
      onContext(null);
    } finally {
      setLoading(false);
    }
    // onContext is a stable setter wrapper from the assistant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, refreshKey]);

  if (loading && !ctx) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center gap-2 text-sm text-gray-600" aria-busy="true">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Checking your fit for this call…
      </div>
    );
  }
  if (error || !ctx) {
    return <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm">Could not load this call: {error}</div>;
  }

  const { grant, fit, proposal } = ctx;
  const body: ApplicationBody = proposal?.body ?? {};
  const checklist: ChecklistItem[] = body.checklist ?? (fit?.gaps ?? []).map((text) => ({ text, done: false }));
  const done = checklist.filter((c) => c.done).length;
  const drafts = body.drafts ?? {};

  const start = async () => {
    setBusy(true);
    try {
      const initial: ApplicationBody = {
        origin: 'smart_match',
        ...(fit ? { fitAtStart: { score: fit.score, eligibility: fit.eligibility, version: fit.version, at: new Date().toISOString() } } : {}),
        checklist,
        drafts: {},
      };
      await api.startApplication(
        grant.id,
        initial as Record<string, unknown>,
        fit ? `Started from Smart Matches (fit ${fit.score}/100, ${fit.eligibility}).` : 'Started in the AI Proposal Assistant.',
      );
      onToast('Application started. It is saved in My Saved Applications.', 'success');
    } catch (err) {
      // Already tracking this grant: just pick that application up.
      if (!(err instanceof ApiError && err.code === 'already_tracking')) onToast(errorText(err), 'error');
    } finally {
      await load();
      setBusy(false);
    }
  };

  const toggle = async (i: number) => {
    if (!proposal) return;
    const next = checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c));
    setCtx({ ...ctx, proposal: { ...proposal, body: { ...body, checklist: next } } });
    try {
      await api.updateApplicationBody(proposal.id, { ...body, checklist: next } as Record<string, unknown>);
    } catch (err) {
      onToast(errorText(err), 'error');
      void load();
    }
  };

  const ineligible = fit?.eligibility === 'ineligible';

  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm" aria-labelledby="readiness-title">
      {/* Call and fit */}
      <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-start gap-4 border-b border-gray-100">
        <div className="flex gap-4 min-w-0 flex-1">
          {fit && <ScoreBadge score={fit.score} />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {fit && <EligibilityPill value={fit.eligibility} />}
              <span className="text-[11px] font-semibold text-gray-500">{grant.funderName}</span>
            </div>
            <h2 id="readiness-title" className="mt-1 text-base font-bold text-gray-900 leading-snug">{grant.title}</h2>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" aria-hidden="true" />{grant.deadline || 'Rolling / not stated'}</span>
              {grant.fundingAmount > 0 && <span>{money(grant.fundingAmount)}</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end shrink-0">
          {proposal ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Application started · {proposal.status}
            </span>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 disabled:opacity-60"
              title={ineligible ? 'You can still start, but a hard requirement fails' : undefined}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Rocket className="w-3.5 h-3.5" aria-hidden="true" />}
              Start application
            </button>
          )}
          {grant.url && /^https?:\/\//i.test(grant.url) && (
            <a
              href={grant.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-blue-700 border border-gray-200 hover:border-blue-200 rounded-lg px-3 py-2"
              aria-label="Original call on the funder's site (opens in a new tab)"
            >
              Original call <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      {ineligible && (
        <p role="note" className="mx-5 sm:mx-6 mt-4 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
          A hard eligibility requirement fails for your profile. Run the eligibility review before investing time, or correct your profile if it is wrong.
        </p>
      )}

      {fit ? (
        <div className="p-5 sm:p-6 grid gap-6 lg:grid-cols-2">
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Why you match</p>
            <p className="mt-1 text-xs text-gray-700 leading-relaxed">{fit.explanation}</p>
            <p className="mt-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Eligibility gates</p>
            <ul className="mt-2 space-y-2">
              {fit.gates.map((g) => <React.Fragment key={g.key}><GateRow gate={g} /></React.Fragment>)}
            </ul>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Gaps to close</p>
              {proposal && checklist.length > 0 && <span className="text-[11px] font-semibold text-gray-500">{done}/{checklist.length} done</span>}
            </div>
            {checklist.length === 0 ? (
              <p className="mt-1 text-xs text-emerald-700 font-semibold">No gaps found for this call.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {checklist.map((c, i) => (
                  <li key={i}>
                    <label className={`flex gap-2 text-xs ${proposal ? 'cursor-pointer' : ''} ${c.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                      <input type="checkbox" checked={c.done} disabled={!proposal} onChange={() => toggle(i)} className="mt-0.5 accent-blue-600 shrink-0" />
                      <span>{c.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {!proposal && checklist.length > 0 && <p className="mt-2 text-[11px] text-gray-500">Start the application to tick these off as you go.</p>}
          </div>
        </div>
      ) : (
        <p className="p-5 sm:p-6 text-xs text-gray-600">
          No fit assessment for this call{ctx.hasProfile ? ' (it may be closed)' : ': build your Smart Profile first'}. You can still use the assistant below.
        </p>
      )}

      {/* Next steps */}
      <div className="px-5 sm:px-6 pb-5 sm:pb-6">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Next steps with the assistant</p>
        <ol className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {STEPS.map(({ mode, label, hint, Icon }, i) => (
            <li key={mode}>
              <button
                type="button"
                onClick={() => onRunMode(mode)}
                className="w-full h-full text-left flex gap-2.5 p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <Icon className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  <span className="block text-xs font-bold text-gray-900">{i + 1}. {label}</span>
                  <span className="block text-[11px] text-gray-500">{hint}</span>
                  {drafts[mode] && <span className="mt-1 inline-block text-[10px] font-bold text-emerald-700">Saved draft</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
