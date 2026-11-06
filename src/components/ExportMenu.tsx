import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileText, Loader2, Printer } from 'lucide-react';

import { api } from '../api';
import { exportGrant, type ExportFormat } from '../exportGrant';
import type { ApplicationContext, Grant, GrantMatch } from '../types';

// Export the call and the AI work on it (match assessment, assistant drafts,
// checklist) to Word or PDF. Sits in the grant footers next to Draft with AI.

interface Props {
  grant: Grant;
  match: GrantMatch | null;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function ExportMenu({ grant, match, onToast }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (format: ExportFormat) => {
    setBusy(format);
    setOpen(false);
    // The fit analysis and any assistant drafts live with the application.
    let ctx: ApplicationContext | null = null;
    try {
      ctx = await api.applicationContext(grant.id);
    } catch {
      /* export what we have */
    }
    try {
      exportGrant(format, grant, match, ctx);
      onToast?.(format === 'word' ? 'Word document downloaded' : 'Choose "Save as PDF" in the print dialog', 'info');
    } catch {
      onToast?.('Could not export this call', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export this call and the AI work on it"
        className="px-3 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5 disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        Export
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full mb-1.5 right-0 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20"
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => run('word')}
            className="w-full px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-blue-50 flex items-center gap-2 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-blue-600" />
            Word document (.doc)
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => run('pdf')}
            className="w-full px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-rose-50 flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-rose-600" />
            PDF
          </button>
        </div>
      )}
    </div>
  );
}
