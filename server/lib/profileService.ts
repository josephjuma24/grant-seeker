import { asc, eq, sql } from 'drizzle-orm';

import { profileCompleteness, type ApplicantType, type StructuredProfile } from '../../shared/profile.ts';
import type { Tx } from '../db/index.ts';
import { applicantProfiles, organizations, profileDocuments, users } from '../db/schema.ts';
import { notFound } from './httpError.ts';
import { formInputsOf, scoreUserMatches } from './matchService.ts';
import { extractProfile } from './profileExtraction.ts';

// Keeps applicant_profiles in step with the sign-up form and the uploaded
// documents, and the matches in step with the profile.

export async function documentList(tx: Tx, userId: string) {
  return tx
    .select({
      id: profileDocuments.id,
      kind: profileDocuments.kind,
      filename: profileDocuments.filename,
      mimeType: profileDocuments.mimeType,
      sizeBytes: profileDocuments.sizeBytes,
      pages: profileDocuments.pages,
      characters: sql<number>`length(${profileDocuments.text})`.mapWith(Number),
      createdAt: profileDocuments.createdAt,
    })
    .from(profileDocuments)
    .where(eq(profileDocuments.userId, userId))
    .orderBy(asc(profileDocuments.createdAt));
}

/** Saves the profile with its completeness and, when the matching inputs changed, drops the stale embedding. */
export async function saveProfile(tx: Tx, userId: string, data: StructuredProfile, documentCount: number, opts: { extracted?: boolean } = {}) {
  const completeness = profileCompleteness(data, documentCount).percent;
  const values = {
    applicantType: data.applicantType.value,
    data,
    completeness,
    ...(opts.extracted ? { extractedAt: new Date() } : {}),
  };
  await tx
    .insert(applicantProfiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: applicantProfiles.userId, set: values });
  // The embedding is rebuilt from the new profile on the next harvest.
  await tx.update(users).set({ profileEmbedding: null }).where(eq(users.id, userId));
}

/**
 * Reads the profile again from the form and every document, keeping the
 * user's edits, saves it, and (unless told not to) rescores all matches.
 */
export async function refreshProfile(
  tx: Tx,
  userId: string,
  opts: { applicantType?: ApplicantType | null; rescore?: boolean } = {},
): Promise<{ profile: StructuredProfile; rescored: number }> {
  const [u] = await tx
    .select({
      persona: users.persona,
      region: users.region,
      researchInterests: users.researchInterests,
      qualifications: users.qualifications,
      pastProjects: users.pastProjects,
      pastPublications: users.pastPublications,
      projectDescriptions: users.projectDescriptions,
      organization: organizations.name,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.orgId))
    .where(eq(users.id, userId));
  if (!u) throw notFound('User not found');

  const [stored] = await tx
    .select({ data: applicantProfiles.data, applicantType: applicantProfiles.applicantType })
    .from(applicantProfiles)
    .where(eq(applicantProfiles.userId, userId));
  const docs = await tx
    .select({ id: profileDocuments.id, filename: profileDocuments.filename, kind: profileDocuments.kind, text: profileDocuments.text })
    .from(profileDocuments)
    .where(eq(profileDocuments.userId, userId))
    .orderBy(asc(profileDocuments.createdAt));

  const applicantType = opts.applicantType !== undefined ? opts.applicantType : (stored?.applicantType ?? null);
  const profile = extractProfile(formInputsOf(u, u.organization, applicantType), docs, stored?.data);
  await saveProfile(tx, userId, profile, docs.length, { extracted: true });
  const rescored = opts.rescore === false ? 0 : (await scoreUserMatches(tx, userId, { profile })).length;
  return { profile, rescored };
}

/** What the profile page shows: the profile, its completeness and the documents. */
export async function profilePayload(tx: Tx, userId: string) {
  let [row] = await tx.select().from(applicantProfiles).where(eq(applicantProfiles.userId, userId));
  if (!row) {
    await refreshProfile(tx, userId, { rescore: false });
    [row] = await tx.select().from(applicantProfiles).where(eq(applicantProfiles.userId, userId));
  }
  const documents = await documentList(tx, userId);
  return {
    profile: row!.data,
    completeness: profileCompleteness(row!.data, documents.length),
    documents,
    extractedAt: row!.extractedAt,
    updatedAt: row!.updatedAt,
  };
}
