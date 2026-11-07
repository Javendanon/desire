<!-- Optional campaign entry: an illustrated scroll prologue over one existing illustration. The
     table stays mounted underneath. The skip button and Escape leave at any time, and a static
     scene replaces the scroll when motion is reduced or the image never arrives. -->
<script lang="ts">
  import { onMount } from 'svelte';

  import { t } from '../../app/messages.ts';
  import { PROLOGUE_SECTIONS, type PrologueSection } from './content.ts';
  import { mountScrollPrologue } from './scroll-prologue.ts';

  interface Props {
    onskip: () => void;
  }

  let { onskip }: Props = $props();

  const SECTIONS = PROLOGUE_SECTIONS;
  // Read once: this is a short visit and the OS setting rarely changes while it is open.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let surface = $state<HTMLElement>();
  let skip = $state<HTMLButtonElement>();

  function hideBrokenImage(event: Event): void {
    // A missing illustration leaves the gradient backdrop: the copy and the skip stay usable.
    (event.currentTarget as HTMLImageElement).hidden = true;
  }

  function pad(value: number): string {
    return String(value).padStart(2, '0');
  }

  onMount(() => {
    skip?.focus();
    if (!surface || reducedMotion) return;
    const scenes = [...surface.querySelectorAll<HTMLElement>('[data-scene]')].map((root) => ({
      root,
      still: root.querySelector<HTMLElement>('[data-still]'),
    }));
    const prologue = mountScrollPrologue(surface, scenes, { reducedMotion });
    return () => prologue.destroy();
  });
</script>

{#snippet copy(section: PrologueSection, index: number)}
  <div class="copy">
    <p class="index">{pad(index + 1)} / {pad(SECTIONS.length)}</p>
    <p class="eyebrow">{t(section.eyebrow)}</p>
    <h2 class="title">{t(section.title)}</h2>
    <p class="body">{t(section.body)}</p>
  </div>
{/snippet}

<svelte:window onkeydown={(event) => event.key === 'Escape' && onskip()} />

<div
  class="prologue"
  role="dialog"
  aria-modal="true"
  aria-label={t('prologue.label')}
  bind:this={surface}
>
  {#if reducedMotion}
    <div class="still-frame">
      <img
        class="still"
        src={SECTIONS[0].still}
        alt=""
        decoding="async"
        style:object-position={SECTIONS[0].focus}
        onerror={hideBrokenImage}
      />
      {@render copy(SECTIONS[0], 0)}
    </div>
  {:else}
    <div class="track" style:height={`${SECTIONS.length * 100}vh`}>
      {#each SECTIONS as section, index (section.id)}
        <article class="scene" data-scene>
          <img
            class="still"
            data-still
            src={section.still}
            alt=""
            decoding="async"
            loading={index === 0 ? 'eager' : 'lazy'}
            style:object-position={section.focus}
            onerror={hideBrokenImage}
          />
          {@render copy(section, index)}
        </article>
      {/each}
    </div>
    <p class="hint" aria-hidden="true">{t('prologue.hint')}</p>
  {/if}

  <button class="skip" type="button" bind:this={skip} onclick={onskip}>
    {t('prologue.skip')}
  </button>
</div>

<style>
  .prologue {
    position: fixed;
    inset: 0;
    z-index: 40;
    overflow-y: auto;
    overscroll-behavior: contain;
    background:
      radial-gradient(70% 55% at 70% 15%, rgba(224, 170, 79, 0.28), transparent 70%),
      radial-gradient(60% 60% at 20% 90%, rgba(18, 48, 63, 0.9), transparent 75%),
      var(--color-ink);
    color: var(--color-parchment);
  }

  .track,
  .still-frame {
    position: relative;
  }

  .still-frame,
  .scene {
    position: fixed;
    inset: 0;
  }

  .scene {
    opacity: 0;
    pointer-events: none;
  }

  .still {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform-origin: center;
    will-change: transform;
  }

  /* Legibility sheet over the illustration. The copy sits above it. */
  .scene::after,
  .still-frame::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    background: linear-gradient(
      95deg,
      rgba(11, 21, 28, 0.94) 0%,
      rgba(11, 21, 28, 0.66) 38%,
      rgba(11, 21, 28, 0.08) 78%
    );
    pointer-events: none;
  }

  .copy {
    position: fixed;
    left: clamp(var(--space-4), 6vw, 5rem);
    top: 50%;
    z-index: 2;
    width: min(34rem, 52vw);
    transform: translateY(-50%);
    text-shadow: var(--shadow-text);
  }

  .index {
    margin: 0;
    color: var(--color-lantern);
    font-family: var(--font-label);
    font-size: var(--text-label);
    letter-spacing: var(--tracking-kicker);
  }

  .eyebrow {
    margin: var(--space-5) 0 0;
    color: var(--color-ash);
    font-family: var(--font-label);
    font-size: var(--text-label);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .title {
    margin: var(--space-3) 0 0;
    font-family: var(--font-display);
    font-size: var(--text-place);
    font-weight: 400;
    line-height: 1;
  }

  .body {
    margin: var(--space-4) 0 0;
    max-width: 42ch;
    color: var(--color-mist);
    font-size: var(--text-body);
  }

  .skip {
    position: fixed;
    top: var(--space-3);
    right: var(--space-3);
    z-index: 3;
    min-height: var(--control-height);
    padding: 0 var(--space-4);
    border: 1px solid var(--color-lantern);
    border-radius: var(--radius);
    background: var(--color-control);
    color: var(--color-parchment);
    font-family: var(--font-label);
    font-size: var(--text-ui-sm);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    cursor: pointer;
  }

  .skip:hover {
    border-color: var(--color-lantern-hover);
    color: var(--color-lantern-hover);
  }

  .hint {
    position: fixed;
    bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    left: 50%;
    z-index: 2;
    margin: 0;
    transform: translateX(-50%);
    color: var(--color-ash);
    font-family: var(--font-label);
    font-size: var(--text-label);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    animation: hint-rise 2600ms var(--ease-settle) 1200ms both;
  }

  @keyframes hint-rise {
    from {
      opacity: 0;
      transform: translate(-50%, var(--space-3));
    }

    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  @media (max-width: 760px) {
    .scene::after,
    .still-frame::after {
      background: linear-gradient(
        0deg,
        rgba(11, 21, 28, 0.96) 12%,
        rgba(11, 21, 28, 0.72) 46%,
        rgba(11, 21, 28, 0.12) 88%
      );
    }

    .copy {
      top: auto;
      bottom: calc(var(--space-6) + env(safe-area-inset-bottom));
      left: var(--space-4);
      right: var(--space-4);
      width: auto;
      transform: none;
    }

    .title {
      font-size: var(--text-heading);
    }

    .body {
      font-size: var(--text-ui);
    }

    .hint {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hint {
      animation: none;
    }
  }
</style>
