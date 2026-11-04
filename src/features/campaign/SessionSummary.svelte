<!-- What a table needs before playing: sessions, recaps, scenes and where to go next. -->
<script lang="ts">
  import { t } from '../../app/messages.ts';
  import {
    formatRoute,
    withPanel,
    type CampaignRoute,
  } from '../../app/routes.ts';
  import StatusNotice from '../../app/StatusNotice.svelte';
  import type { ApiContext } from '../../lib/api/client.ts';
  import { canManage, type CampaignOverview } from './overview.ts';
  import SessionForm from './SessionForm.svelte';

  interface Props {
    api: ApiContext;
    route: CampaignRoute;
    overview: CampaignOverview;
    onchanged: () => void;
  }

  let { api, route, overview, onchanged }: Props = $props();

  const roleLabel = $derived.by(() => {
    if (overview.role === 'dm') return t('role.dm');
    return overview.role === 'player' ? t('role.player') : t('role.unknown');
  });
</script>

<div class="summary">
  <section class="panel sessions" aria-labelledby="summary-sessions">
    <h2 id="summary-sessions" class="panel-title">{t('summary.sessions')}</h2>
    {#if overview.recaps.length === 0}
      <StatusNotice title={t('summary.no_sessions')} />
    {:else}
      <ul class="plain-list">
        {#each overview.recaps as recap (recap.session.id)}
          <li class="session">
            <h3 class="session-title">{recap.session.title}</h3>
            {#if recap.entries.length === 0}
              <p class="muted">{t('summary.no_recap')}</p>
            {/if}
            {#each recap.entries as entry (entry.id)}
              <p class="recap">
                {#if entry.visibility === 'dm'}
                  <span class="dm-tag">{t('visibility.dm')}</span>
                {/if}
                {entry.body}
              </p>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
    {#if overview.truncated}<StatusNotice title={t('list.truncated')} />{/if}
  </section>

  <div class="side">
    <section class="panel" aria-labelledby="summary-next">
      <h2 id="summary-next" class="panel-title">{t('summary.next')}</h2>
      <p class="muted">
        {t('summary.role', { role: roleLabel })} ·
        {t('summary.members', { count: overview.memberCount })} ·
        {t('summary.scenes', { count: overview.scenes.length })}
      </p>
      <div class="links">
        <a class="action primary" href={formatRoute(withPanel(route, 'table'))}>
          {t('summary.go_table')}
        </a>
        <a class="action" href={formatRoute(withPanel(route, 'atlas'))}>
          {t('summary.go_atlas')}
        </a>
        <a class="action" href={formatRoute(withPanel(route, 'lore'))}>
          {t('summary.go_lore')}
        </a>
      </div>
    </section>
    {#if canManage(overview.role)}
      <section class="panel" aria-labelledby="summary-new-session">
        <h2 id="summary-new-session" class="panel-title">{t('session.new_title')}</h2>
        <SessionForm {api} campaignId={overview.campaign.id} oncreated={onchanged} />
      </section>
    {/if}
  </div>
</div>

<style>
  .summary {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    align-items: start;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .side,
  .links {
    display: grid;
    gap: var(--space-3);
  }

  .session {
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-rule);
  }

  .session-title {
    margin: 0 0 var(--space-1);
    font-family: var(--font-label);
    font-size: var(--text-body);
    overflow-wrap: anywhere;
  }

  .recap {
    margin: var(--space-1) 0;
    font-family: var(--font-display);
    font-size: var(--text-body);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .dm-tag {
    margin-right: var(--space-2);
    color: var(--color-lantern);
    font-family: var(--font-label);
    font-size: var(--text-label);
  }

  .muted {
    margin: 0 0 var(--space-3);
    color: var(--color-mist);
  }

  @media (max-width: 760px) {
    .summary {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
