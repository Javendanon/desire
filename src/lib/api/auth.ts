// Browser navigation starts OIDC; provider and session tokens never enter JavaScript.
import type { AuthIdentity, Id, SyncBatch } from '../../generated/contracts.ts';
import { API_BASE, type ApiContext, request, resourcePath } from './client.ts';

export function loginUrl(context: Pick<ApiContext, 'baseUrl'> = {}): string {
  return `${context.baseUrl ?? ''}${API_BASE}/auth/login`;
}

export function getIdentity(context: ApiContext): Promise<AuthIdentity> {
  return request(context, { method: 'GET', path: '/auth/identity' });
}

export function logout(context: ApiContext): Promise<void> {
  return request(context, { method: 'DELETE', path: '/auth/sessions/current' });
}

export function syncCampaign(
  context: ApiContext,
  campaignId: Id,
  after?: number,
): Promise<SyncBatch> {
  const base = `${resourcePath('/campaigns', campaignId)}/sync`;
  const suffix = after === undefined ? '' : `?after=${encodeURIComponent(after)}`;
  return request(context, { method: 'GET', path: `${base}${suffix}` });
}
