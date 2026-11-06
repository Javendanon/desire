// Stub API for the campaign hub browser gate. Vite proxies /api to API_PORT; the test flips
// `state.mode` and reloads the page to exercise the empty and error copy.
import { createServer } from 'node:http';

export const API_PORT = 3001;
export const PLACE = 'castle-waterdeep';
export const USER = '00000000-0000-4000-8000-00000000005a';
export const ALFA = '00000000-0000-4000-8000-00000000000a';
export const BETA = '00000000-0000-4000-8000-00000000000b';
export const GAMMA = '00000000-0000-4000-8000-00000000000c';
export const SESSION = '00000000-0000-4000-8000-0000000000s1';

export const state = { mode: 'data' };
const campaigns = [campaign(ALFA, 'Alfa'), campaign(BETA, 'Beta')];

function campaign(id, name) {
  return { id, owner_id: USER, city_id: null, name, rules_edition: 'dnd_2014', revision: 1 };
}

function pageOf(items) {
  return { items, limit: 100, offset: 0, has_more: false };
}

function problem() {
  return { code: 'server', message: 'stub failure', request_id: 'req-stub' };
}

function collection(id, name) {
  if (name === 'members') {
    return pageOf([{ campaign_id: id, user_id: USER, role: 'dm' }]);
  }
  if (name === 'sessions') {
    return pageOf([{ id: SESSION, campaign_id: id, title: 'Sesión uno', revision: 1 }]);
  }
  if (name === 'journal') {
    return pageOf([{
      id: '00000000-0000-4000-8000-0000000000j1',
      campaign_id: id,
      session_id: SESSION,
      body: 'Resumen de la sesión.',
      visibility: 'players',
      revision: 1,
    }]);
  }
  return pageOf([]);
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

export function createStubApi() {
  return createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/api/health') {
      return sendJson(response, 200, {
        service: 'desire-api', status: 'ok', scope: 'stub', protocol_version: 1,
      });
    }
    if (path === '/api/v1/campaigns' && request.method === 'POST') {
      const body = await readJson(request);
      const created = campaign(GAMMA, body.name ?? 'Gamma');
      campaigns.push(created);
      return sendJson(response, 201, created);
    }
    if (path === '/api/v1/campaigns') {
      if (state.mode === 'error') return sendJson(response, 500, problem());
      return sendJson(response, 200, pageOf(state.mode === 'empty' ? [] : campaigns));
    }
    const match = path.match(/^\/api\/v1\/campaigns\/([^/]+)(?:\/([^/]+))?$/);
    if (!match) return sendJson(response, 404, problem());
    const id = match[1];
    const found = campaigns.find((entry) => entry.id === id) ?? campaign(id, 'Campaña');
    return sendJson(response, 200, match[2] ? collection(id, match[2]) : found);
  });
}
