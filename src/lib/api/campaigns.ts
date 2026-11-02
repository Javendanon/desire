// Typed calls for campaigns, members, scenes, characters, journal and knowledge.
import type {
  Campaign,
  CampaignKnowledge,
  Character,
  Id,
  JournalEntry,
  Membership,
  Provenance,
  RulesEdition,
  Scene,
  Visibility,
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

export interface KnowledgeDraft {
  title: string;
  body: string;
  visibility: Visibility;
  provenance: Provenance;
}

export interface SceneDraft {
  name: string;
  map_version_id: Id;
}

export interface CharacterDraft {
  name: string;
  controller_id: Id | null;
  rules_edition: RulesEdition;
}

export const CAMPAIGNS = '/campaigns';

export function listCampaigns(context: ApiContext, page?: PageQuery): Promise<Page<Campaign>> {
  return request(context, 'GET', collectionPath(CAMPAIGNS, page));
}

export function createCampaign(context: ApiContext, body: NewCampaign): Promise<Campaign> {
  return request(context, 'POST', CAMPAIGNS, body);
}

export function getCampaign(context: ApiContext, id: Id): Promise<Campaign> {
  return request(context, 'GET', resourcePath(CAMPAIGNS, id));
}

export function renameCampaign(
  context: ApiContext,
  id: Id,
  body: PatchCampaign,
): Promise<Campaign> {
  return request(context, 'PATCH', resourcePath(CAMPAIGNS, id), body);
}

export function listMembers(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<Membership>> {
  return request(context, 'GET', collectionPath(members(campaignId), page));
}

export function addMember(
  context: ApiContext,
  campaignId: Id,
  body: NewMember,
): Promise<Membership> {
  return request(context, 'POST', members(campaignId), body);
}

export function removeMember(context: ApiContext, campaignId: Id, userId: Id): Promise<void> {
  return request(context, 'DELETE', resourcePath(members(campaignId), userId));
}

export function listScenes(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<Scene>> {
  return request(context, 'GET', collectionPath(scenes(campaignId), page));
}

export function getScene(context: ApiContext, campaignId: Id, sceneId: Id): Promise<Scene> {
  return request(context, 'GET', resourcePath(scenes(campaignId), sceneId));
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
  return request(context, 'POST', scenes(campaignId), body, headers);
}

export function updateScene(
  context: ApiContext,
  campaignId: Id,
  sceneId: Id,
  body: PatchScene,
): Promise<Scene> {
  return request(context, 'PATCH', resourcePath(scenes(campaignId), sceneId), body);
}

export function deleteScene(context: ApiContext, campaignId: Id, sceneId: Id): Promise<void> {
  return request(context, 'DELETE', resourcePath(scenes(campaignId), sceneId));
}

export function listCharacters(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<Character>> {
  return request(context, 'GET', collectionPath(characters(campaignId), page));
}

export function getCharacter(
  context: ApiContext,
  campaignId: Id,
  characterId: Id,
): Promise<Character> {
  return request(context, 'GET', resourcePath(characters(campaignId), characterId));
}

export function createCharacter(
  context: ApiContext,
  campaignId: Id,
  body: NewCharacter,
): Promise<Character> {
  return request(context, 'POST', characters(campaignId), body);
}

export function updateCharacter(
  context: ApiContext,
  campaignId: Id,
  characterId: Id,
  body: PatchCharacter,
): Promise<Character> {
  return request(context, 'PATCH', resourcePath(characters(campaignId), characterId), body);
}

export function deleteCharacter(
  context: ApiContext,
  campaignId: Id,
  characterId: Id,
): Promise<void> {
  return request(context, 'DELETE', resourcePath(characters(campaignId), characterId));
}

export function listJournal(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<JournalEntry>> {
  return request(context, 'GET', collectionPath(journal(campaignId), page));
}

export function createJournal(
  context: ApiContext,
  campaignId: Id,
  body: NewJournal,
): Promise<JournalEntry> {
  return request(context, 'POST', journal(campaignId), body);
}

export function updateJournal(
  context: ApiContext,
  campaignId: Id,
  entryId: Id,
  body: PatchJournal,
): Promise<JournalEntry> {
  return request(context, 'PATCH', resourcePath(journal(campaignId), entryId), body);
}

export function deleteJournal(context: ApiContext, campaignId: Id, entryId: Id): Promise<void> {
  return request(context, 'DELETE', resourcePath(journal(campaignId), entryId));
}

export function listKnowledge(
  context: ApiContext,
  campaignId: Id,
  page?: PageQuery,
): Promise<Page<CampaignKnowledge>> {
  return request(context, 'GET', collectionPath(knowledge(campaignId), page));
}

export function createKnowledge(
  context: ApiContext,
  campaignId: Id,
  body: KnowledgeDraft,
): Promise<CampaignKnowledge> {
  return request(context, 'POST', knowledge(campaignId), body);
}

export function updateKnowledge(
  context: ApiContext,
  campaignId: Id,
  entryId: Id,
  body: PatchKnowledge,
): Promise<CampaignKnowledge> {
  return request(context, 'PATCH', resourcePath(knowledge(campaignId), entryId), body);
}

export function deleteKnowledge(
  context: ApiContext,
  campaignId: Id,
  entryId: Id,
): Promise<void> {
  return request(context, 'DELETE', resourcePath(knowledge(campaignId), entryId));
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

function journal(campaignId: Id): string {
  return `${resourcePath(CAMPAIGNS, campaignId)}/journal`;
}

function knowledge(campaignId: Id): string {
  return `${resourcePath(CAMPAIGNS, campaignId)}/knowledge`;
}
