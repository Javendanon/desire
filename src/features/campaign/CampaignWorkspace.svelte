<!--
  One campaign's screens. App.svelte keys this component by campaign id, so opening another one
  destroys all of this state. The atlas stays mounted while hidden to keep its camera.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  import FailureNotice from '../../app/FailureNotice.svelte';
  import { LatestLoader, type LoadState } from '../../app/latest-loader.ts';
  import { t, type MessageKey } from '../../app/messages.ts';
  import {
    formatRoute,
    HUB_ROUTE,
    withPanel,
    type CampaignPanel,
    type CampaignRoute,
    type Route,
  } from '../../app/routes.ts';
  import StatusNotice from '../../app/StatusNotice.svelte';
  import type { Id } from '../../generated/contracts.ts';
  import type { ApiContext } from '../../lib/api/client.ts';
  import LorePanel from '../knowledge/LorePanel.svelte';
  import { withSignal } from './api-context.ts';
  import AtlasPanel from './AtlasPanel.svelte';
  import { loadCampaignOverview, type CampaignOverview } from './overview.ts';
  import SessionSummary from './SessionSummary.svelte';

  interface Props {
    api: ApiContext;
    route: CampaignRoute;
    onnavigate: (route: Route, options?: { replace?: boolean }) => void;
  }

  let { api, route, onnavigate }: Props = $props();

  const TABS: readonly { panel: CampaignPanel; label: MessageKey }[] = [
    { panel: 'summary', label: 'nav.summary' },
    { panel: 'atlas', label: 'nav.atlas' },
    { panel: 'lore', label: 'nav.lore' },
    { panel: 'table', label: 'nav.table' },
  ];

  let load = $state<LoadState<Id, CampaignOverview>>({ status: 'idle' });
  let atlasOpened = $state(false);
  let refreshFailure = $state<unknown>(null);

  const loader = new LatestLoader<Id, CampaignOverview>(
    (id, signal) => loadCampaignOverview(withSignal(api, signal), id),
    (next) => (load = next),
  );

  onMount(() => {
    loader.open(route.campaignId);
    return () => loader.dispose();
  });

  function refresh(): void {
    refreshFailure = null;
    loader.refresh((error) => (refreshFailure = error));
  }

  $effect(() => {
    if (route.panel === 'atlas') atlasOpened = true;
  });

  $effect(() => {
    if (load.status !== 'ready') return;
    document.title = `${load.value.campaign.name} · ${t('app.name')}`;
    return () => {
      document.title = t('app.title');
    };
  });
</script>

{#if load.status === 'ready'}
  {@const overview = load.value}
  <div class="workspace">
    <header class="heading">
      <h1 class="name">{overview.campaign.name}</h1>
      <a class="action" href={formatRoute(HUB_ROUTE)}>{t('nav.change_campaign')}</a>
    </header>
    <nav class="tabs" aria-label={t('nav.label')}>
      {#each TABS as tab (tab.panel)}
        <a
          class="tab"
          href={formatRoute(withPanel(route, tab.panel))}
          aria-current={route.panel === tab.panel ? 'page' : undefined}
        >
          {t(tab.label)}
        </a>
      {/each}
    </nav>
    {#if refreshFailure}
      <FailureNotice
        error={refreshFailure}
        title={t('campaign.refresh_failed')}
        onretry={refresh}
      />
    {/if}
    <div class="stage">
      {#if route.panel === 'summary'}
        <SessionSummary {api} {route} {overview} onchanged={refresh} />
      {:else if route.panel === 'lore'}
        <LorePanel {api} {route} campaign={overview.campaign} {onnavigate} />
      {:else if route.panel === 'table'}
        {#await import('./TablePanel.svelte')}
          <div class="state"><StatusNotice title={t('table.loading')} /></div>
        {:then { default: TablePanel }}
          <TablePanel {route} scenes={overview.scenes} truncated={overview.truncated} />
        {:catch error}
          <div class="state"><FailureNotice {error} title={t('table.load_failed')} /></div>
        {/await}
      {/if}
      {#if atlasOpened}
        <div class="atlas" class:parked={route.panel !== 'atlas'}>
          <AtlasPanel {route} cityId={overview.campaign.city_id} {onnavigate} />
        </div>
      {/if}
    </div>
  </div>
{:else if load.status === 'failed'}
  <div class="state">
    <FailureNotice
      error={load.error}
      title={t('campaign.load_failed')}
      onretry={() => loader.reload()}
    />
    <a class="action" href={formatRoute(HUB_ROUTE)}>{t('route.back_to_hub')}</a>
  </div>
{:else}
  <div class="state"><StatusNotice title={t('campaign.loading')} /></div>
{/if}

<style>
  .workspace {
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    min-height: calc(100vh - 70px);
  }

  .heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }

  .name {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-name);
    font-weight: 400;
    overflow-wrap: anywhere;
  }

  .tabs {
    display: flex;
    gap: var(--space-1);
    padding: 0 var(--space-4);
    overflow-x: auto;
    border-bottom: 1px solid var(--color-rule);
  }

  .tab {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-height);
    padding: 0 var(--space-3);
    border-bottom: 2px solid transparent;
    color: var(--color-mist);
    font-family: var(--font-label);
    letter-spacing: 0.06em;
    text-decoration: none;
    white-space: nowrap;
  }

  .tab[aria-current='page'] {
    border-bottom-color: var(--color-lantern);
    color: var(--color-parchment);
  }

  /* Fixed row: the refresh notice above it comes and goes without shifting the stage's track. */
  .stage {
    grid-row: 4;
    position: relative;
    min-height: 0;
  }

  .atlas {
    height: 100%;
  }

  /* Keeps layout size so the viewer's canvas is not resized to zero, and hides it from AT. */
  .parked {
    position: absolute;
    inset: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }

  .state {
    display: grid;
    justify-items: start;
    gap: var(--space-3);
    max-width: 40rem;
    margin: var(--space-7) auto;
    padding: 0 var(--space-4);
  }
</style>
