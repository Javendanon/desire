<!--
  Hosts the generic map viewer. The engine loads on first use so the campaign selector stays
  light, and a failure here leaves the atlas's place list fully usable.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  import { t } from '../../app/messages.ts';
  import type { MapViewer } from '../../lib/engine/map-viewer.ts';
  import type { MapDefinition } from '../../lib/engine/plan/map-definition.ts';

  interface Props {
    map: MapDefinition;
    selected: string | null;
    onplace: (placeId: string) => void;
  }

  let { map, selected, onplace }: Props = $props();

  let canvas = $state<HTMLCanvasElement>();
  let viewer = $state.raw<MapViewer | null>(null);
  let failed = $state(false);

  async function startViewer(target: HTMLCanvasElement): Promise<MapViewer> {
    const { createMapViewer } = await import('../../lib/engine/map-viewer.ts');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return createMapViewer(target, map, { reducedMotion });
  }

  onMount(() => {
    let disposed = false;
    if (!canvas) return;
    startViewer(canvas)
      .then((created) => {
        if (disposed) {
          created.destroy();
          return;
        }
        created.on('place', (place) => onplace(place.id));
        viewer = created;
      })
      .catch((reason: unknown) => {
        console.warn('Could not start the map viewer', reason);
        failed = true;
      });
    return () => {
      disposed = true;
      viewer?.destroy();
      viewer = null;
    };
  });

  $effect(() => {
    if (!viewer || !selected) return;
    viewer.selectPlace(selected);
    viewer.focusPlace(selected);
  });
</script>

<div class="host">
  <canvas
    bind:this={canvas}
    class="canvas"
    tabindex="0"
    aria-label={t('atlas.canvas_label', { map: map.name })}
  ></canvas>
  {#if failed}
    <p class="overlay" role="alert">{t('atlas.viewer_failed')}</p>
  {:else if !viewer}
    <p class="overlay" role="status">{t('atlas.viewer_loading')}</p>
  {/if}
</div>

<style>
  .host {
    position: relative;
    height: 100%;
    min-height: 16rem;
    background: var(--color-dusk);
  }

  .canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

  .canvas:focus-visible {
    outline: 2px solid var(--color-lantern);
    outline-offset: -4px;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: var(--space-5);
    color: var(--color-mist);
    font-family: var(--font-display);
    font-size: var(--text-voice);
    text-align: center;
    pointer-events: none;
  }
</style>
