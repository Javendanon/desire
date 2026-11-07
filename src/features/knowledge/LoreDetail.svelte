<!-- One lore entry, read like a page of the story rather than a wiki infobox. -->
<script lang="ts">
  import { t } from '../../app/messages.ts';
  import type { LoreEntry } from './lore-index.ts';
  import { kindLabelKey } from './lore-view.ts';

  interface Props {
    entry: LoreEntry;
    mapHref: string;
    element?: HTMLElement;
  }

  let { entry, mapHref, element = $bindable() }: Props = $props();
</script>

<article bind:this={element} class="panel detail" tabindex="-1" aria-labelledby="lore-entry-title">
  <p class="kind">
    {t(kindLabelKey(entry.kind))}
    {#if entry.visibility === 'dm'} · {t('visibility.dm')}{/if}
  </p>
  <h3 id="lore-entry-title" class="title">{entry.title}</h3>
  <p class="body">{entry.body || t('lore.place_no_text')}</p>
  {#if entry.attribution}<p class="attribution">{entry.attribution}</p>{/if}
  {#if entry.placeId}<a class="action primary" href={mapHref}>{t('lore.show_on_map')}</a>{/if}
</article>

<style>
  .detail {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
  }

  .kind {
    margin: 0;
    color: var(--color-lantern);
    font-family: var(--font-label);
    font-size: var(--text-label);
    letter-spacing: var(--tracking-label);
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-name);
    font-weight: 400;
    overflow-wrap: anywhere;
  }

  .body {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-body);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .attribution {
    margin: 0;
    color: var(--color-ash);
    font-size: var(--text-ui-sm);
    overflow-wrap: anywhere;
  }
</style>
