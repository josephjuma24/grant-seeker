import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { withUserTx, type Tx } from '../db/index.ts';
import {
  budgetCategoryEnum,
  budgetLines,
  budgets,
  funders,
  grants,
  notifications,
  proposalEvents,
  proposals,
  proposalStatusEnum,
  type Proposal,
} from '../db/schema.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/httpError.ts';
import { toProposalDto } from '../lib/serializers.ts';
import { recordAudit } from '../middleware/auditLogger.ts';
import { requireAuth } from '../middleware/auth.ts';
import { hasRole, requireRole } from '../middleware/rbac.ts';
import { handle, zPagination, zUuid } from '../middleware/validation.ts';

export const proposalsRouter = Router();
proposalsRouter.use(requireAuth, requireRole('researcher'));

type Status = (typeof proposalStatusEnum.enumValues)[number];
const zStatus = z.enum(proposalStatusEnum.enumValues);
const ProposalParams = z.object({ id: zUuid });

const me = (req: Request) => req.user!;
const identity = (req: Request) => req.identity!;

/* ------------------------------------------------------------------ */
/* Workflow                                                            */
/* ------------------------------------------------------------------ */

// Who may move a proposal between statuses. "officer" means a grant
// officer (or above) of the proposal's organisation who is not its owner;
// a super admin may do anything.
type Gate = 'owner' | 'officer' | 'either';

const ORG_WORKFLOW: Record<Status, Partial<Record<Status, Gate>>> = {
  draft: { review: 'owner' },
  review: { draft: 'either', approved: 'officer' },
  approved: { submitted: 'officer', draft: 'officer' },
  submitted: { awarded: 'either', rejected: 'either' },
  awarded: {},
  rejected: { draft: 'owner' },
};

// An individual researcher (no organisation) has no research office: they
// track their own application straight through, as in the prototype.
const SOLO_WORKFLOW: Record<Status, Partial<Record<Status, Gate>>> = {
  draft: { submitted: 'owner', review: 'owner' },
  review: { draft: 'owner', submitted: 'owner' },
  approved: { submitted: 'owner' },
  submitted: { awarded: 'owner', rejected: 'owner', draft: 'owner' },
  awarded: {},
  rejected: { draft: 'owner' },
};

const EDITABLE: Status[] = ['draft', 'review'];

function roleOn(req: Request, p: Proposal) {
  const user = me(req);
  const isOwner = p.ownerId === user.id;
  const isSuper = hasRole(user, 'super_admin');
  const isOfficer = isSuper || (p.orgId !== null && p.orgId === user.orgId && hasRole(user, 'grant_officer'));
  return { isOwner, isOfficer, isSuper };
}

function assertTransition(req: Request, p: Proposal, to: Status) {
  const workflow = p.orgId ? ORG_WORKFLOW : SOLO_WORKFLOW;
  const gate = workflow[p.status][to];
  if (!gate) throw conflict('invalid_transition', `Cannot move a ${p.status} proposal to ${to}`);

  const { isOwner, isOfficer, isSuper } = roleOn(req, p);
  if (isSuper) return;
  // Separation of duties: nobody approves or submits their own proposal
  // on the organisation's behalf.
  const officerOk = isOfficer && !isOwner;
  const allowed = gate === 'owner' ? isOwner : gate === 'officer' ? officerOk : isOwner || officerOk;
  if (!allowed) {
    throw forbidden(
      'transition_forbidden',
      gate === 'officer' ? `Moving to ${to} needs a grant officer other than the owner` : `Only the owner can move this to ${to}`,
    );
  }
}

function assertCanEdit(req: Request, p: Proposal) {
  const { isOwner, isOfficer } = roleOn(req, p);
  if (!isOwner && !isOfficer) throw forbidden('not_editor', 'Only the owner or a grant officer can edit this proposal');
  if (!EDITABLE.includes(p.status) && !(p.orgId === null && isOwner)) {
    throw conflict('proposal_locked', `A ${p.status} proposal can no longer be edited`);
  }
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

const proposalColumns = {
  proposal: proposals,
  grantTitle: grants.title,
  funderName: funders.name,
  ownerName: sql<string | null>`app.display_name(${proposals.ownerId})`,
};

const baseQuery = (tx: Tx) =>
  tx
    .select(proposalColumns)
    .from(proposals)
    .leftJoin(grants, eq(grants.id, proposals.grantId))
    .leftJoin(funders, eq(funders.id, grants.funderId));

/**
 * RLS: an invisible proposal and a missing one both come back empty.
 * `lock` takes a row lock so concurrent transitions serialise.
 */
async function loadProposal(tx: Tx, id: string, lock = false) {
  const q = baseQuery(tx).where(eq(proposals.id, id));
  const [row] = await (lock ? q.for('update', { of: proposals }) : q);
  if (!row) throw notFound('Proposal not found');
  return row;
}

async function loadEvents(tx: Tx, proposalId: string) {
  const rows = await tx
    .select({ event: proposalEvents, actorName: sql<string | null>`app.display_name(${proposalEvents.actorId})` })
    .from(proposalEvents)
    .where(eq(proposalEvents.proposalId, proposalId))
    .orderBy(asc(proposalEvents.createdAt), asc(proposalEvents.id));
  return rows.map((r) => ({ ...r.event, actorName: r.actorName }));
}

async function fullDto(tx: Tx, id: string) {
  const row = await loadProposal(tx, id);
  return toProposalDto(row.proposal, { ...row, events: await loadEvents(tx, id) });
}

/** Tells the owner when someone else moves their proposal. */
async function notifyOwner(tx: Tx, req: Request, p: Proposal, to: Status) {
  if (p.ownerId === me(req).id) return;
  await tx.insert(notifications).values({
    userId: p.ownerId,
    type: 'proposal_update',
    title: `Proposal ${to}`,
    message: `Your research office moved "${p.title}" to ${to}.`,
    grantId: p.grantId,
    link: `/proposals/${p.id}`,
  });
}

/* ------------------------------------------------------------------ */
/* Proposals                                                           */
/* ------------------------------------------------------------------ */

proposalsRouter.get(
  '/',
  handle(
    {
      query: zPagination.extend({
        scope: z.enum(['mine', 'org', 'all']).default('all'),
        status: zStatus.optional(),
        includeHistory: z.enum(['true', 'false']).default('false'),
      }),
    },
    async (req, res, { query }) => {
      const user = me(req);
      const result = await withUserTx(identity(req), async (tx) => {
        const rows = await baseQuery(tx)
          .where(
            and(
              query.scope === 'mine' ? eq(proposals.ownerId, user.id) : undefined,
              query.scope === 'org' ? (user.orgId ? eq(proposals.orgId, user.orgId) : sql`false`) : undefined,
              query.status ? eq(proposals.status, query.status) : undefined,
            ),
          )
          .orderBy(desc(proposals.updatedAt))
          .limit(query.limit)
          .offset(query.offset);
        if (query.includeHistory !== 'true' || rows.length === 0) return rows.map((r) => toProposalDto(r.proposal, r));

        // One query for every listed proposal's timeline.
        const events = await tx
          .select({ event: proposalEvents, actorName: sql<string | null>`app.display_name(${proposalEvents.actorId})` })
          .from(proposalEvents)
          .where(inArray(proposalEvents.proposalId, rows.map((r) => r.proposal.id)))
          .orderBy(asc(proposalEvents.createdAt), asc(proposalEvents.id));
        const byProposal = new Map<string, (typeof proposalEvents.$inferSelect & { actorName: string | null })[]>();
        for (const e of events) {
          const list = byProposal.get(e.event.proposalId) ?? [];
          list.push({ ...e.event, actorName: e.actorName });
          byProposal.set(e.event.proposalId, list);
        }
        return rows.map((r) => toProposalDto(r.proposal, { ...r, events: byProposal.get(r.proposal.id) ?? [] }));
      });
      res.json({ proposals: result });
    },
  ),
);

const CreateBody = z
  .object({
    grantId: zUuid.optional(),
    title: z.string().trim().min(1).max(300).optional(),
    notes: z.string().trim().max(10_000).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    // The prototype let a tracker start in any status. Honoured for solo
    // researchers; org proposals always start as drafts.
    status: z.enum(['draft', 'submitted', 'awarded', 'rejected']).default('draft'),
  })
  .refine((b) => b.grantId || b.title, 'Provide a grantId or a title');

proposalsRouter.post(
  '/',
  handle({ body: CreateBody }, async (req, res, { body }) => {
    const user = me(req);
    const status: Status = user.orgId ? 'draft' : body.status;

    const dto = await withUserTx(identity(req), async (tx) => {
      let grant: { id: string; title: string; amount: number | null; deadline: string | null } | undefined;
      if (body.grantId) {
        [grant] = await tx
          .select({ id: grants.id, title: grants.title, amount: grants.amount, deadline: grants.deadline })
          .from(grants)
          .where(eq(grants.id, body.grantId));
        if (!grant) throw notFound('Grant not found');
        const [dupe] = await tx
          .select({ id: proposals.id })
          .from(proposals)
          .where(and(eq(proposals.ownerId, user.id), eq(proposals.grantId, grant.id)));
        if (dupe) throw conflict('already_tracking', 'You already have a proposal for this grant');
      }

      const [p] = await tx
        .insert(proposals)
        .values({
          ownerId: user.id,
          orgId: user.orgId,
          grantId: grant?.id ?? null,
          title: body.title ?? grant!.title,
          status,
          notes: body.notes ?? null,
          body: body.body ?? null,
          requestedAmount: grant?.amount ?? null,
          deadline: grant?.deadline ?? null,
          submittedAt: status === 'submitted' || status === 'awarded' ? new Date() : null,
        })
        .returning();
      await tx.insert(proposalEvents).values({
        proposalId: p!.id,
        actorId: user.id,
        fromStatus: null,
        toStatus: status,
        comment: body.notes ?? `Saved to workspace as ${status}.`,
      });
      await recordAudit(tx, req, {
        action: 'proposal.create',
        entity: 'proposal',
        entityId: p!.id,
        diff: { grantId: grant?.id ?? null, status },
      });
      return fullDto(tx, p!.id);
    });
    res.status(201).json({ proposal: dto, application: dto });
  }),
);

proposalsRouter.get(
  '/:id',
  handle({ params: ProposalParams }, async (req, res, { params }) => {
    const dto = await withUserTx(identity(req), (tx) => fullDto(tx, params.id));
    res.json({ proposal: dto });
  }),
);

const PatchBody = z
  .object({
    title: z.string().trim().min(1).max(300),
    notes: z.string().trim().max(10_000),
    body: z.record(z.string(), z.unknown()),
    requestedAmount: z.number().nonnegative().max(1e12),
    deadline: z.iso.date(),
  })
  .partial()
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Provide at least one field');

proposalsRouter.patch(
  '/:id',
  handle({ params: ProposalParams, body: PatchBody }, async (req, res, { params, body }) => {
    const dto = await withUserTx(identity(req), async (tx) => {
      const { proposal: p } = await loadProposal(tx, params.id, true);
      assertCanEdit(req, p);
      const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
      await tx.update(proposals).set(changes).where(eq(proposals.id, p.id));
      if (body.notes !== undefined && body.notes !== p.notes) {
        await tx.insert(proposalEvents).values({
          proposalId: p.id,
          actorId: me(req).id,
          fromStatus: p.status,
          toStatus: p.status,
          comment: 'Updated application notes.',
        });
      }
      await recordAudit(tx, req, {
        action: 'proposal.update',
        entity: 'proposal',
        entityId: p.id,
        diff: { fields: Object.keys(changes) },
      });
      return fullDto(tx, p.id);
    });
    res.json({ proposal: dto });
  }),
);

proposalsRouter.post(
  '/:id/transition',
  handle(
    { params: ProposalParams, body: z.object({ to: zStatus, comment: z.string().trim().max(5_000).optional() }) },
    async (req, res, { params, body }) => {
      const dto = await withUserTx(identity(req), async (tx) => {
        const { proposal: p } = await loadProposal(tx, params.id, true);
        assertTransition(req, p, body.to);

        await tx
          .update(proposals)
          .set({
            status: body.to,
            ...(body.to === 'submitted' && !p.submittedAt ? { submittedAt: new Date() } : {}),
          })
          .where(eq(proposals.id, p.id));
        await tx.insert(proposalEvents).values({
          proposalId: p.id,
          actorId: me(req).id,
          fromStatus: p.status,
          toStatus: body.to,
          comment: body.comment ?? `Moved from ${p.status} to ${body.to}.`,
        });
        await notifyOwner(tx, req, p, body.to);
        await recordAudit(tx, req, {
          action: `proposal.${body.to}`,
          entity: 'proposal',
          entityId: p.id,
          diff: { from: p.status, to: body.to },
        });
        return fullDto(tx, p.id);
      });
      res.json({ proposal: dto });
    },
  ),
);

/** A timeline note with no status change (the prototype's custom history entry). */
proposalsRouter.post(
  '/:id/events',
  handle(
    { params: ProposalParams, body: z.object({ comment: z.string().trim().min(1).max(5_000) }) },
    async (req, res, { params, body }) => {
      const dto = await withUserTx(identity(req), async (tx) => {
        const { proposal: p } = await loadProposal(tx, params.id, true);
        const { isOwner, isOfficer } = roleOn(req, p);
        if (!isOwner && !isOfficer) throw forbidden('not_editor', 'Only the owner or a grant officer can add notes');
        await tx.insert(proposalEvents).values({
          proposalId: p.id,
          actorId: me(req).id,
          fromStatus: p.status,
          toStatus: p.status,
          comment: body.comment,
        });
        await recordAudit(tx, req, { action: 'proposal.note', entity: 'proposal', entityId: p.id });
        return fullDto(tx, p.id);
      });
      res.status(201).json({ proposal: dto });
    },
  ),
);

proposalsRouter.delete(
  '/:id',
  handle({ params: ProposalParams }, async (req, res, { params }) => {
    await withUserTx(identity(req), async (tx) => {
      const { proposal: p } = await loadProposal(tx, params.id, true);
      const { isOwner, isSuper } = roleOn(req, p);
      const deletable = p.orgId === null || ['draft', 'review', 'rejected'].includes(p.status);
      if (!isSuper && !(isOwner && deletable)) {
        throw forbidden('delete_forbidden', 'Only the owner can delete, and not once the office has approved it');
      }
      await tx.delete(proposals).where(eq(proposals.id, p.id));
      await recordAudit(tx, req, {
        action: 'proposal.delete',
        entity: 'proposal',
        entityId: p.id,
        diff: { title: p.title, status: p.status },
      });
    });
    res.status(204).end();
  }),
);

/* ------------------------------------------------------------------ */
/* Budget                                                              */
/* ------------------------------------------------------------------ */

async function loadBudget(tx: Tx, proposalId: string, lock = false) {
  const q = tx.select().from(budgets).where(eq(budgets.proposalId, proposalId));
  const [budget] = await (lock ? q.for('update') : q);
  if (!budget) return null;
  const lines = await tx
    .select()
    .from(budgetLines)
    .where(eq(budgetLines.budgetId, budget.id))
    .orderBy(asc(budgetLines.year), asc(budgetLines.category));
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return {
    id: budget.id,
    status: budget.status,
    currency: budget.currency,
    approvedBy: budget.approvedBy,
    approvedAt: budget.approvedAt,
    total: Math.round(total * 100) / 100,
    lines: lines.map((l) => ({ id: l.id, category: l.category, description: l.description, year: l.year, amount: l.amount })),
  };
}

proposalsRouter.get(
  '/:id/budget',
  handle({ params: ProposalParams }, async (req, res, { params }) => {
    const budget = await withUserTx(identity(req), async (tx) => {
      await loadProposal(tx, params.id);
      return loadBudget(tx, params.id);
    });
    res.json({ budget });
  }),
);

const BudgetBody = z.object({
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  lines: z
    .array(
      z.object({
        category: z.enum(budgetCategoryEnum.enumValues),
        description: z.string().trim().max(500).optional(),
        year: z.number().int().min(1).max(10).default(1),
        amount: z.number().nonnegative().max(1e11),
      }),
    )
    .min(1)
    .max(200),
});

proposalsRouter.put(
  '/:id/budget',
  handle({ params: ProposalParams, body: BudgetBody }, async (req, res, { params, body }) => {
    const budget = await withUserTx(identity(req), async (tx) => {
      const { proposal: p } = await loadProposal(tx, params.id, true);
      assertCanEdit(req, p);

      const existing = await loadBudget(tx, p.id, true);
      let budgetId = existing?.id;
      if (budgetId) {
        // Any edit to an approved budget sends it back for re-approval.
        await tx
          .update(budgets)
          .set({ currency: body.currency, status: 'draft', approvedBy: null, approvedAt: null })
          .where(eq(budgets.id, budgetId));
        await tx.delete(budgetLines).where(eq(budgetLines.budgetId, budgetId));
      } else {
        const [created] = await tx
          .insert(budgets)
          .values({ proposalId: p.id, orgId: p.orgId, currency: body.currency })
          .returning({ id: budgets.id });
        budgetId = created!.id;
      }
      await tx.insert(budgetLines).values(body.lines.map((l) => ({ ...l, description: l.description ?? null, budgetId: budgetId! })));

      const total = body.lines.reduce((sum, l) => sum + l.amount, 0);
      await tx.update(proposals).set({ requestedAmount: total }).where(eq(proposals.id, p.id));
      await recordAudit(tx, req, {
        action: 'budget.update',
        entity: 'proposal',
        entityId: p.id,
        diff: { lines: body.lines.length, total, reopened: existing?.status === 'approved' },
      });
      return loadBudget(tx, p.id);
    });
    res.json({ budget });
  }),
);

proposalsRouter.post(
  '/:id/budget/approve',
  requireRole('grant_officer'),
  handle({ params: ProposalParams }, async (req, res, { params }) => {
    const budget = await withUserTx(identity(req), async (tx) => {
      const { proposal: p } = await loadProposal(tx, params.id, true);
      if (!p.orgId) throw badRequest('no_organization', 'Solo proposals have no budget approval step');
      const { isOwner, isOfficer, isSuper } = roleOn(req, p);
      if (!isSuper && (!isOfficer || isOwner)) {
        throw forbidden('approve_forbidden', 'A grant officer other than the owner must approve the budget');
      }
      const existing = await loadBudget(tx, p.id, true);
      if (!existing || existing.lines.length === 0) throw badRequest('budget_empty', 'There is no budget to approve');
      if (existing.status === 'approved') throw conflict('already_approved', 'Budget is already approved');

      await tx
        .update(budgets)
        .set({ status: 'approved', approvedBy: me(req).id, approvedAt: new Date() })
        .where(eq(budgets.id, existing.id));
      await recordAudit(tx, req, {
        action: 'budget.approve',
        entity: 'proposal',
        entityId: p.id,
        diff: { total: existing.total, currency: existing.currency },
      });
      return loadBudget(tx, p.id);
    });
    res.json({ budget });
  }),
);
