<!--
  Panels over the map. It only listens for picked places and never holds the viewer, so no
  interaction here can move the camera. Local encounter state lives and dies with this component.
-->
<script lang="ts">
  import { untrack } from 'svelte';

  import type { Id } from '../../generated/contracts.ts';
  import '../characters/sheet-controls.css';
  import CharacterSheet from '../characters/CharacterSheet.svelte';
  import type { RuleBook } from '../characters/rule-book.ts';
  import ParticleField from './ParticleField.svelte';
  import ScopeNote from './ScopeNote.svelte';
  import TacticalPanel from './TacticalPanel.svelte';
  import {
    effectsScope,
    loadParticlesEnabled,
    planParticles,
    saveParticlesEnabled,
    type EffectsStorage,
  } from './effects.ts';
  import {
    encounterOutsiders,
    indexSheets,
    participantConditions,
    rolledOrder,
    type EncounterBundle,
    type PickedPlace,
    type PlaceSubscription,
  } from './encounter-model.ts';
  import {
    adjustHp,
    applyLocal,
    canAdvance,
    dismissCondition,
    hasLocalChanges,
    localEdits,
    nextTurn,
    startLocalState,
  } from './encounter-state.ts';
  import type { InteractionScope } from './interaction-scope.ts';
  import { participantViews } from './tactical-view.ts';

  interface Props {
    bundle: EncounterBundle;
    rules: RuleBook;
    placeName: string;
    subscribePlace: PlaceSubscription;
    effectsStorage: EffectsStorage;
  }

  let { bundle, rules, placeName, subscribePlace, effectsStorage }: Props = $props();

  const CONCENTRATION_SOURCES = 1;

  let local = $state(untrack(() => startLocalState(bundle.encounter)));
  let panelOpen = $state(false);
  let openActorId = $state<Id | null>(null);
  let pickNote = $state('');
  let reducedMotion = $state(false);
  let particlesEnabled = $state(untrack(() => loadParticlesEnabled(effectsStorage)));
  let particlesScope = $state<InteractionScope>(untrack(() => effectsScope(effectsStorage)));
  let launcher: HTMLButtonElement;
  let sheetOpener: HTMLElement | null = null;

  const sheets = $derived(indexSheets(bundle.sheets));
  const rolled = $derived(rolledOrder(bundle.participants));
  const views = $derived(participantViews({ bundle, state: local, rules }));
  const recordedSheet = $derived(openActorId ? sheets.get(openActorId) ?? null : null);
  const openSheet = $derived(recordedSheet ? applyLocal(recordedSheet, local) : null);
  const edits = $derived(recordedSheet ? localEdits(recordedSheet, local) : null);
  const recordedHp = $derived(edits?.hp ? (recordedSheet?.state?.current_hp ?? null) : null);
  const particles = $derived(
    planParticles({ enabled: particlesEnabled, reducedMotion }, CONCENTRATION_SOURCES),
  );

  $effect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => {
      reducedMotion = query.matches;
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });

  $effect(() => subscribePlace(handlePlace));

  function handlePlace(place: PickedPlace): void {
    if (place.contractId === bundle.encounter.place_id) {
      panelOpen = true;
      pickNote = `${place.name}: encounter opened.`;
      return;
    }
    pickNote = `${place.name}: no encounter recorded here.`;
  }

  function showSheet(actorId: Id): void {
    sheetOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openActorId = actorId;
  }

  function closeSheet(): void {
    openActorId = null;
    // The panel may have been hidden while the sheet stayed open, removing the row that opened it.
    const target = sheetOpener?.isConnected ? sheetOpener : launcher;
    target.focus({ preventScroll: true });
    sheetOpener = null;
  }

  function closePanel(): void {
    panelOpen = false;
    launcher.focus({ preventScroll: true });
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (openActorId) closeSheet();
    else if (panelOpen) closePanel();
  }

  function adjust(actorId: Id, delta: number): void {
    const recorded = sheets.get(actorId)?.state;
    if (recorded) local = adjustHp(local, recorded, delta);
  }

  function advance(): void {
    const conditions = participantConditions(bundle);
    local = nextTurn(local, { rolledCount: rolled.length, conditions });
  }

  function setParticles(enabled: boolean): void {
    particlesEnabled = enabled;
    particlesScope = saveParticlesEnabled(effectsStorage, enabled) ? 'device' : 'session';
  }
</script>

<svelte:window onkeydown={handleKey} />

<div class="overlay">
  <div class="launcher">
    <button
      id="tactical-launcher"
      type="button"
      class="sheet-control"
      bind:this={launcher}
      aria-expanded={panelOpen}
      aria-controls={panelOpen ? 'tactical-panel' : undefined}
      onclick={() => (panelOpen = !panelOpen)}
    >
      {panelOpen ? 'Hide encounter' : 'Show encounter'} · {placeName}
    </button>
    <p class="note" role="status">{pickNote}</p>
  </div>

  {#if panelOpen}
    <div class="slot panel-slot">
      <TacticalPanel
        {bundle}
        {placeName}
        round={local.round}
        {views}
        outsiders={encounterOutsiders(bundle)}
        canAdvance={canAdvance(bundle.encounter, rolled.length)}
        canReset={hasLocalChanges(local, bundle.encounter)}
        {particlesEnabled}
        {particlesScope}
        {reducedMotion}
        onopen={showSheet}
        onadjust={adjust}
        onnext={advance}
        onreset={() => (local = startLocalState(bundle.encounter))}
        onparticles={setParticles}
      />
    </div>
  {/if}

  {#if openSheet && recordedSheet}
    <div class="slot sheet-slot">
      {#key openSheet.actor.id}
        <CharacterSheet
          sheet={openSheet}
          {recordedSheet}
          {rules}
          {recordedHp}
          conditionsEdited={edits?.conditions ?? false}
          ondismiss={(id) => (local = dismissCondition(local, id))}
          onclose={closeSheet}
        >
          {#snippet scope()}
            <ScopeNote scope="read-only" />
            <ScopeNote scope="session" />
          {/snippet}
          {#snippet effect()}
            <ParticleField {particles} />
          {/snippet}
        </CharacterSheet>
      {/key}
    </div>
  {/if}
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }

  .launcher {
    position: absolute;
    left: var(--space-4);
    top: var(--space-4);
    width: min(360px, calc(100% - 2 * var(--space-4)));
  }

  .launcher button {
    pointer-events: auto;
  }

  .note {
    margin: var(--space-1) 0 0;
    font-size: var(--text-ui-sm);
    text-shadow: var(--shadow-text);
  }

  .slot {
    position: absolute;
    top: 96px;
    bottom: var(--space-4);
    display: flex;
    flex-direction: column;
    pointer-events: auto;
  }

  .panel-slot {
    left: var(--space-4);
    width: min(360px, calc(100% - 2 * var(--space-4)));
  }

  .sheet-slot {
    right: var(--space-4);
    width: min(400px, calc(100% - 2 * var(--space-4)));
  }

  /* On a phone one panel covers the map. The sheet stacks above the panel it was opened from. */
  @media (max-width: 800px) {
    .sheet-slot {
      left: var(--space-4);
      right: var(--space-4);
      width: auto;
    }
  }
</style>
