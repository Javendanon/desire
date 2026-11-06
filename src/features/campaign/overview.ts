// Loads what the campaign summary shows. Sessions carry no date in the v1 contract, so they are
// listed as the server returns them: this module never guesses which one was the latest.
import type {
  Campaign,
  Id,
  JournalEntry,
  MemberRole,
  Membership,
  Scene,
  Session,
} from '../../generated/contracts.ts';
import {
  getCampaign,
  listJournal,
  listMembers,
  listScenes,
  listSessions,
} from '../../lib/api/campaigns.ts';
import type { ApiContext } from '../../lib/api/client.ts';
import { collectPages } from './pages.ts';

export interface SessionRecap {
  session: Session;
  entries: JournalEntry[];
}

export interface CampaignOverview {
  campaign: Campaign;
  role: MemberRole | null;
  memberCount: number;
  recaps: SessionRecap[];
  scenes: Scene[];
  truncated: boolean;
}

/** Attaches each journal entry to its session. O(sessions + entries). */
export function groupRecaps(
  sessions: readonly Session[],
  journal: readonly JournalEntry[],
): SessionRecap[] {
  const bySession = new Map<Id, JournalEntry[]>();
  for (const entry of journal) {
    const entries = bySession.get(entry.session_id) ?? [];
    entries.push(entry);
    bySession.set(entry.session_id, entries);
  }
  return sessions.map((session) => ({ session, entries: bySession.get(session.id) ?? [] }));
}

export function roleOf(members: readonly Membership[], identity: Id): MemberRole | null {
  return members.find((member) => member.user_id === identity)?.role ?? null;
}

/** Only decides which controls to show. The server still authorizes every write. */
export function canManage(role: MemberRole | null): boolean {
  return role === 'dm';
}

export async function loadCampaignOverview(
  context: ApiContext,
  campaignId: Id,
): Promise<CampaignOverview> {
  const [campaign, members, sessions, journal, scenes] = await Promise.all([
    getCampaign(context, campaignId),
    collectPages((page) => listMembers(context, campaignId, page)),
    collectPages((page) => listSessions(context, campaignId, page)),
    collectPages((page) => listJournal(context, campaignId, page)),
    collectPages((page) => listScenes(context, campaignId, page)),
  ]);
  return {
    campaign,
    // The owner is always a DM membership, and the paginated list can stop before that row.
    role:
      campaign.owner_id === context.identity
        ? 'dm'
        : roleOf(members.items, context.identity),
    memberCount: members.items.length,
    recaps: groupRecaps(sessions.items, journal.items),
    scenes: scenes.items,
    truncated: [members, sessions, journal, scenes].some((list) => list.truncated),
  };
}
