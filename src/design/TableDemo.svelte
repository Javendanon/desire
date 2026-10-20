<script lang="ts">
  import { onDestroy } from 'svelte';

  import ViewerHost from '../lib/engine/ViewerHost.svelte';
  import type { Level, PieceSpec, TableViewer } from '../lib/engine/viewer.ts';
  import ActionBar from '../lib/ui/ActionBar.svelte';
  import Button from '../lib/ui/Button.svelte';
  import InitiativeRibbon from '../lib/ui/InitiativeRibbon.svelte';
  import IntroOverlay from '../lib/ui/IntroOverlay.svelte';
  import NarrativePanel from '../lib/ui/NarrativePanel.svelte';
  import PlaceCaption from '../lib/ui/PlaceCaption.svelte';
  import SelectedSheet from '../lib/ui/SelectedSheet.svelte';
  import Toast from '../lib/ui/Toast.svelte';
  import ZoomRail from '../lib/ui/ZoomRail.svelte';
  import {
    initiativeOrder,
    type Combatant,
    type StoryLine,
    type TurnAction,
  } from '../lib/ui/table-view.ts';
  import {
    CHOICES,
    CITY_HINT,
    COMBATANTS,
    DISTRICTS,
    MINIATURES,
    OPENING,
    ZOOM_LEVELS,
  } from './demo-data.ts';
  import { heal, isDown, nearestStandingAlly, strike } from './demo-turns.ts';

  const MOVE_STEPS = 4;
  const ENEMY_PAUSE_MS = 900;

  let viewer: TableViewer | null = null;
  let introOpen = $state(true);
  let level = $state<Level>(0);
  let district = $state('harbor');
  let hover = $state<string | null>(null);
  let story = $state<StoryLine[]>([...OPENING]);
  let used = $state<number[]>([]);
  let combat = $state(false);
  let combatants = $state<Combatant[]>(initiativeOrder(COMBATANTS));
  let turn = $state(0);
  let selectedId = $state('aubrey');
  let moving = $state(false);
  let toast = $state('');
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const pieces: PieceSpec[] = COMBATANTS.map((c) => ({
    id: c.id,
    side: c.side,
    look: MINIATURES[c.id as keyof typeof MINIATURES].look,
    at: MINIATURES[c.id as keyof typeof MINIATURES].at,
    fallen: isDown(c),
  }));

  const current = $derived(combatants[turn % combatants.length]);
  const selected = $derived(combatants.find((c) => c.id === selectedId) ?? combatants[0]);
  const fallen = $derived(combatants.filter(isDown).map((c) => c.id));
  const choices = $derived(CHOICES.filter((_, index) => !used.includes(index)));
  const cityPlace = $derived(hover ? DISTRICTS[hover] : CITY_HINT);
  const place = $derived(level === 0 ? cityPlace : DISTRICTS[district]);
  const canAct = $derived(current.side === 'ally' && !isDown(current));
  const actions = $derived<TurnAction[]>([
    { id: 'move', label: 'Moverse', icon: 'move', pressed: moving, unavailable: !canAct },
    { id: 'attack', label: 'Atacar', icon: 'attack', unavailable: !canAct },
    { id: 'heal', label: 'Palabra de curación', icon: 'heal', unavailable: current.id !== 'sera' },
    { id: 'end', label: 'Terminar turno', primary: true },
  ]);

  function later(run: () => void, ms: number): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  }

  onDestroy(() => timers.forEach(clearTimeout));

  function say(line: StoryLine): void {
    story = [...story, line].slice(-3);
  }

  function flash(message: string): void {
    toast = message;
    later(() => (toast = ''), 2400);
  }

  function choose(index: number): void {
    const choice = choices[index];
    used = [...used, CHOICES.indexOf(choice)];
    say(choice.reply);
    combat = combat || !!choice.startsCombat;
  }

  function pickDistrict(id: string): void {
    if (level === 1 && id === 'harbor' && district === 'harbor') level = 2;
    else {
      level = 1;
      district = id;
    }
  }

  function requestZoom(next: Level): void {
    if (next === 2 && district !== 'harbor') flash('Ninguna escena preparada en este barrio.');
    else level = next;
  }

  function attack(): void {
    const target = selected.side === 'enemy' && !isDown(selected)
      ? selected
      : combatants.find((c) => c.side === 'enemy' && !isDown(c));
    if (!target) return flash('No quedan enemigos en pie.');
    const result = strike(combatants, current, target);
    combatants = result.combatants;
    say(result.line);
  }

  function cure(): void {
    const target = selected.side === 'ally' ? selected : combatants.find((c) => c.id === 'celeste');
    if (!target) return;
    const result = heal(combatants, current, target);
    combatants = result.combatants;
    say(result.line);
  }

  function enemyTurn(enemy: Combatant): void {
    const ally = nearestStandingAlly(combatants);
    if (!ally || !viewer || isDown(enemy)) return endTurn();
    const distance = viewer.approach(enemy.id, ally.id, 3);
    later(() => {
      if (distance <= 1) {
        const result = strike(combatants, enemy, ally);
        combatants = result.combatants;
        say({ ...result.line, tone: 'failure' });
      } else {
        say({ speaker: enemy.fullName, text: `Avanza hacia ${ally.name}.`, tone: 'failure' });
      }
      later(endTurn, ENEMY_PAUSE_MS);
    }, ENEMY_PAUSE_MS);
  }

  function endTurn(): void {
    moving = false;
    turn += 1;
    const next = combatants[turn % combatants.length];
    selectedId = next.side === 'ally' ? next.id : (nearestStandingAlly(combatants)?.id ?? next.id);
    if (next.side === 'enemy') later(() => enemyTurn(next), ENEMY_PAUSE_MS);
  }

  function act(id: string): void {
    if (id === 'move') moving = !moving;
    if (id === 'attack') attack();
    if (id === 'heal') cure();
    if (id === 'end') endTurn();
  }

  function moveTo(cell: number): void {
    viewer?.movePiece(current.id, cell);
    moving = false;
    say({ speaker: current.name, text: 'Cruza el muelle entre los barriles.', tone: 'narration' });
  }

  function enter(): void {
    introOpen = false;
    viewer?.skipIntro();
  }
</script>

<div class="table">
  <ViewerHost
    {level}
    {district}
    {pieces}
    {fallen}
    turnId={combat ? current.id : ''}
    selectedId={combat ? selectedId : ''}
    moveSteps={moving ? MOVE_STEPS : null}
    onready={(created) => (viewer = created)}
    ondistrict={pickDistrict}
    onhover={(id) => (hover = id)}
    onpiece={(id) => (selectedId = id)}
    oncell={moveTo}
    onzoom={requestZoom}
    onintroend={() => (introOpen = false)}
  />

  <header class="top">
    <span class="brand">Desire</span>
    <p class="status">Waterdeep · Día 12 · 19:40 · Niebla baja</p>
  </header>

  <div class="rail">
    <ZoomRail
      levels={ZOOM_LEVELS}
      current={level}
      onselect={(next) => requestZoom(next as Level)}
    />
  </div>

  {#if introOpen}
    <!-- the intro owns the screen until the player enters or the flight ends -->
  {:else if level === 0}
    <div class="caption"><PlaceCaption {...place} /></div>
  {:else if level === 1}
    <div class="caption">
      <PlaceCaption {...place} />
      {#if district === 'harbor'}
        <div class="enter">
          <Button variant="primary" onclick={() => (level = 2)}>Bajar al muelle siete</Button>
        </div>
      {/if}
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
          {combatants}
          currentId={current.id}
          {selectedId}
          onselect={(id) => (selectedId = id)}
        />
      </div>
      <div class="actions"><ActionBar {actions} onaction={act} /></div>
      <div class="sheet"><SelectedSheet combatant={selected} /></div>
    {/if}
  {/if}

  {#if toast}<div class="toast"><Toast message={toast} /></div>{/if}

  <IntroOverlay
    open={introOpen}
    kicker="La ciudad de los esplendores"
    title="Waterdeep"
    subtitle="Día 12, 19:40. La niebla baja sobre el puerto."
    onenter={enter}
  />
</div>

<style>
  .table {
    position: relative;
    height: 100vh;
    min-height: 640px;
    overflow: hidden;
  }

  .top {
    position: absolute;
    left: var(--space-6);
    right: var(--space-6);
    top: 22px;
    display: flex;
    align-items: center;
    gap: 20px;
    text-shadow: var(--shadow-text);
    pointer-events: none;
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
    text-align: center;
  }

  .enter {
    margin-top: var(--space-4);
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

  .toast {
    position: absolute;
    left: 50%;
    top: 184px;
    transform: translateX(-50%);
  }

  @media (max-width: 1100px) {
    .top {
      left: var(--space-4);
      right: var(--space-4);
      top: var(--space-3);
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    .rail {
      top: 92px;
      left: var(--space-4);
      right: var(--space-4);
      transform: none;
    }

    .story {
      left: var(--space-4);
      right: var(--space-4);
      width: auto;
      bottom: 124px;
      max-height: 30vh;
      overflow-y: auto;
    }

    .ribbon {
      top: 148px;
      left: var(--space-4);
      right: var(--space-4);
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
