<!-- Campaign selector: the caller's campaigns plus the form to create another. -->
<script lang="ts">
  import { onMount } from 'svelte';

  import FailureNotice from '../../app/FailureNotice.svelte';
  import { LatestLoader, type LoadState } from '../../app/latest-loader.ts';
  import { t } from '../../app/messages.ts';
  import { formatRoute, openCampaign, type Route } from '../../app/routes.ts';
  import StatusNotice from '../../app/StatusNotice.svelte';
  import type { Campaign } from '../../generated/contracts.ts';
  import { listCampaigns } from '../../lib/api/campaigns.ts';
  import type { ApiContext } from '../../lib/api/client.ts';
  import { withSignal } from './api-context.ts';
  import CampaignForm from './CampaignForm.svelte';
  import { EDITION_OPTIONS } from './forms.ts';
  import { collectPages, type Collected } from './pages.ts';

  interface Props {
    api: ApiContext;
    onnavigate: (route: Route) => void;
  }

  let { api, onnavigate }: Props = $props();

  const LIST_KEY = 'campaigns';

  let load = $state.raw<LoadState<string, Collected<Campaign>>>({ status: 'idle' });
  const loader = new LatestLoader<string, Collected<Campaign>>(
    (_key, signal) => collectPages((page) => listCampaigns(withSignal(api, signal), page)),
    (next) => (load = next),
  );

  onMount(() => {
    loader.open(LIST_KEY);
    return () => loader.dispose();
  });

  function editionLabel(campaign: Campaign): string {
    const option = EDITION_OPTIONS.find((entry) => entry.value === campaign.rules_edition);
    return option ? t(option.label) : campaign.rules_edition;
  }
</script>

<div class="hub">
  <section class="panel" aria-labelledby="hub-campaigns">
    <h1 id="hub-campaigns" class="panel-title">{t('hub.title')}</h1>
    {#if load.status === 'ready'}
      {#if load.value.items.length === 0}
        <StatusNotice title={t('hub.empty')} detail={t('hub.empty_detail')} />
      {:else}
        <ul class="plain-list">
          {#each load.value.items as campaign (campaign.id)}
            <li>
              <a class="campaign" href={formatRoute(openCampaign(campaign.id))}>
                <span class="name">{campaign.name}</span>
                <span class="edition">{editionLabel(campaign)}</span>
              </a>
            </li>
          {/each}
        </ul>
        {#if load.value.truncated}
          <StatusNotice title={t('list.truncated')} />
        {/if}
      {/if}
    {:else if load.status === 'failed'}
      <FailureNotice
        error={load.error}
        title={t('hub.load_failed')}
        onretry={() => loader.reload()}
      />
    {:else}
      <StatusNotice title={t('hub.loading')} />
    {/if}
  </section>

  <section class="panel" aria-labelledby="hub-create">
    <h2 id="hub-create" class="panel-title">{t('hub.create_title')}</h2>
    <CampaignForm
      {api}
      oncreated={(campaign) => onnavigate(openCampaign(campaign.id))}
      onfailed={() => loader.reload()}
    />
  </section>
</div>

<style>
  .hub {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    align-items: start;
    gap: var(--space-5);
    max-width: 70rem;
    margin: 0 auto;
    padding: var(--space-5) var(--space-4);
  }

  .campaign {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: var(--control-height);
    padding: var(--space-3);
    border: 1px solid var(--color-fog);
    border-radius: var(--radius);
    color: var(--color-parchment);
    text-decoration: none;
  }

  .campaign:hover {
    border-color: var(--color-lantern);
    color: var(--color-parchment);
  }

  .name {
    font-family: var(--font-display);
    font-size: var(--text-voice);
    overflow-wrap: anywhere;
  }

  .edition {
    color: var(--color-ash);
    font-size: var(--text-ui-sm);
  }

  @media (max-width: 760px) {
    .hub {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
