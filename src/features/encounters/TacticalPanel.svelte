<!-- The encounter at a glance: turn order, local controls, and the limits of what is automated. -->
<script lang="ts">
  import EvidenceBadge from '../characters/EvidenceBadge.svelte';
  import { RULES_EDITION_LABELS } from '../characters/rule-book.ts';
  import type { ActorSheet } from '../characters/sheet-model.ts';
  import ParticipantRow from './ParticipantRow.svelte';
  import ScopeNote from './ScopeNote.svelte';
  import type { EncounterBundle } from './encounter-model.ts';
  import { AUTOMATED_RULES, NOT_AUTOMATED } from './encounter-state.ts';
  import { encounterStatusText, type ParticipantView } from './tactical-view.ts';

  interface Props {
    bundle: EncounterBundle;
    placeName: string;
    round: number;
    views: readonly ParticipantView[];
    outsiders: readonly ActorSheet[];
    canAdvance: boolean;
    canReset: boolean;
    particlesEnabled: boolean;
    reducedMotion: boolean;
    onopen: (actorId: string) => void;
    onadjust: (actorId: string, delta: number) => void;
    onnext: () => void;
    onreset: () => void;
    onparticles: (enabled: boolean) => void;
  }

  let {
    bundle,
    placeName,
    round,
    views,
    outsiders,
    canAdvance,
    canReset,
    particlesEnabled,
    reducedMotion,
    onopen,
    onadjust,
    onnext,
    onreset,
    onparticles,
  }: Props = $props();

  let heading: HTMLHeadingElement;

  const edition = $derived(RULES_EDITION_LABELS[bundle.rulesEdition]);

  // Undoing disables the button that was just pressed, so keyboard focus needs a new home.
  function undoLocalChanges(): void {
    onreset();
    heading.focus({ preventScroll: true });
  }
</script>

<section id="tactical-panel" class="panel" aria-labelledby="tactical-panel-title">
  <header>
    <h2 id="tactical-panel-title" bind:this={heading} tabindex="-1">{bundle.encounter.name}</h2>
    <p class="meta">{placeName} · {encounterStatusText(bundle.encounter.status)}</p>
    <p class="meta" aria-live="polite">Round {round} · Rules: {edition}</p>
  </header>

  <EvidenceBadge provenance={bundle.provenance} />

  <ol class="order" aria-label="Turn order">
    {#each views as view (view.actorId)}
      <ParticipantRow
        {view}
        onopen={() => onopen(view.actorId)}
        onadjust={(delta) => onadjust(view.actorId, delta)}
      />
    {/each}
  </ol>

  <div class="controls">
    <button type="button" class="sheet-control" disabled={!canAdvance} onclick={onnext}>
      Next turn
    </button>
    <button type="button" class="sheet-control" disabled={!canReset} onclick={undoLocalChanges}>
      Undo local changes
    </button>
  </div>
  <ScopeNote scope="session" />

  {#if outsiders.length > 0}
    <section class="group" aria-labelledby="tactical-outsiders">
      <h3 id="tactical-outsiders">Not in this encounter</h3>
      <ul>
        {#each outsiders as sheet (sheet.actor.id)}
          <li>
            <button
              type="button"
              class="sheet-link"
              data-open-sheet={sheet.actor.id}
              onclick={() => onopen(sheet.actor.id)}
            >
              {sheet.actor.name}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="group" aria-labelledby="tactical-effects">
    <h3 id="tactical-effects">Visual effects</h3>
    <label class="toggle">
      <input
        id="tactical-particles"
        type="checkbox"
        checked={particlesEnabled}
        onchange={(event) => onparticles(event.currentTarget.checked)}
      />
      Concentration particles
    </label>
    {#if reducedMotion}
      <p class="meta">Not shown: your system asks for reduced motion.</p>
    {/if}
    <ScopeNote scope="device" />
  </section>

  <details class="group">
    <summary>What this panel computes</summary>
    <ul>
      {#each AUTOMATED_RULES as rule (rule)}<li>{rule}</li>{/each}
    </ul>
    <p><strong>Left to the table:</strong></p>
    <ul>
      {#each NOT_AUTOMATED as rule (rule)}<li>{rule}</li>{/each}
    </ul>
  </details>
</section>

<style>
  .panel {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--color-hull-glass);
    border: 1px solid var(--color-fog);
    border-radius: var(--radius);
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-name);
    font-weight: 400;
  }

  h3 {
    margin: 0 0 var(--space-1);
    font-family: var(--font-label);
    font-size: var(--text-label);
    font-weight: 400;
    letter-spacing: var(--tracking-label);
    color: var(--color-ash);
  }

  .meta {
    margin: 0;
    font-size: var(--text-ui-sm);
    color: var(--color-mist);
  }

  .order,
  .group ul {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .group {
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-rule);
    font-size: var(--text-ui-sm);
  }

  .group summary {
    cursor: pointer;
  }

  .group p {
    margin: var(--space-2) 0 var(--space-1);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
  }
</style>
