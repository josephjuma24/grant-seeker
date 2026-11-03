import { createHash } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import {
  DOCUMENT_KINDS,
  type DocumentKind,
  type Evidence,
  type Field,
  type ProfileFieldKey,
  type StructuredProfile,
} from '../../shared/profile.ts';
import { withUserTx } from '../db/index.ts';
import { applicantProfiles, funders, grants, profileDocuments } from '../db/schema.ts';
import { DocumentError, extractDocumentText, MAX_UPLOAD_BYTES } from '../lib/documentText.ts';
import { badRequest, conflict, notFound } from '../lib/httpError.ts';
import { grantRowColumns } from '../lib/grantQueries.ts';
import { rankedMatches, scoreUserMatches } from '../lib/matchService.ts';
import { profilePayload, refreshProfile, saveProfile } from '../lib/profileService.ts';
import { toGrantDto, toMatchDto } from '../lib/serializers.ts';
import { recordAudit } from '../middleware/auditLogger.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requireRole } from '../middleware/rbac.ts';
import { handle, zUuid } from '../middleware/validation.ts';

// Smart profile: documents in, structured profile out, and the ranked
// matches built on it. Every route works on the caller's own profile; RLS
// limits profile_documents and applicant_profiles to the owner as well.

export const profileRouter = Router();
profileRouter.use(requireAuth, requireRole('researcher'));

const me = (req: Request) => req.user!.id;
const identity = (req: Request) => req.identity!;

/** Documents a user may keep at once. */
const MAX_DOCUMENTS = 20;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
});

/** multer's own errors (too large, too many files) as API errors. */
function receiveFile(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(
        err.code === 'LIMIT_FILE_SIZE'
          ? badRequest('file_too_large', 'Files can be at most 10 MB.')
          : badRequest('invalid_upload', 'Upload one PDF or DOCX file in the "file" field.'),
      );
    }
    next(err);
  });
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

profileRouter.get(
  '/',
  handle({}, async (req, res) => {
    res.json(await withUserTx(identity(req), (tx) => profilePayload(tx, me(req))));
  }),
);

const DOC_KINDS = DOCUMENT_KINDS.map((k) => k.id) as [DocumentKind, ...DocumentKind[]];

profileRouter.post(
  '/documents',
  receiveFile,
  handle({ body: z.object({ kind: z.enum(DOC_KINDS).default('other') }) }, async (req, res, { body }) => {
    const file = req.file;
    if (!file) throw badRequest('missing_file', 'Choose a PDF or DOCX file to upload.');
    // Browsers send Latin-1 bytes for UTF-8 names.
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/\0]/g, '_').slice(0, 200);

    let extracted;
    try {
      extracted = await extractDocumentText(file.buffer, filename);
    } catch (err) {
      if (err instanceof DocumentError) throw badRequest('unreadable_document', err.message);
      throw err;
    }
    const sha = createHash('sha256').update(file.buffer).digest();

    const result = await withUserTx(identity(req), async (tx) => {
      const existing = await tx.select({ id: profileDocuments.id, sha: profileDocuments.sha256 }).from(profileDocuments).where(eq(profileDocuments.userId, me(req)));
      if (existing.some((d) => d.sha.equals(sha))) throw conflict('duplicate_document', 'You have already uploaded this file.');
      if (existing.length >= MAX_DOCUMENTS) throw badRequest('too_many_documents', `You can keep up to ${MAX_DOCUMENTS} documents. Remove one first.`);

      const [doc] = await tx
        .insert(profileDocuments)
        .values({
          userId: me(req),
          kind: body.kind,
          filename,
          mimeType: extracted.mimeType,
          sizeBytes: file.size,
          sha256: sha,
          pages: extracted.pages,
          text: extracted.text,
        })
        .returning({ id: profileDocuments.id });
      const { rescored } = await refreshProfile(tx, me(req));
      await recordAudit(tx, req, {
        action: 'profile.document_upload',
        entity: 'profile_document',
        entityId: doc!.id,
        diff: { kind: body.kind, sizeBytes: file.size, pages: extracted.pages, rescored },
      });
      return { documentId: doc!.id, rescored, ...(await profilePayload(tx, me(req))) };
    });
    res.status(201).json(result);
  }),
);

profileRouter.delete(
  '/documents/:id',
  handle({ params: z.object({ id: zUuid }) }, async (req, res, { params }) => {
    const result = await withUserTx(identity(req), async (tx) => {
      const removed = await tx
        .delete(profileDocuments)
        .where(and(eq(profileDocuments.id, params.id), eq(profileDocuments.userId, me(req))))
        .returning({ id: profileDocuments.id });
      if (removed.length === 0) throw notFound('Document not found');
      // Values that came only from this document disappear with it.
      const { rescored } = await refreshProfile(tx, me(req));
      await recordAudit(tx, req, { action: 'profile.document_delete', entity: 'profile_document', entityId: params.id, diff: { rescored } });
      return { rescored, ...(await profilePayload(tx, me(req))) };
    });
    res.json(result);
  }),
);

/* Edits ------------------------------------------------------------- */

const str = z.string().trim().min(1).max(200);
const strs = z.array(str).max(40);
const year = z.number().int().min(1950).max(2100).nullable();

const FieldValues = {
  applicantType: z.enum(['individual', 'organisation']).nullable(),
  country: str.nullable(),
  region: str.nullable(),
  careerStage: z.enum(['student', 'early', 'mid', 'senior']).nullable(),
  qualifications: strs,
  institution: str.nullable(),
  themes: strs,
  keywords: strs,
  pastGrants: z
    .array(z.object({ funder: str, amount: z.number().positive().max(1e12).nullable(), currency: z.string().trim().length(3).toUpperCase().default('USD'), year }))
    .max(60),
  publications: z.array(z.object({ title: z.string().trim().min(1).max(400), year })).max(200),
  partnerships: strs,
  registration: z.object({ registered: z.boolean(), detail: z.string().trim().max(400).default('') }).nullable(),
  annualBudget: z.object({ amount: z.number().positive().max(1e13), currency: z.string().trim().length(3).toUpperCase().default('USD') }).nullable(),
  teamSize: z.number().int().min(0).max(1_000_000).nullable(),
} satisfies Record<ProfileFieldKey, z.ZodType>;

const EditBody = z
  .object({
    fields: z.object(FieldValues).partial().default({}),
    /** Fields to give back to extraction, dropping the user's edit. */
    reset: z.array(z.enum(Object.keys(FieldValues) as [ProfileFieldKey, ...ProfileFieldKey[]])).max(14).default([]),
  })
  .refine((b) => Object.keys(b.fields).length > 0 || b.reset.length > 0, 'Change or reset at least one field');

const EDITED = 'Edited by you';
const editEvidence = (quote: string): Evidence => ({ source: EDITED, docId: null, quote: quote.slice(0, 200) });

function summary(value: unknown): string {
  if (value === null) return 'Cleared';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return Object.values(value as object).filter((v) => v !== '' && v !== null).join(', ');
  return String(value);
}

/** An edited field. List items the user kept keep their document evidence. */
function editedField(key: ProfileFieldKey, value: unknown, before: Field<unknown>): Field<unknown> {
  const evidence = [editEvidence(summary(value))];
  if (key === 'pastGrants' || key === 'publications') {
    const old = (before.value as { evidence: Evidence }[]) ?? [];
    const same = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      key === 'pastGrants' ? a.funder === b.funder && a.year === b.year && a.amount === b.amount : a.title === b.title;
    const items = (value as Record<string, unknown>[]).map((item) => ({
      ...item,
      evidence: old.find((o) => same(o as unknown as Record<string, unknown>, item))?.evidence ?? editEvidence(String(item.funder ?? item.title)),
    }));
    return { value: items, evidence, edited: true };
  }
  return { value, evidence, edited: true };
}

profileRouter.put(
  '/',
  handle({ body: EditBody }, async (req, res, { body }) => {
    const result = await withUserTx(identity(req), async (tx) => {
      const current = (await profilePayload(tx, me(req))).profile;
      const next = { ...current } as Record<ProfileFieldKey, Field<unknown>>;
      for (const [k, v] of Object.entries(body.fields) as [ProfileFieldKey, unknown][]) {
        if (v !== undefined) next[k] = editedField(k, v, current[k] as Field<unknown>);
      }
      for (const k of body.reset) next[k] = { ...next[k], edited: false };
      const profile = next as unknown as StructuredProfile;

      const documents = await tx.$count(profileDocuments, eq(profileDocuments.userId, me(req)));
      await saveProfile(tx, me(req), profile, documents);
      // Reset fields are read from the documents again; the edits stay.
      const { rescored } = body.reset.length
        ? await refreshProfile(tx, me(req), { applicantType: profile.applicantType.value })
        : { rescored: (await scoreUserMatches(tx, me(req), { profile })).length };
      await recordAudit(tx, req, {
        action: 'profile.edit',
        entity: 'applicant_profile',
        entityId: me(req),
        diff: { fields: Object.keys(body.fields), reset: body.reset, rescored },
      });
      return { rescored, ...(await profilePayload(tx, me(req))) };
    });
    res.json(result);
  }),
);

profileRouter.post(
  '/rescore',
  handle({}, async (req, res) => {
    const rescored = await withUserTx(identity(req), async (tx) => {
      const [row] = await tx.select({ data: applicantProfiles.data }).from(applicantProfiles).where(eq(applicantProfiles.userId, me(req)));
      const n = row ? (await scoreUserMatches(tx, me(req), { profile: row.data })).length : (await refreshProfile(tx, me(req))).rescored;
      await recordAudit(tx, req, { action: 'profile.rescore', entity: 'applicant_profile', entityId: me(req), diff: { rescored: n } });
      return n;
    });
    res.json({ rescored });
  }),
);

/* ------------------------------------------------------------------ */
/* Ranked matches                                                      */
/* ------------------------------------------------------------------ */

profileRouter.get(
  '/matches',
  handle(
    {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        minScore: z.coerce.number().int().min(0).max(100).default(0),
        include: z.enum(['ineligible']).optional(),
      }),
    },
    async (req, res, { query }) => {
      const out = await withUserTx(identity(req), async (tx) => {
        await profilePayload(tx, me(req)); // makes sure a profile exists
        const ranked = await rankedMatches(tx, me(req), { limit: query.limit, minScore: query.minScore, includeIneligible: query.include === 'ineligible' });
        const rows = ranked.length
          ? await tx.select(grantRowColumns).from(grants).leftJoin(funders, eq(funders.id, grants.funderId)).where(inArray(grants.id, ranked.map((r) => r.grantId)))
          : [];
        const byId = new Map(rows.map((g) => [g.id, g]));
        const [counts] = await tx.execute<{ eligible: number; check: number; ineligible: number }>(
          // One pass over the caller's matches on open grants (RLS keeps it to theirs).
          sql`
            select count(*) filter (where m.eligibility = 'eligible')::int as eligible,
                   count(*) filter (where m.eligibility = 'check')::int as check,
                   count(*) filter (where m.eligibility = 'ineligible')::int as ineligible
            from grant_matches m join grants g on g.id = m.grant_id
            where m.user_id = ${me(req)} and g.status = 'active'`,
        ).then((r) => r.rows);
        return {
          matches: ranked.map((r) => ({ ...toMatchDto(r.match), grant: toGrantDto(byId.get(r.grantId)!) })),
          counts: counts ?? { eligible: 0, check: 0, ineligible: 0 },
        };
      });
      res.json(out);
    },
  ),
);
