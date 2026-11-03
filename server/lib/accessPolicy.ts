import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Tx } from '../db/index.ts';
import { systemSettings } from '../db/schema.ts';

// The access policy: how GrantSeeker applies the principle of least
// privilege. Every account starts as a researcher, the lowest stored role;
// anything higher is granted per person, with a reason, by someone allowed
// to grant it, and privileged accounts that go unused are flagged for review.

export const ACCESS_POLICY_KEY = 'access_policy';

export const AccessPolicySchema = z.object({
  /** open: anyone may create an account; invite_only: only with an organisation invite code. */
  registrationMode: z.enum(['open', 'invite_only']).default('open'),
  /** The highest role an institution admin may grant inside their organisation. */
  institutionAdminMaxRole: z.enum(['researcher', 'grant_officer']).default('grant_officer'),
  /** Raising someone's role must state why (recorded in the audit log). */
  requireReasonToElevate: z.boolean().default(true),
  /** Privileged accounts not signed in for this many days are flagged in the access review. */
  dormantAfterDays: z.number().int().min(14).max(365).default(90),
});

export type AccessPolicy = z.infer<typeof AccessPolicySchema>;

export const DEFAULT_ACCESS_POLICY: AccessPolicy = AccessPolicySchema.parse({});

/** The stored policy, defaults filling anything unset. Needs a system or super-admin transaction. */
export async function loadAccessPolicy(tx: Tx): Promise<AccessPolicy & { updatedAt: Date | null; updatedBy: string | null }> {
  const [row] = await tx.select().from(systemSettings).where(eq(systemSettings.key, ACCESS_POLICY_KEY));
  const parsed = AccessPolicySchema.safeParse(row?.value ?? {});
  return { ...(parsed.success ? parsed.data : DEFAULT_ACCESS_POLICY), updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
}

export async function saveAccessPolicy(tx: Tx, policy: AccessPolicy, userId: string): Promise<void> {
  const values = { value: policy as Record<string, unknown>, updatedBy: userId, updatedAt: new Date() };
  await tx
    .insert(systemSettings)
    .values({ key: ACCESS_POLICY_KEY, ...values })
    .onConflictDoUpdate({ target: systemSettings.key, set: values });
}
