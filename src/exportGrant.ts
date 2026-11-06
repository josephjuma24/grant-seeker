/**
 * Exports a funding call and the AI work done on it (match assessment,
 * fit analysis, AI Proposal Assistant drafts and checklist) to Word or PDF.
 *
 * Both are built in the browser from one HTML report:
 *   - Word: an HTML document with Word's namespaces, saved as .doc, which
 *     Word opens and edits as a normal document;
 *   - PDF:  the same report in a hidden frame, sent to the print dialog,
 *     where "Save as PDF" writes the file.
 */
import type { ApplicationContext, AssistantMode, Grant, GrantMatch } from './types';

export type ExportFormat = 'word' | 'pdf';

const DRAFT_LABELS: Record<AssistantMode, string> = {
  eligibility: 'Eligibility review',
  outline: 'Proposal outline',
  collaborators: 'Partner recommendations',
  feedback: 'Compliance check',
};
const DRAFT_ORDER: AssistantMode[] = ['eligibility', 'outline', 'collaborators', 'feedback'];

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: iso.length === 10 ? 'UTC' : undefined,
      })
    : 'Not stated';

const money = (n: number) => (n > 0 ? `USD ${Math.round(n).toLocaleString('en-US')}` : 'Not stated');

/** Plain text with light Markdown (headings, bullets, numbered items, **bold**) to HTML. */
function textToHtml(text: string): string {
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      close();
      out.push(`<h4>${inline(heading[2]!)}</h4>`);
    } else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((bullet ?? numbered)![1]!)}</li>`);
    } else if (!line.trim()) {
      close();
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join('\n');
}

const section = (title: string, body: string) => (body.trim() ? `<h2>${esc(title)}</h2>\n${body}` : '');
const row = (label: string, value: string) => `<tr><th>${esc(label)}</th><td>${value}</td></tr>`;

export function buildGrantReport(grant: Grant, match: GrantMatch | null, ctx: ApplicationContext | null): string {
  const fit = ctx?.fit ?? match?.fit ?? null;
  const score = fit?.score ?? match?.matchScore ?? null;
  const drafts = ctx?.proposal?.body?.drafts ?? {};
  const checklist = ctx?.proposal?.body?.checklist ?? [];
  const exported = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });

  const facts = [
    row('Funder', esc(grant.funderName)),
    row('Category', esc(grant.category)),
    row('Award amount', esc(money(grant.fundingAmount))),
    row('Deadline', esc(fmtDate(grant.deadline))),
    row('Status', esc(grant.lifecycle === 'active' ? 'Open' : grant.lifecycle === 'expired' ? 'Expired' : 'Archived')),
    row('Eligible regions', esc(grant.eligibleRegions.join(', ') || 'Not stated')),
    row('Eligible organisations', esc(grant.eligibleOrgTypes.join(', ') || 'Not stated')),
    row('Official call', `<a href="${esc(grant.url)}">${esc(grant.url)}</a>`),
  ].join('\n');

  const spec = [
    grant.description && `<h3>Description</h3>\n${textToHtml(grant.description)}`,
    grant.objectives && `<h3>Objectives</h3>\n${textToHtml(grant.objectives)}`,
    grant.requiredOutcomes && `<h3>Required outcomes</h3>\n${textToHtml(grant.requiredOutcomes)}`,
    grant.scope && `<h3>Scope</h3>\n${textToHtml(grant.scope)}`,
  ]
    .filter(Boolean)
    .join('\n');

  let assessment = '';
  if (score != null) {
    const eligibility = fit?.eligibility ?? match?.eligibility;
    assessment += `<p class="score"><strong>Match score: ${score}%</strong>${
      eligibility ? ` &middot; Eligibility: ${esc(eligibility === 'check' ? 'to be checked' : eligibility)}` : ''
    }${match?.isGemini === false ? ' &middot; scored by the local matcher' : ''}</p>`;
    const why = fit?.explanation || match?.rationale;
    if (why) assessment += `<h3>Why it matches</h3>\n${textToHtml(why)}`;
    if (fit?.gates?.length) {
      assessment += `<h3>Eligibility checks</h3>\n<table><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>${fit.gates
        .map((g) => `<tr><td>${esc(g.label)}</td><td>${esc(g.status)}</td><td>${esc(g.detail)}</td></tr>`)
        .join('')}</tbody></table>`;
    }
    if (fit?.components?.length) {
      assessment += `<h3>Score breakdown</h3>\n<table><thead><tr><th>Factor</th><th>Weight</th><th>Score</th><th>Points</th></tr></thead><tbody>${fit.components
        .map(
          (c) =>
            `<tr><td>${esc(c.label)}</td><td>${Math.round(c.weight * 100)}%</td><td>${Math.round(c.score)}</td><td>${Math.round(c.points)}</td></tr>`,
        )
        .join('')}</tbody></table>`;
    } else if (match?.relevanceBreakdown) {
      const b = match.relevanceBreakdown;
      assessment += `<h3>Score breakdown</h3>\n<table><tbody>${[
        row('Interests fit', `${b.subject} / 40`),
        row('Eligibility', `${b.eligibility} / 30`),
        row('Funding target', `${b.amount} / 15`),
        row('Deadline urgency', `${b.urgency} / 15`),
      ].join('')}</tbody></table>`;
    }
    if (fit?.gaps?.length) {
      assessment += `<h3>Gaps to close</h3>\n<ul>${fit.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`;
    }
  }

  const draftHtml = DRAFT_ORDER.map((mode) => {
    const d = drafts[mode];
    if (!d?.text?.trim()) return '';
    return `<h3>${esc(DRAFT_LABELS[mode])}</h3>\n<p class="meta">Generated ${esc(fmtDate(d.generatedAt))}${
      d.simulated ? ' &middot; simulated (no AI model configured)' : ''
    }</p>\n${textToHtml(d.text)}`;
  })
    .filter(Boolean)
    .join('\n');

  const checklistHtml = checklist.length
    ? `<ul class="checklist">${checklist.map((c) => `<li>${c.done ? '&#9745;' : '&#9744;'} ${esc(c.text)}</li>`).join('')}</ul>`
    : '';

  return `
<h1>${esc(grant.title)}</h1>
<p class="meta">Exported from GrantSeeker on ${esc(exported)}${ctx?.proposal ? ` &middot; Application: ${esc(ctx.proposal.title)} (${esc(ctx.proposal.status)})` : ''}</p>
${section('Call at a glance', `<table class="facts"><tbody>${facts}</tbody></table>`)}
${section('Call specification', spec)}
${section('AI match assessment', assessment)}
${section('AI Proposal Assistant work', draftHtml)}
${section('Application checklist', checklistHtml)}
`;
}

const STYLES = `
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1f2937; line-height: 1.45; }
  h1 { font-size: 18pt; color: #111827; margin: 0 0 4pt; }
  h2 { font-size: 13pt; color: #1d4ed8; border-bottom: 1px solid #dbeafe; padding-bottom: 3pt; margin: 18pt 0 6pt; }
  h3 { font-size: 11.5pt; color: #111827; margin: 12pt 0 4pt; }
  h4 { font-size: 11pt; margin: 8pt 0 2pt; }
  p { margin: 0 0 6pt; }
  .meta { color: #6b7280; font-size: 9pt; }
  .score { font-size: 12pt; }
  table { border-collapse: collapse; width: 100%; margin: 4pt 0 8pt; }
  th, td { border: 1px solid #e5e7eb; padding: 4pt 6pt; text-align: left; vertical-align: top; font-size: 10pt; }
  thead th { background: #f3f4f6; }
  table.facts th { width: 32%; background: #f9fafb; }
  ul, ol { margin: 2pt 0 8pt 18pt; padding: 0; }
  ul.checklist { list-style: none; margin-left: 0; }
  a { color: #1d4ed8; }
  @page { margin: 18mm 16mm; }
`;

const fileStem = (title: string) =>
  title
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'grant';

function downloadWord(grant: Grant, body: string) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(grant.title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${STYLES}</style></head><body>${body}</body></html>`;
  // The BOM keeps Word from misreading UTF-8 characters.
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileStem(grant.title)}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function printPdf(grant: Grant, body: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  // The document title becomes the suggested PDF file name.
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(fileStem(grant.title))}</title><style>${STYLES}</style></head><body>${body}</body></html>`);
  doc.close();
  const win = frame.contentWindow!;
  const cleanup = () => setTimeout(() => frame.remove(), 1_000);
  win.addEventListener('afterprint', cleanup);
  setTimeout(() => {
    win.focus();
    win.print();
    // Browsers without afterprint in frames: remove after a while anyway.
    setTimeout(cleanup, 60_000);
  }, 250);
}

export function exportGrant(format: ExportFormat, grant: Grant, match: GrantMatch | null, ctx: ApplicationContext | null) {
  const body = buildGrantReport(grant, match, ctx);
  if (format === 'word') downloadWord(grant, body);
  else printPdf(grant, body);
}
