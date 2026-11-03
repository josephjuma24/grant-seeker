import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

// Turns an uploaded PDF or DOCX into plain text. The type is decided by
// the file's own bytes, not its name or the browser's claim, so a renamed
// executable is refused rather than parsed.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 300_000;

export class DocumentError extends Error {}

export interface ExtractedDocument {
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  pages: number | null;
  text: string;
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';
// DOCX is a ZIP whose first entry is usually [Content_Types].xml; the
// mammoth parse below confirms it is a Word document.
const isZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

function clean(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

export async function extractDocumentText(buf: Buffer, filename: string): Promise<ExtractedDocument> {
  if (buf.length === 0) throw new DocumentError('The file is empty.');
  if (buf.length > MAX_UPLOAD_BYTES) throw new DocumentError('Files can be at most 10 MB.');

  if (isPdf(buf)) {
    let pages: string[];
    let totalPages: number;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      ({ text: pages, totalPages } = await extractText(pdf, { mergePages: false }));
    } catch {
      throw new DocumentError('This PDF could not be read. It may be damaged or password-protected.');
    }
    const text = clean(pages.join('\n\n'));
    if (text.length < 20) {
      throw new DocumentError('No text found in this PDF. It may be a scan; upload a text-based PDF or a DOCX.');
    }
    return { mimeType: 'application/pdf', pages: totalPages, text };
  }

  if (isZip(buf) && /\.docx$/i.test(filename)) {
    let value: string;
    try {
      ({ value } = await mammoth.extractRawText({ buffer: buf }));
    } catch {
      throw new DocumentError('This DOCX could not be read. It may be damaged.');
    }
    const text = clean(value);
    if (text.length < 20) throw new DocumentError('No text found in this document.');
    return { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pages: null, text };
  }

  throw new DocumentError('Only PDF and DOCX files are supported.');
}
