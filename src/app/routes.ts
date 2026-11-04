// Hash routes for the app shell. The URL owns the campaign and its search/map context, so
// reloading or going back restores them and one campaign's context cannot reach another.
import type { Id } from '../generated/contracts.ts';

export type CampaignPanel = 'summary' | 'atlas' | 'lore' | 'table';

export interface CampaignContext {
  place: string | null;
  query: string;
  entry: string | null;
  kind: string | null;
}

export interface CampaignRoute {
  view: 'campaign';
  campaignId: Id;
  panel: CampaignPanel;
  context: CampaignContext;
}

export type Route = { view: 'hub' } | CampaignRoute | { view: 'missing' };

export type FocusTarget = { kind: 'main' } | { kind: 'place'; placeId: string } | null;

export const HUB_ROUTE: Route = { view: 'hub' };

const CAMPAIGNS_SEGMENT = 'campaigns';
const PANELS: readonly CampaignPanel[] = ['summary', 'atlas', 'lore', 'table'];
const EMPTY_CONTEXT: CampaignContext = { place: null, query: '', entry: null, kind: null };

/** The shell's main region, the fallback target whenever focus has nowhere better to go. */
export const MAIN_CONTENT_ID = 'content';

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape is an unknown address; the caller renders the missing view.
    return null;
  }
}

function parsePanel(segment: string | undefined): CampaignPanel | null {
  if (segment === undefined) return 'summary';
  return PANELS.find((panel) => panel === segment) ?? null;
}

function parseContext(search: string): CampaignContext {
  const params = new URLSearchParams(search);
  return {
    place: params.get('place') || null,
    query: params.get('q') ?? '',
    entry: params.get('entry') || null,
    kind: params.get('kind') || null,
  };
}

export function parseRoute(hash: string): Route {
  const [path, search = ''] = hash.replace(/^#/, '').split('?', 2);
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return HUB_ROUTE;
  if (segments[0] !== CAMPAIGNS_SEGMENT || segments.length > 3) return { view: 'missing' };
  if (segments.length === 1) return HUB_ROUTE;
  const campaignId = decodeSegment(segments[1]);
  const panel = parsePanel(segments[2]);
  if (!campaignId || !panel) return { view: 'missing' };
  return { view: 'campaign', campaignId, panel, context: parseContext(search) };
}

function formatContext(context: CampaignContext): string {
  const params = new URLSearchParams();
  if (context.place) params.set('place', context.place);
  if (context.query) params.set('q', context.query);
  if (context.entry) params.set('entry', context.entry);
  if (context.kind) params.set('kind', context.kind);
  const search = params.toString();
  return search ? `?${search}` : '';
}

export function formatRoute(route: Route): string {
  if (route.view !== 'campaign') return `#/${CAMPAIGNS_SEGMENT}`;
  const id = encodeURIComponent(route.campaignId);
  return `#/${CAMPAIGNS_SEGMENT}/${id}/${route.panel}${formatContext(route.context)}`;
}

/** Opening a campaign always starts from an empty context: nothing carries over from another. */
export function openCampaign(campaignId: Id): CampaignRoute {
  return { view: 'campaign', campaignId, panel: 'summary', context: EMPTY_CONTEXT };
}

export function withPanel(route: CampaignRoute, panel: CampaignPanel): CampaignRoute {
  return { ...route, panel };
}

export function withContext(
  route: CampaignRoute,
  patch: Partial<CampaignContext>,
): CampaignRoute {
  return { ...route, context: { ...route.context, ...patch } };
}

function screenKey(route: Route): string {
  return route.view === 'campaign' ? `${route.campaignId}/${route.panel}` : route.view;
}

/** Where focus goes after navigating. Context edits such as typing a query must not move it. */
export function focusTarget(previous: Route, next: Route): FocusTarget {
  if (screenKey(previous) === screenKey(next)) return null;
  if (next.view === 'campaign' && next.panel === 'atlas' && next.context.place) {
    return { kind: 'place', placeId: next.context.place };
  }
  return { kind: 'main' };
}

export function placeButtonId(placeId: string): string {
  return `atlas-place-${placeId}`;
}
