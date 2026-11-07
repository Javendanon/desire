import test from 'node:test';
import assert from 'node:assert/strict';

import catalog from '../src/app/messages.es.json' with { type: 'json' };
import { resolveCityMap } from '../src/app/cities.ts';
import { connectionState, probeServer } from '../src/app/connection.ts';
import { createDevIdentity, IDENTITY_KEY, resolveDevIdentity } from '../src/app/identity.ts';
import { t } from '../src/app/messages.ts';
import { createApiContext, withSignal } from '../src/features/campaign/api-context.ts';
import { describeFailure, isAbort } from '../src/features/campaign/failures.ts';
import { newCampaign, validateName, validateTitle } from '../src/features/campaign/forms.ts';
import {
  canManage,
  groupRecaps,
  loadCampaignOverview,
  roleOf,
} from '../src/features/campaign/overview.ts';
import { collectPages } from '../src/features/campaign/pages.ts';
import type { JournalEntry, Session } from '../src/generated/contracts.ts';
import { createSession } from '../src/lib/api/campaigns.ts';
import { ApiRequestError, type ApiContext } from '../src/lib/api/client.ts';
import type { MapDefinition } from '../src/lib/engine/plan/map-definition.ts';

const USER = '00000000-0000-4000-8000-00000000005a';
const OTHER = '00000000-0000-4000-8000-00000000005b';
const CAMPAIGN = '00000000-0000-4000-8000-000000000001';
const SESSION_A = '00000000-0000-4000-8000-000000000011';
const SESSION_B = '00000000-0000-4000-8000-000000000012';

function session(id: string): Session {
  return { id, campaign_id: CAMPAIGN, title: `Session ${id}`, revision: 1 };
}

function journal(id: string, sessionId: string): JournalEntry {
  return {
    id,
    campaign_id: CAMPAIGN,
    session_id: sessionId,
    body: 'Synthetic recap',
    visibility: 'players',
    revision: 1,
  };
}

function page<T>(items: T[], hasMore = false) {
  return { items, limit: 100, offset: 0, has_more: hasMore };
}

function apiError(status: number): ApiRequestError {
  return new ApiRequestError(status, { code: 'x', message: 'x', request_id: 'req-1' });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Answers by the last path segment, as the API routes do. */
function routedContext(routes: Record<string, unknown>): ApiContext {
  const fetchImpl = (async (input: string | URL | Request) => {
    const path = String(input).split('?')[0];
    const segment = path.split('/').at(-1) ?? '';
    return jsonResponse(routes[segment] ?? routes.campaign);
  }) as unknown as typeof fetch;
  return { identity: USER, fetch: fetchImpl };
}

test('collectPages follows has_more with growing offsets', async () => {
  const offsets: (number | undefined)[] = [];
  const result = await collectPages(async (query) => {
    offsets.push(query.offset);
    return page([query.offset], query.offset === 0);
  });

  assert.deepEqual(offsets, [0, 100]);
  assert.deepEqual(result, { items: [0, 100], truncated: false });
});

test('collectPages stops at its budget and reports truncation', async () => {
  let calls = 0;
  const result = await collectPages(async () => {
    calls += 1;
    return page([calls], true);
  });

  assert.equal(calls, 5);
  assert.equal(result.truncated, true);
});

test('groupRecaps keeps server order, empty sessions and each entry in its session', () => {
  const recaps = groupRecaps(
    [session(SESSION_A), session(SESSION_B)],
    [journal('j1', SESSION_B), journal('j2', SESSION_B)],
  );

  assert.deepEqual(recaps.map((recap) => recap.session.id), [SESSION_A, SESSION_B]);
  assert.deepEqual(recaps[0].entries, []);
  assert.deepEqual(recaps[1].entries.map((entry) => entry.id), ['j1', 'j2']);
});

test('role comes from the membership of this identity only', () => {
  const members = [
    { campaign_id: CAMPAIGN, user_id: OTHER, role: 'dm' as const },
    { campaign_id: CAMPAIGN, user_id: USER, role: 'player' as const },
  ];

  assert.equal(roleOf(members, USER), 'player');
  assert.equal(roleOf(members, 'stranger'), null);
  assert.equal(roleOf(members, undefined), null);
  assert.equal(canManage('dm'), true);
  assert.equal(canManage('player'), false);
  assert.equal(canManage(null), false);
});

test('loadCampaignOverview composes the summary of the requested campaign', async () => {
  const context = routedContext({
    campaign: {
      id: CAMPAIGN,
      owner_id: OTHER,
      city_id: null,
      name: 'Synthetic',
      rules_edition: 'dnd_2014',
      revision: 1,
    },
    members: page([{ campaign_id: CAMPAIGN, user_id: USER, role: 'player' }]),
    sessions: page([session(SESSION_A)]),
    journal: page([journal('j1', SESSION_A)]),
    scenes: page([]),
  });

  const overview = await loadCampaignOverview(context, CAMPAIGN);

  assert.equal(overview.campaign.id, CAMPAIGN);
  assert.equal(overview.role, 'player');
  assert.equal(overview.memberCount, 1);
  assert.equal(overview.recaps[0].entries.length, 1);
  assert.equal(overview.truncated, false);
});

test('an owner keeps the dm role when the member page stops before their row', async () => {
  const context = routedContext({
    campaign: {
      id: CAMPAIGN,
      owner_id: USER,
      city_id: null,
      name: 'Synthetic',
      rules_edition: 'dnd_2014',
      revision: 1,
    },
    members: page([{ campaign_id: CAMPAIGN, user_id: OTHER, role: 'player' }]),
    sessions: page([]),
    journal: page([]),
    scenes: page([]),
  });

  const overview = await loadCampaignOverview(context, CAMPAIGN);

  assert.equal(overview.role, 'dm');
});

test('one failing list fails the overview instead of showing a partial campaign', async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const denied = String(input).includes('/journal');
    return denied ? jsonResponse({ code: 'not_found', message: 'x' }, 404) : jsonResponse(page([]));
  }) as unknown as typeof fetch;

  await assert.rejects(
    loadCampaignOverview({ identity: USER, fetch: fetchImpl }, CAMPAIGN),
    (error: unknown) => error instanceof ApiRequestError && error.status === 404,
  );
});

test('a player whose control was never hidden still gets the server refusal', async () => {
  const fetchImpl = (async () =>
    jsonResponse(
      { code: 'forbidden', message: 'x', request_id: 'req-9' },
      403,
    )) as unknown as typeof fetch;

  await assert.rejects(
    createSession({ identity: USER, fetch: fetchImpl }, CAMPAIGN, { title: 'Forged' }),
    (error: unknown) => {
      const report = describeFailure(error, true);
      assert.equal(report.kind, 'forbidden');
      assert.equal(report.requestId, 'req-9');
      return true;
    },
  );
});

test('failures map to one actionable kind each', () => {
  assert.equal(describeFailure(apiError(400), true).kind, 'invalid');
  assert.equal(describeFailure(apiError(401), true).kind, 'unauthenticated');
  assert.equal(describeFailure(apiError(403), true).kind, 'forbidden');
  assert.equal(describeFailure(apiError(404), true).kind, 'not_found');
  assert.equal(describeFailure(apiError(409), true).kind, 'conflict');
  assert.equal(describeFailure(apiError(500), true).kind, 'server');
  assert.equal(describeFailure(apiError(405), true).kind, 'server');
  assert.equal(describeFailure(new TypeError('fetch failed'), true).kind, 'unreachable');
  assert.equal(describeFailure(new TypeError('fetch failed'), false).kind, 'offline');
  assert.equal(describeFailure(new Error('other'), true).kind, 'server');
  assert.equal(describeFailure(new TypeError('x'), true).requestId, null);
  assert.ok(describeFailure(apiError(403), true).message.length > 0);
});

test('isAbort recognizes only aborted requests', () => {
  assert.equal(isAbort(new DOMException('stopped', 'AbortError')), true);
  assert.equal(isAbort(new TypeError('network')), false);
  assert.equal(isAbort(null), false);
});

test('campaign names are checked with the server limits', () => {
  assert.equal(validateName('   '), 'form.name_required');
  assert.equal(validateName('x'.repeat(121)), 'form.name_too_long');
  assert.equal(validateName(`  ${'x'.repeat(120)}  `), null);
});

test('session titles use their own, longer server limit', () => {
  assert.equal(validateTitle('   '), 'form.title_required');
  assert.equal(validateTitle('x'.repeat(200)), null);
  assert.equal(validateTitle('x'.repeat(201)), 'form.title_too_long');
});

test('a new campaign is trimmed and does not reference an unseeded catalog city', () => {
  assert.deepEqual(newCampaign('  Synthetic  ', 'dnd_2024'), {
    name: 'Synthetic',
    rules_edition: 'dnd_2024',
    city_id: null,
  });
});

test('the API context calls fetch unbound and keeps identity with a new signal', async () => {
  const original = globalThis.fetch;
  let receiver: unknown = 'unset';
  globalThis.fetch = async function (this: unknown): Promise<Response> {
    receiver = this;
    return new Response();
  } as typeof fetch;
  try {
    const context = createApiContext(USER);
    await context.fetch('/x');
    assert.notEqual(receiver, context);
  } finally {
    globalThis.fetch = original;
  }

  const signal = new AbortController().signal;
  const scoped = withSignal(createApiContext(USER), signal);
  assert.equal(scoped.identity, USER);
  assert.equal(scoped.signal, signal);
});

test('the development identity is reused, created when absent and replaced when invalid', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };

  assert.equal(resolveDevIdentity(storage, () => USER), USER);
  assert.equal(values.get(IDENTITY_KEY), USER);
  assert.equal(resolveDevIdentity(storage, () => OTHER), USER);
  values.set(IDENTITY_KEY, 'not-a-uuid');
  assert.equal(resolveDevIdentity(storage, () => OTHER), OTHER);
});

test('a created identity is a canonical v4 UUID that survives being stored', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  const created = resolveDevIdentity(storage, createDevIdentity);

  assert.match(created, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(resolveDevIdentity(storage, () => OTHER), created);
  assert.notEqual(createDevIdentity(), created);
});

test('unusable storage still yields a working identity for the session', (context) => {
  context.mock.method(console, 'warn', () => undefined);
  const broken = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  assert.equal(resolveDevIdentity(broken, () => USER), USER);
});

test('a city is resolved by id, null uses the default and unknown yields no map', () => {
  const first = { name: 'First' } as MapDefinition;
  const second = { name: 'Second' } as MapDefinition;
  const cities = [
    { id: 'city-1', map: first },
    { id: 'city-2', map: second },
  ];

  assert.equal(resolveCityMap(cities, 'city-2'), second);
  assert.equal(resolveCityMap(cities, null), first);
  assert.equal(resolveCityMap(cities, 'city-3'), null);
  assert.equal(resolveCityMap([], null), null);
});

test('connection state prefers the browser flag over a stale probe', () => {
  assert.equal(connectionState(false, true), 'offline');
  assert.equal(connectionState(true, null), 'checking');
  assert.equal(connectionState(true, true), 'online');
  assert.equal(connectionState(true, false), 'server_down');
});

test('the probe accepts only a recognized healthy answer', async () => {
  const signal = new AbortController().signal;
  const answering = (body: unknown, status = 200) =>
    (async () => jsonResponse(body, status)) as unknown as typeof fetch;
  const healthy = { service: 'desire-api', status: 'ok', scope: 'liveness', protocol_version: 1 };

  assert.equal(await probeServer(answering(healthy), signal), true);
  assert.equal(await probeServer(answering({ service: 'other' }), signal), false);
  assert.equal(await probeServer(answering(healthy, 503), signal), false);
});

test('messages substitute parameters and leave unknown ones visible', () => {
  assert.ok(t('summary.members', { count: 3 }).includes('3'));
  assert.ok(t('summary.members').includes('{count}'));
});

test('the copy catalog has no blank message', () => {
  for (const [key, value] of Object.entries(catalog)) {
    assert.ok(value.trim().length > 0, key);
  }
});
