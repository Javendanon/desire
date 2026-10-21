<!--
  Thin host for the table viewer: owns the canvas, creates the viewer on mount, destroys it on
  unmount, shows loading and errors. Everything per-frame stays inside the engine. This component
  only forwards prop changes as viewer calls and viewer events as callbacks.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  import {
    createViewer,
    type Level,
    type PieceSpec,
    type Quality,
    type TableViewer,
    type TimeOfDay,
  } from './viewer.ts';

  interface Props {
    level: Level;
    district?: string;
    pieces?: readonly PieceSpec[];
    fallen?: readonly string[];
    turnId?: string;
    selectedId?: string;
    moveSteps?: number | null;
    quality?: Quality;
    timeOfDay?: TimeOfDay;
    fog?: number;
    onready?: (viewer: TableViewer) => void;
    ondistrict?: (id: string) => void;
    onhover?: (id: string | null) => void;
    onpiece?: (id: string) => void;
    oncell?: (cell: number) => void;
    onzoom?: (level: Level) => void;
    onintroend?: () => void;
  }

  let {
    level,
    district = 'harbor',
    pieces = [],
    fallen = [],
    turnId = '',
    selectedId = '',
    moveSteps = null,
    quality = 'high',
    timeOfDay = 'dusk',
    fog = 0.45,
    ...callbacks
  }: Props = $props();

  const CANVAS_LABEL =
    'Mesa en tres dimensiones: la ciudad, el puerto y la escena con miniaturas sobre un tablero ' +
    'de hexágonos. Arrastra o usa las flechas para girar; rueda, pellizco o las teclas más y ' +
    'menos para acercar y alejar.';

  let canvas: HTMLCanvasElement;
  let viewer = $state<TableViewer | null>(null);
  let error = $state('');

  onMount(() => {
    let disposed = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    createViewer(canvas, { quality, timeOfDay, fog, reducedMotion })
      .then((created) => {
        if (disposed) {
          created.destroy();
          return;
        }
        wire(created);
        viewer = created;
        callbacks.onready?.(created);
      })
      .catch((reason: unknown) => {
        error = reason instanceof Error ? reason.message : String(reason);
      });
    return () => {
      disposed = true;
      viewer?.destroy();
      viewer = null;
    };
  });

  function wire(v: TableViewer): void {
    v.on('district', (id) => callbacks.ondistrict?.(id));
    v.on('hover', (id) => callbacks.onhover?.(id));
    v.on('piece', (id) => callbacks.onpiece?.(id));
    v.on('cell', (cell) => callbacks.oncell?.(cell));
    v.on('zoom', (next) => callbacks.onzoom?.(next));
    v.on('introEnd', () => callbacks.onintroend?.());
  }

  $effect(() => viewer?.setLevel(level, district));
  $effect(() => viewer?.setPieces(pieces));
  $effect(() => {
    if (!viewer) return;
    for (const piece of pieces) viewer.setFallen(piece.id, fallen.includes(piece.id));
  });
  $effect(() => viewer?.setTurn(turnId));
  $effect(() => viewer?.setSelected(selectedId));
  $effect(() => viewer?.setMoveMode(moveSteps));
  $effect(() => viewer?.setMood(timeOfDay, fog));
</script>

<div class="host">
  <canvas
    bind:this={canvas}
    class="canvas"
    tabindex="0"
    aria-label={CANVAS_LABEL}
  ></canvas>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if !viewer}
    <p class="loading" aria-live="polite">Preparando la mesa…</p>
  {:else}
    <p class="label">{viewer.label}</p>
  {/if}
</div>

<style>
  .host {
    position: absolute;
    inset: 0;
    background: var(--color-dusk, #2e2b33);
  }

  .canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }

  .canvas:focus-visible {
    outline: 2px solid var(--color-lantern, #e0aa4f);
    outline-offset: -4px;
  }

  .error,
  .loading {
    position: absolute;
    inset: 0;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6, 28px);
    text-align: center;
    font-family: var(--font-display, serif);
    font-size: var(--text-voice, 21px);
    color: var(--color-mist, #c9cfc8);
  }

  .label {
    position: absolute;
    left: var(--space-6, 28px);
    bottom: 6px;
    margin: 0;
    font-family: var(--font-label, sans-serif);
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--color-ash, #a7b2b4);
    pointer-events: none;
  }

  @media (max-width: 600px) {
    .label {
      left: var(--space-4, 16px);
      bottom: 112px;
    }
  }
</style>
