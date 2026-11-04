<!-- The campaign's city: 3D map plus a list of places that does the same job by keyboard. -->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';

  import { loadCampaignMap } from '../../app/cities.ts';
  import FailureNotice from '../../app/FailureNotice.svelte';
  import { LatestLoader, type LoadState } from '../../app/latest-loader.ts';
  import { t } from '../../app/messages.ts';
  import {
    formatRoute,
    placeButtonId,
    withContext,
    withPanel,
    type CampaignRoute,
    type Route,
  } from '../../app/routes.ts';
  import StatusNotice from '../../app/StatusNotice.svelte';
  import type { Id } from '../../generated/contracts.ts';
  import type { MapDefinition } from '../../lib/engine/plan/map-definition.ts';
  import MapCanvas from './MapCanvas.svelte';

  interface Props {
    route: CampaignRoute;
    cityId: Id | null;
    onnavigate: (route: Route) => void;
  }

  let { route, cityId, onnavigate }: Props = $props();

  const MAP_KEY = 'map';

  let load = $state<LoadState<string, MapDefinition | null>>({ status: 'idle' });
  const loader = new LatestLoader<string, MapDefinition | null>(
    () => loadCampaignMap(cityId),
    (next) => (load = next),
  );

  onMount(() => {
    loader.open(MAP_KEY);
    return () => loader.dispose();
  });

  const map = $derived(load.status === 'ready' ? load.value : null);
  const selected = $derived(map?.places.find((place) => place.id === route.context.place) ?? null);

  function selectPlace(placeId: string): void {
    onnavigate(withPanel(withContext(route, { place: placeId }), 'atlas'));
  }

  // A search from a place starts clean: an old kind filter could hide that place's own result.
  const loreRoute = $derived(
    withPanel(withContext(route, { query: selected?.name ?? '', entry: null, kind: null }), 'lore'),
  );

  // On a first visit the list appears after App has already moved focus; finish that move here.
  $effect(() => {
    if (!map) return;
    const placeId = untrack(() => (route.panel === 'atlas' ? route.context.place : null));
    if (!placeId) return;
    void tick().then(() => document.getElementById(placeButtonId(placeId))?.focus());
  });
</script>

{#if map}
  <div class="atlas">
    <MapCanvas {map} selected={selected?.id ?? null} onplace={selectPlace} />
    <aside class="panel places" aria-labelledby="atlas-places">
      <h2 id="atlas-places" class="panel-title">{t('atlas.places', { map: map.name })}</h2>
      {#if selected}
        <div class="selected" role="status">
          <p class="selected-name">{selected.name}</p>
          {#if selected.sourceRef}<p class="source">{selected.sourceRef}</p>{/if}
          <a class="action" href={formatRoute(loreRoute)}>{t('atlas.search_lore')}</a>
        </div>
      {/if}
      {#if map.places.length === 0}
        <StatusNotice title={t('atlas.no_places')} />
      {:else}
        <ul class="plain-list">
          {#each map.places as place (place.id)}
            <li>
              <button
                id={placeButtonId(place.id)}
                class="action place"
                type="button"
                aria-pressed={place.id === selected?.id}
                onclick={() => selectPlace(place.id)}
              >
                {place.name}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>
  </div>
{:else if load.status === 'ready'}
  <div class="state"><StatusNotice tone="error" title={t('atlas.no_map')} /></div>
{:else if load.status === 'failed'}
  <div class="state">
    <FailureNotice
      error={load.error}
      title={t('atlas.load_failed')}
      onretry={() => loader.reload()}
    />
  </div>
{:else}
  <div class="state"><StatusNotice title={t('atlas.loading')} /></div>
{/if}

<style>
  .atlas {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 20rem;
    height: 100%;
    min-height: 32rem;
  }

  .places {
    max-height: calc(100vh - 170px);
    overflow-y: auto;
    border-width: 0 0 0 1px;
    border-radius: 0;
  }

  .selected {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-rule);
  }

  .selected-name {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-voice);
  }

  .source {
    margin: 0;
    color: var(--color-mist);
    font-size: var(--text-ui-sm);
    overflow-wrap: anywhere;
  }

  .place {
    justify-content: flex-start;
    width: 100%;
    text-align: left;
  }

  .place[aria-pressed='true'] {
    border-color: var(--color-lantern);
    background: var(--color-lantern-shadow);
  }

  .state {
    padding: var(--space-4);
  }

  @media (max-width: 760px) {
    .atlas {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: 55vh auto;
      height: auto;
    }

    .places {
      max-height: none;
      border-width: 1px 0 0;
    }
  }
</style>
