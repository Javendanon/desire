<!-- Lore search. Query and open entry live in the route, so a trip to the map keeps them. -->
<script lang="ts">
  import { onMount, tick } from 'svelte';

  import { loadCampaignMap } from '../../app/cities.ts';
  import FailureNotice from '../../app/FailureNotice.svelte';
  import { LatestLoader, type LoadState } from '../../app/latest-loader.ts';
  import { t } from '../../app/messages.ts';
  import {
    formatRoute,
    withContext,
    type CampaignRoute,
    type Route,
  } from '../../app/routes.ts';
  import StatusNotice from '../../app/StatusNotice.svelte';
  import type { Campaign } from '../../generated/contracts.ts';
  import { listKnowledge } from '../../lib/api/campaigns.ts';
  import type { ApiContext } from '../../lib/api/client.ts';
  import { withSignal } from '../campaign/api-context.ts';
  import { collectPages } from '../campaign/pages.ts';
  import {
    ALL_KINDS,
    loreKinds,
    resolveKind,
    searchLore,
    type LoreEntry,
  } from './lore-index.ts';
  import { collectLore, loadCompendium, type LoreCollection } from './lore-sources.ts';
  import LoreDetail from './LoreDetail.svelte';
  import { kindLabelKey, mapRouteFor } from './lore-view.ts';

  interface Props {
    api: ApiContext;
    route: CampaignRoute;
    campaign: Campaign;
    onnavigate: (route: Route, options?: { replace?: boolean }) => void;
  }

  let { api, route, campaign, onnavigate }: Props = $props();

  const LORE_KEY = 'lore';

  let load = $state.raw<LoadState<string, LoreCollection>>({ status: 'idle' });
  let detail = $state<HTMLElement>();

  async function gather(signal: AbortSignal): Promise<LoreCollection> {
    const context = withSignal(api, signal);
    return collectLore(
      { cityId: campaign.city_id, rulesEdition: campaign.rules_edition },
      {
        loadPlaces: async (cityId) => (await loadCampaignMap(cityId))?.places ?? [],
        loadCompendium,
        loadNotes: () => collectPages((page) => listKnowledge(context, campaign.id, page)),
      },
    );
  }

  const loader = new LatestLoader<string, LoreCollection>(
    (_key, signal) => gather(signal),
    (next) => (load = next),
  );

  onMount(() => {
    loader.open(LORE_KEY);
    return () => loader.dispose();
  });

  const index = $derived(load.status === 'ready' ? load.value.index : []);
  const kind = $derived(resolveKind(index, route.context.kind));
  const results = $derived(searchLore(index, route.context.query, kind));
  const open = $derived(index.find((entry) => entry.key === route.context.entry) ?? null);

  function typeQuery(event: Event): void {
    const query = (event.currentTarget as HTMLInputElement).value;
    onnavigate(withContext(route, { query, entry: null }), { replace: true });
  }

  function chooseKind(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    const next = value === ALL_KINDS ? null : value;
    onnavigate(withContext(route, { kind: next, entry: null }), { replace: true });
  }

  function openEntry(entry: LoreEntry): void {
    onnavigate(withContext(route, { entry: entry.key }), { replace: true });
    void tick().then(() => detail?.focus());
  }
</script>

<div class="lore">
  <section class="panel search" aria-labelledby="lore-title">
    <h2 id="lore-title" class="panel-title">{t('lore.title')}</h2>
    <form class="filters" role="search" onsubmit={(event) => event.preventDefault()}>
      <div class="field">
        <label for="lore-query">{t('lore.query_label')}</label>
        <input
          id="lore-query"
          type="search"
          autocomplete="off"
          value={route.context.query}
          oninput={typeQuery}
        />
      </div>
      <div class="field">
        <label for="lore-kind">{t('lore.kind_label')}</label>
        <select id="lore-kind" value={kind} onchange={chooseKind}>
          <option value={ALL_KINDS}>{t('kind.all')}</option>
          {#each loreKinds(index) as option (option)}
            <option value={option}>{t(kindLabelKey(option))}</option>
          {/each}
        </select>
      </div>
    </form>

    {#if load.status === 'ready'}
      {#if load.value.notesFailure}
        <FailureNotice
          error={load.value.notesFailure}
          title={t('lore.notes_failed')}
          onretry={() => loader.reload()}
        />
      {/if}
      {#if load.value.notesTruncated}<StatusNotice title={t('list.truncated')} />{/if}
      <p class="count" role="status">{t('lore.count', { count: results.length })}</p>
      {#if results.length === 0}
        <StatusNotice title={t('lore.no_results')} detail={t('lore.no_results_detail')} />
      {:else}
        <ul class="plain-list">
          {#each results as entry (entry.key)}
            <li>
              <button
                class="action result"
                type="button"
                aria-pressed={entry.key === open?.key}
                onclick={() => openEntry(entry)}
              >
                <span>{entry.title}</span>
                <span class="kind">{t(kindLabelKey(entry.kind))}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if load.status === 'failed'}
      <FailureNotice
        error={load.error}
        title={t('lore.load_failed')}
        onretry={() => loader.reload()}
      />
    {:else}
      <StatusNotice title={t('lore.loading')} />
    {/if}
  </section>

  <div class="reader">
    <a class="action back" href={formatRoute(mapRouteFor(route, null))}>
      {t('lore.back_to_map')}
    </a>
    {#if open}
      <LoreDetail
        bind:element={detail}
        entry={open}
        mapHref={formatRoute(mapRouteFor(route, open))}
      />
    {:else}
      <StatusNotice title={t('lore.pick_entry')} />
    {/if}
  </div>
</div>

<style>
  .lore {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    align-items: start;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .filters {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .count {
    margin: var(--space-2) 0;
    color: var(--color-mist);
    font-size: var(--text-ui-sm);
  }

  .result {
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    padding-block: var(--space-2);
    font-family: var(--font-ui);
    letter-spacing: 0;
    text-align: left;
  }

  .result[aria-pressed='true'] {
    border-color: var(--color-lantern);
    background: var(--color-lantern-shadow);
  }

  .kind {
    color: var(--color-ash);
    font-weight: 400;
  }

  .reader {
    display: grid;
    gap: var(--space-3);
  }

  .back {
    justify-self: start;
  }

  @media (max-width: 760px) {
    .lore,
    .filters {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
