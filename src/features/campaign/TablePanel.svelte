<!--
  Entrance to the table: mounts the D11 viewer and lists the campaign's scenes. Miniatures, turns
  and encounters belong to D16 and D17; this panel adds no game rules.
-->
<script lang="ts">
  import { t } from '../../app/messages.ts';
  import {
    formatRoute,
    withPanel,
    type CampaignRoute,
  } from '../../app/routes.ts';
  import type { Scene } from '../../generated/contracts.ts';
  import ViewerHost from '../../lib/engine/ViewerHost.svelte';
  import type { Level } from '../../lib/engine/viewer.ts';

  interface Props {
    route: CampaignRoute;
    scenes: readonly Scene[];
    truncated: boolean;
  }

  let { route, scenes, truncated }: Props = $props();

  const SCENE_LEVEL: Level = 2;

  let level = $state<Level>(SCENE_LEVEL);
</script>

<div class="table">
  <ViewerHost {level} onzoom={(next) => (level = next)} />
  <aside class="panel scenes" aria-labelledby="table-scenes">
    <h2 id="table-scenes" class="panel-title">{t('table.scenes')}</h2>
    {#if scenes.length === 0}
      <p class="muted">{t('table.no_scenes')}</p>
    {:else}
      <ul class="plain-list">
        {#each scenes as scene (scene.id)}
          <li>{scene.name}</li>
        {/each}
      </ul>
    {/if}
    {#if truncated}<p class="muted">{t('list.truncated')}</p>{/if}
    <p class="muted">{t('table.pending')}</p>
    <a class="action" href={formatRoute(withPanel(route, 'atlas'))}>{t('table.back_to_atlas')}</a>
  </aside>
</div>

<style>
  .table {
    position: relative;
    height: 100%;
    min-height: 32rem;
  }

  .scenes {
    position: absolute;
    top: var(--space-4);
    left: var(--space-4);
    width: min(22rem, calc(100% - 2 * var(--space-4)));
    max-height: calc(100% - 2 * var(--space-4));
    overflow-y: auto;
  }

  .muted {
    margin: var(--space-2) 0 var(--space-3);
    color: var(--color-mist);
  }
</style>
