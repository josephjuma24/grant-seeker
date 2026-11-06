/**
 * The one rule for where a funding call belongs, shared by the API, the
 * harvester and the web app:
 *
 *   active    open: deadline today or later (or none), not closed;
 *   expired   ended (deadline passed, or closed by the source) at most
 *             ARCHIVE_AFTER_DAYS days ago;
 *   archived  ended more than ARCHIVE_AFTER_DAYS days ago, or archived
 *             early by an admin.
 *
 * A call's end date is the earlier of its deadline and the day it was
 * closed, so a call the source withdraws before its deadline ages from the
 * day it closed.
 */
export const ARCHIVE_AFTER_DAYS = 30;

/**
 * Days until an expired call moves to the archive: it is archived once more
 * than ARCHIVE_AFTER_DAYS days have passed, i.e. on day ARCHIVE_AFTER_DAYS + 1.
 */
export function daysUntilArchive(endedOn: string | null, today = new Date()): number | null {
  if (!endedOn) return null;
  const end = Date.parse(`${endedOn.slice(0, 10)}T00:00:00Z`);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return ARCHIVE_AFTER_DAYS + 1 - Math.floor((now - end) / 86_400_000);
}

/** A call is at a critical deadline when it closes within this many days. */
export const CRITICAL_DEADLINE_DAYS = 30;
/** The most urgent slice of the critical window. */
export const DUE_THIS_WEEK_DAYS = 7;
