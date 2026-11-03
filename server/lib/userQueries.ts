import { eq } from 'drizzle-orm';

import type { Tx } from '../db/index.ts';
import { organizations, users } from '../db/schema.ts';
import { notFound } from './httpError.ts';
import { toUserDto } from './serializers.ts';

/** The user plus their organisation's name, as the API returns it. */
export async function loadUserDto(tx: Tx, userId: string) {
  const [row] = await tx
    .select({ user: users, orgName: organizations.name })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.orgId))
    .where(eq(users.id, userId));
  if (!row) throw notFound('User not found');
  return toUserDto(row.user, row.orgName);
}
