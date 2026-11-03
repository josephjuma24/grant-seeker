import type { grantMatches, Proposal, proposalEvents, User } from '../db/schema.ts';
import type { GrantRow } from './grantQueries.ts';

type MatchRow = typeof grantMatches.$inferSelect;
type EventRow = typeof proposalEvents.$inferSelect;

/**
 * The public shape of a user. Allow-listed field by field, so new columns
 * (hashes, lockout counters, embeddings) never leak by default.
 */
export function toUserDto(user: User, organizationName: string | null) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    persona: user.persona,
    accessRole: user.role,
    /** @deprecated The current SPA reads the persona from `role`; use `persona`. */
    role: user.persona,
    organizationId: user.orgId,
    organization: organizationName,
    region: user.region,
    researchInterests: user.researchInterests,
    collaborationInterests: user.collaborationInterests,
    qualifications: user.qualifications,
    fundingNeedsMin: user.fundingNeedsMin,
    pastProjects: user.pastProjects,
    pastPublications: user.pastPublications,
    projectDescriptions: user.projectDescriptions,
    teamMembers: user.teamMembers,
    isPublicProfile: user.isPublicProfile,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt,
  };
}

export type UserDto = ReturnType<typeof toUserDto>;

/* Grants ------------------------------------------------------------ */

// Field names follow the prototype's Grant type (fundingAmount,
// extractedKeywords, funderName) so the existing SPA reads them unchanged.
export function toGrantDto(grant: GrantRow) {
  return {
    id: grant.id,
    legacyId: grant.legacyId,
    title: grant.title,
    subject: grant.subject,
    category: grant.category,
    description: grant.description,
    objectives: grant.objectives,
    requiredOutcomes: grant.requiredOutcomes,
    scope: grant.scope,
    fundingAmount: grant.amount,
    currency: grant.currency,
    deadline: grant.deadline,
    eligibleRegions: grant.eligibleRegions,
    eligibleOrgTypes: grant.eligibleOrgTypes,
    status: grant.status,
    source: grant.source,
    url: grant.url,
    funderId: grant.funderId,
    funderName: grant.funderName,
    extractedKeywords: grant.keywords,
    hasEmbedding: grant.hasEmbedding,
    scrapedAt: grant.scrapedAt,
    updatedAt: grant.updatedAt,
  };
}

/* Matches ----------------------------------------------------------- */

export function toMatchDto(match: MatchRow) {
  return {
    grantId: match.grantId,
    userId: match.userId,
    matchScore: match.score,
    rationale: match.rationale,
    isGemini: match.model?.startsWith('gemini') ?? false,
    model: match.model,
    similarity: match.similarity,
    relevanceBreakdown: match.breakdown,
    // Gates, weighted components and their evidence (shared/profile.ts).
    fit: match.fit,
    eligibility: match.eligibility,
    feedback: match.feedback,
    computedAt: match.computedAt,
  };
}

/* Proposals --------------------------------------------------------- */

export function toProposalDto(
  p: Proposal,
  extra: {
    grantTitle: string | null;
    funderName: string | null;
    ownerName: string | null;
    events?: (EventRow & { actorName: string | null })[];
  },
) {
  return {
    id: p.id,
    ownerId: p.ownerId,
    ownerName: extra.ownerName,
    orgId: p.orgId,
    grantId: p.grantId,
    grantTitle: extra.grantTitle ?? p.title,
    funderName: extra.funderName,
    title: p.title,
    status: p.status,
    amount: p.requestedAmount,
    deadline: p.deadline,
    submittedDate: p.submittedAt ? p.submittedAt.toISOString().slice(0, 10) : null,
    notes: p.notes,
    body: p.body,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    // The prototype's StatusTransition shape.
    history: extra.events?.map((e) => ({
      id: String(e.id),
      status: e.toStatus,
      fromStatus: e.fromStatus,
      timestamp: e.createdAt,
      notes: e.comment,
      actor: e.actorName,
    })),
  };
}
