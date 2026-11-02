import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiRequestError, collectionPath, resourcePath } from '../src/lib/api/client.ts';
import {
  createCampaign,
  createJournal,
  createKnowledge,
  createScene,
  createSession,
  getJournal,
  getKnowledge,
  listSessions,
  listCampaigns,
  removeMember,
  updateCharacter,
} from '../src/lib/api/campaigns.ts';
import type { PatchCharacter } from '../src/lib/api/campaigns.ts';
import type { Page } from '../src/lib/api/client.ts';
import type { Campaign } from '../src/generated/contracts.ts';

const IDENTITY = '00000000-0000-4000-8000-00000000005a';
const CAMPAIGN = '00000000-0000-4000-8000-000000000001';
const SCENE = '00000000-0000-4000-8000-000000000002';
const USER = '00000000-0000-4000-8000-000000000003';
const MAP = '00000000-0000-4000-8000-000000000006';

interface Capture {
  url: string;
  init: RequestInit;
}

function fakeFetch(body: unknown, status = 200, captured: Capture[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(input), init: init ?? {} });
    const payload = status === 204 ? null : JSON.stringify(body);
    return new Response(payload, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function context(body: unknown, status = 200, captured: Capture[] = []) {
  return { fetch: fakeFetch(body, status, captured), identity: IDENTITY };
}

const CAMPAIGN_ROW: Campaign = {
  id: CAMPAIGN,
  owner_id: IDENTITY,
  city_id: null,
  name: 'Synthetic',
  rules_edition: 'dnd_2014',
  revision: 1,
};

test('collection and resource paths stay encoded and ordered', () => {
  assert.equal(collectionPath('/campaigns'), '/campaigns');
  assert.equal(
    collectionPath('/campaigns', { limit: 2, offset: 4 }),
    '/campaigns?limit=2&offset=4',
  );
  assert.equal(resourcePath('/campaigns', 'a/b'), '/campaigns/a%2Fb');
});

test('listCampaigns sends identity and parses the generated page type', async () => {
  const page: Page<Campaign> = {
    items: [CAMPAIGN_ROW],
    limit: 20,
    offset: 0,
    has_more: false,
  };
  const captured: Capture[] = [];
  const result = await listCampaigns(context(page, 200, captured), { limit: 20 });

  assert.equal(captured[0].url, '/api/v1/campaigns?limit=20');
  assert.equal(captured[0].init.method, 'GET');
  assert.equal((captured[0].init.headers as Record<string, string>)['x-desire-user'], IDENTITY);
  assert.equal(result.items[0].id, CAMPAIGN);
});

test('createCampaign posts the contract fields as JSON', async () => {
  const captured: Capture[] = [];
  await createCampaign(context(CAMPAIGN_ROW, 201, captured), {
    name: 'Synthetic',
    rules_edition: 'dnd_2014',
    city_id: null,
  });

  assert.equal(captured[0].url, '/api/v1/campaigns');
  assert.equal(captured[0].init.method, 'POST');
  assert.equal(
    (captured[0].init.headers as Record<string, string>)['content-type'],
    'application/json',
  );
  assert.deepEqual(JSON.parse(String(captured[0].init.body)), {
    name: 'Synthetic',
    rules_edition: 'dnd_2014',
    city_id: null,
  });
});

test('createScene forwards the optional idempotency key', async () => {
  const captured: Capture[] = [];
  await createScene(
    context({ id: SCENE }, 201, captured),
    CAMPAIGN,
    { name: 'Dock', map_version_id: MAP },
    SCENE,
  );

  assert.equal(
    captured[0].url,
    `/api/v1/campaigns/${CAMPAIGN}/scenes`,
  );
  assert.equal((captured[0].init.headers as Record<string, string>)['idempotency-key'], SCENE);
});

test('removeMember sends DELETE and accepts an empty 204', async () => {
  const captured: Capture[] = [];
  const result = await removeMember(context(null, 204, captured), CAMPAIGN, USER);

  assert.equal(result, undefined);
  assert.equal(captured[0].init.method, 'DELETE');
  assert.equal(captured[0].init.body, undefined);
  assert.equal(captured[0].url, `/api/v1/campaigns/${CAMPAIGN}/members/${USER}`);
});

test('API problems keep status, code and request id', async () => {
  const problem = {
    code: 'revision_conflict',
    message: 'the expected revision is stale',
    request_id: '00000000-0000-4000-8000-0000000000aa',
  };
  await assert.rejects(
    () => listCampaigns(context(problem, 409)),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 409);
      assert.equal(error.problem.code, 'revision_conflict');
      assert.equal(error.message, problem.message);
      assert.equal(error.problem.request_id, problem.request_id);
      return true;
    },
  );
});

test('non-JSON failures still become ApiRequestError', async () => {
  const broken = (async () =>
    new Response('not json', { status: 502 })) as unknown as typeof fetch;
  await assert.rejects(
    () => listCampaigns({ fetch: broken, identity: IDENTITY }),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 502);
      assert.equal(error.problem.code, 'unknown');
      return true;
    },
  );
});

test('character patches cannot send an immutable rules edition', async () => {
  const patch: PatchCharacter = {
    name: 'Synthetic hero',
    controller_id: null,
    expected_revision: 1,
  };
  const captured: Capture[] = [];
  await updateCharacter(context({ id: SCENE }, 200, captured), CAMPAIGN, SCENE, patch);

  const body = JSON.parse(String(captured[0].init.body));
  assert.deepEqual(body, patch);
  assert.equal((body as Record<string, unknown>).rules_edition, undefined);
  assert.equal(
    captured[0].url,
    `/api/v1/campaigns/${CAMPAIGN}/characters/${SCENE}`,
  );
});

test('session, journal and knowledge calls use the generated contract shapes', async () => {
  const captured: Capture[] = [];
  const session = { id: USER, campaign_id: CAMPAIGN, title: 'Synthetic', revision: 1 };
  const sessionBody = { title: session.title };
  await createSession(context(session, 201, captured), CAMPAIGN, sessionBody);
  assert.deepEqual(JSON.parse(String(captured[0].init.body)), sessionBody);
  assert.equal(captured[0].url, `/api/v1/campaigns/${CAMPAIGN}/sessions`);

  await listSessions(context({ items: [], limit: 20, offset: 0, has_more: false }, 200, captured), CAMPAIGN);
  assert.equal(captured[1].url, `/api/v1/campaigns/${CAMPAIGN}/sessions`);

  const entry = {
    id: USER,
    campaign_id: CAMPAIGN,
    session_id: SCENE,
    body: 'Synthetic recap',
    visibility: 'players' as const,
    revision: 1,
  };
  const journalBody = {
    session_id: entry.session_id,
    body: entry.body,
    visibility: entry.visibility,
  };
  await createJournal(context(entry, 201, captured), CAMPAIGN, journalBody);
  assert.deepEqual(JSON.parse(String(captured[2].init.body)), journalBody);

  await getJournal(context(entry, 200, captured), CAMPAIGN, USER);
  assert.equal(captured[3].url, `/api/v1/campaigns/${CAMPAIGN}/journal/${USER}`);

  const provenance = {
    source: 'Synthetic',
    attribution: 'Synthetic',
    evidence: 'synthetic' as const,
  };
  const knowledge = {
    id: USER,
    campaign_id: CAMPAIGN,
    title: 'Synthetic lore',
    body: 'Synthetic body',
    visibility: 'dm' as const,
    revision: 1,
    provenance,
  };
  const knowledgeBody = {
    title: knowledge.title,
    body: knowledge.body,
    visibility: knowledge.visibility,
    provenance,
  };
  await createKnowledge(context(knowledge, 201, captured), CAMPAIGN, knowledgeBody);
  assert.deepEqual(JSON.parse(String(captured[4].init.body)), knowledgeBody);

  await getKnowledge(context(knowledge, 200, captured), CAMPAIGN, USER);
  assert.equal(captured[5].url, `/api/v1/campaigns/${CAMPAIGN}/knowledge/${USER}`);
});
