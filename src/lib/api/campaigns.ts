// Typed calls for campaigns, members, sessions, scenes, characters, journal and knowledge.
import type {
  Campaign,
  CampaignKnowledge,
  Character,
  Id,
  JournalEntry,
  Membership,
  Scene,
  Session,
} from '../../generated/contracts.ts';
import {
  type ApiContext,
  type Page,
  type PageQuery,
  collectionPath,
  request,
  resourcePath,
} from './client.ts';

export type NewCampaign = Omit<Campaign, 'id' | 'owner_id' | 'revision'>;
export type PatchCampaign = Pick<Campaign, 'name'> & { expected_revision: number };
export type NewMember = Omit<Membership, 'campaign_id'>;
export type NewScene = Omit<Scene, 'id' | 'campaign_id' | 'revision'>;
export type PatchScene = NewScene & { expected_revision: number };
export type NewCharacter = Omit<Character, 'id' | 'campaign_id' | 'revision'>;
export type PatchCharacter = Omit<NewCharacter, 'rules_edition'> & {
  expected_revision: number;
};
export type NewJournal = Omit<JournalEntry, 'id' | 'campaign_id' | 'revision'>;
export type PatchJournal = Pick<JournalEntry, 'body' | 'visibility'> & {
  expected_revision: number;
};
export type NewKnowledge = Omit<CampaignKnowledge, 'id' | 'campaign_id' | 'revision'>;
export type PatchKnowledge = NewKnowledge & { expected_revision: number };
export type NewSession = Omit<Session, 'id' | 'campaign_id' | 'revision'>;

export const CAMPAIGNS = '/campaigns';

export function listCampaigns(context: ApiContext, page?: PageQuery): Promise<Page<Campaign>> {
  return request(context, { method: 'GET', path: collectionPath(CAMPAIGNS, page) });
}

export function createCampaign(context: ApiContext, body: NewCampaign): Promise<Campaign> {
  return request(context, { method: 'POST', path: CAMPAIGNS, body });
}

export function getCampaign(context: ApiContext, id: Id): Promise<Campaign> {
  return request(context, { method: 'GET', path: resourcePath(CAMPAIGNS, id) });
}

export function renameCampaign(
  context: ApiContext,
  id: Id,
  body: PatchCampaign,
): Promise<Campaign> {
  return request(context, { method: 'PATCH', path: resourcePath(CAMPAIGNS, id), body });
}

export function listMembers(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<Membership>> {
  return request(context, { method: 'GET', path: collectionPath(members(campaignId), page) });
}

export function addMember(
  context: ApiContext,
  campaignId: Id,
  body: NewMember,
): Promise<Membership> {
  return request(context, { method: 'POST', path: members(campaignId), body });
}

export function removeMember(context: ApiContext, campaignId: Id, userId: Id): Promise<void> {
  return request(context, { method: 'DELETE', path: resourcePath(members(campaignId), userId) });
}

export function listScenes(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<Scene>> {
  return request(context, { method: 'GET', path: collectionPath(scenes(campaignId), page) });
}

export function getScene(context: ApiContext, campaignId: Id, sceneId: Id): Promise<Scene> {
  return request(context, { method: 'GET', path: resourcePath(scenes(campaignId), sceneId) });
}

export function createScene(
  context: ApiContext,
  campaignId: Id,
  body: NewScene,
  idempotencyKey?: Id,
): Promise<Scene> {
  const headers: Record<string, string> = idempotencyKey
    ? { 'idempotency-key': idempotencyKey }
    : {};
  return request(context, { method: 'POST', path: scenes(campaignId), body, headers });
}

export function updateScene(
  context: ApiContext,
  campaignId: Id,
  sceneId: Id,
  body: PatchScene,
): Promise<Scene> {
  return request(context, {
    method: 'PATCH',
    path: resourcePath(scenes(campaignId), sceneId),
    body,
  });
}

export function listCharacters(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<Character>> {
  return request(context, { method: 'GET', path: collectionPath(characters(campaignId), page) });
}

export function getCharacter(
  context: ApiContext,
  campaignId: Id,
  characterId: Id,
): Promise<Character> {
  return request(context, {
    method: 'GET',
    path: resourcePath(characters(campaignId), characterId),
  });
}

export function createCharacter(
  context: ApiContext,
  campaignId: Id,
  body: NewCharacter,
): Promise<Character> {
  return request(context, { method: 'POST', path: characters(campaignId), body });
}

export function updateCharacter(
  context: ApiContext,
  campaignId: Id,
  characterId: Id,
  body: PatchCharacter,
): Promise<Character> {
  return request(context, {
    method: 'PATCH',
    path: resourcePath(characters(campaignId), characterId),
    body,
  });
}

export function deleteCharacter(
  context: ApiContext,
  campaignId: Id,
  characterId: Id,
): Promise<void> {
  return request(context, {
    method: 'DELETE',
    path: resourcePath(characters(campaignId), characterId),
  });
}

export function listSessions(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<Session>> {
  return request(context, { method: 'GET', path: collectionPath(sessions(campaignId), page) });
}

export function createSession(
  context: ApiContext,
  campaignId: Id,
  body: NewSession,
): Promise<Session> {
  return request(context, { method: 'POST', path: sessions(campaignId), body });
}

export function listJournal(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<JournalEntry>> {
  return request(context, { method: 'GET', path: collectionPath(journal(campaignId), page) });
}

export function getJournal(
  context: ApiContext,
  campaignId: Id,
  entryId: Id,
): Promise<JournalEntry> {
  return request(context, { method: 'GET', path: resourcePath(journal(campaignId), entryId) });
}

export function createJournal(
  context: ApiContext,
  campaignId: Id,
  body: NewJournal,
): Promise<JournalEntry> {
  return request(context, { method: 'POST', path: journal(campaignId), body });
}

export function updateJournal(
  context: ApiContext,
  campaignId: Id,
  entryId: Id,
  body: PatchJournal,
): Promise<JournalEntry> {
  return request(context, {
    method: 'PATCH',
    path: resourcePath(journal(campaignId), entryId),
    body,
  });
}

export function deleteJournal(context: ApiContext, campaignId: Id, entryId: Id): Promise<void> {
  return request(context, { method: 'DELETE', path: resourcePath(journal(campaignId), entryId) });
}

export function listKnowledge(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<CampaignKnowledge>> {
  return request(context, { method: 'GET', path: collectionPath(knowledge(campaignId), page) });
}

export function getKnowledge(
  context: ApiContext,
  campaignId: Id,
  entryId: Id,
): Promise<CampaignKnowledge> {
  return request(context, { method: 'GET', path: resourcePath(knowledge(campaignId), entryId) });
}

export function createKnowledge(
  context: ApiContext,
  campaignId: Id,
  body: NewKnowledge,
): Promise<CampaignKnowledge> {
  return request(context, { method: 'POST', path: knowledge(campaignId), body });
}

export function updateKnowledge(
  context: ApiContext,
  campaignId: Id,
  entryId: Id,
  body: PatchKnowledge,
): Promise<CampaignKnowledge> {
  return request(context, {
    method: 'PATCH',
    path: resourcePath(knowledge(campaignId), entryId),
    body,
  });
}

export function deleteKnowledge(
  context: ApiContext,
  campaignId: Id,
  entryId: Id,
): Promise<void> {
  return request(context, { method: 'DELETE', path: resourcePath(knowledge(campaignId), entryId) });
}

function members(campaignId: Id): string {
  return `${resourcePath(CAMPAIGNS, campaignId)}/members`;
}

function scenes(campaignId: Id): string {
  return `${resourcePath(CAMPAIGNS, campaignId)}/scenes`;
}

function characters(campaignId: Id): string {
  return `${resourcePath(CAMPAIGNS, campaignId)}/characters`;
}

function sessions(campaignId: Id): string {
  return `${resourcePath(CAMPAIGNS, campaignId)}/sessions`;
}

function journal(campaignId: Id): string {
  return `${resourcePath(CAMPAIGNS, campaignId)}/journal`;
}

function knowledge(campaignId: Id): string {
  return `${resourcePath(CAMPAIGNS, campaignId)}/knowledge`;
}
