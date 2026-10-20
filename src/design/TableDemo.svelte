<script lang="ts">
  import ActionBar from '../lib/ui/ActionBar.svelte';
  import InitiativeRibbon from '../lib/ui/InitiativeRibbon.svelte';
  import IntroOverlay from '../lib/ui/IntroOverlay.svelte';
  import NarrativePanel from '../lib/ui/NarrativePanel.svelte';
  import PlaceCaption from '../lib/ui/PlaceCaption.svelte';
  import SelectedSheet from '../lib/ui/SelectedSheet.svelte';
  import ZoomRail from '../lib/ui/ZoomRail.svelte';
  import { initiativeOrder, type StoryLine, type TurnAction } from '../lib/ui/table-view.ts';
  import { CHOICES, CITY_HINT, COMBATANTS, HARBOR, OPENING, ZOOM_LEVELS } from './demo-data.ts';

  let introOpen = $state(true);
  let level = $state(0);
  let story = $state<StoryLine[]>([...OPENING]);
  let used = $state<number[]>([]);
  let combat = $state(false);
  let turn = $state(0);
  let selectedId = $state('aubrey');
  let moving = $state(false);

  const order = initiativeOrder(COMBATANTS);
  const current = $derived(order[turn % order.length]);
  const selected = $derived(order.find((c) => c.id === selectedId) ?? order[0]);
  const choices = $derived(CHOICES.filter((_, index) => !used.includes(index)));
  const actions = $derived<TurnAction[]>([
    { id: 'move', label: 'Moverse', icon: 'move', pressed: moving },
    { id: 'attack', label: 'Atacar', icon: 'attack' },
    { id: 'heal', label: 'Palabra de curación', icon: 'heal', unavailable: current.id !== 'sera' },
    { id: 'dodge', label: 'Esquivar', icon: 'dodge' },
    { id: 'end', label: 'Terminar turno', primary: true },
  ]);

  function choose(index: number): void {
    const choice = choices[index];
    const original = CHOICES.indexOf(choice);
    used = [...used, original];
    story = [...story, choice.reply].slice(-3);
    combat = combat || !!choice.startsCombat;
  }

  function act(id: string): void {
    if (id === 'move') moving = !moving;
    if (id === 'end') {
      turn += 1;
      moving = false;
    }
  }
</script>

<div class="table">
  <div class="scene" aria-hidden="true"></div>

  <header class="top">
    <span class="brand">Desire</span>
    <p class="status">Waterdeep · Día 12 · 19:40 · Niebla baja</p>
  </header>

  <div class="rail">
    <ZoomRail levels={ZOOM_LEVELS} current={level} onselect={(next) => (level = next)} />
  </div>

  {#if introOpen}
    <!-- the intro owns the screen until the player enters -->
  {:else if level < 2}
    <div class="caption">
      <PlaceCaption {...level === 0 ? CITY_HINT : HARBOR} />
    </div>
  {:else}
    <div class="story">
      <NarrativePanel
        lines={combat ? story.slice(-2) : story}
        choices={combat ? [] : choices}
        onchoose={choose}
      />
    </div>
    {#if combat}
      <div class="ribbon">
        <InitiativeRibbon
          combatants={order}
          currentId={current.id}
          {selectedId}
          onselect={(id) => (selectedId = id)}
        />
      </div>
      <div class="actions"><ActionBar {actions} onaction={act} /></div>
      <div class="sheet"><SelectedSheet combatant={selected} /></div>
    {/if}
  {/if}

  <IntroOverlay
    open={introOpen}
    kicker="La ciudad de los esplendores"
    title="Waterdeep"
    subtitle="Día 12, 19:40. La niebla baja sobre el puerto."
    onenter={() => (introOpen = false)}
  />
</div>

<style>
  .table {
    position: relative;
    height: 100vh;
    min-height: 640px;
    overflow: hidden;
  }

  .scene {
    position: absolute;
    inset: 0;
    background: var(--color-dusk);
  }

  .top {
    position: absolute;
    left: var(--space-6);
    right: var(--space-6);
    top: 22px;
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .brand {
    font-family: var(--font-display);
    font-size: var(--text-name);
  }

  .status {
    margin: 0;
    font-family: var(--font-label);
    letter-spacing: 0.08em;
    color: var(--color-mist);
  }

  .rail {
    position: absolute;
    right: var(--space-6);
    top: 50%;
    transform: translateY(-50%);
  }

  .caption {
    position: absolute;
    left: 50%;
    bottom: var(--space-7);
    transform: translateX(-50%);
    width: min(720px, calc(100% - 56px));
  }

  .story {
    position: absolute;
    left: var(--space-6);
    bottom: var(--space-6);
    width: min(500px, calc(100% - 56px));
  }

  .ribbon {
    position: absolute;
    left: 50%;
    top: 78px;
    transform: translateX(-50%);
  }

  .actions {
    position: absolute;
    left: 556px;
    right: var(--space-6);
    bottom: var(--space-6);
  }

  .sheet {
    position: absolute;
    right: var(--space-6);
    top: 78px;
    width: 272px;
  }

  @media (max-width: 1100px) {
    .rail {
      top: 70px;
      right: var(--space-4);
      transform: none;
    }

    .story {
      left: var(--space-4);
      right: var(--space-4);
      width: auto;
      bottom: 132px;
    }

    .ribbon {
      left: var(--space-4);
      right: 120px;
      transform: none;
      overflow-x: auto;
    }

    .actions {
      left: var(--space-4);
      right: var(--space-4);
      bottom: var(--space-4);
    }

    .sheet {
      display: none;
    }
  }
</style>
