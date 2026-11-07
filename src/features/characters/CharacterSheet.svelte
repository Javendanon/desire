<!--
  One actor's sheet, floating over the scene. It takes no input from the map and never touches the
  viewer, so opening it cannot move the camera. A sheet with no data says so rather than guess.
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  import './sheet-controls.css';
  import EvidenceBadge from './EvidenceBadge.svelte';
  import SheetAbilities from './SheetAbilities.svelte';
  import SheetHealth from './SheetHealth.svelte';
  import SheetKit from './SheetKit.svelte';
  import SheetMoves from './SheetMoves.svelte';
  import SheetStatus from './SheetStatus.svelte';
  import type { RuleBook } from './rule-book.ts';
  import type { ActorSheet } from './sheet-model.ts';
  import { sheetHeader } from './sheet-view.ts';

  interface Props {
    /** The sheet as this session shows it: dismissed conditions and edited HP applied. */
    sheet: ActorSheet;
    /** The record itself. Emptiness and evidence read from here, never from the session view. */
    recordedSheet: ActorSheet;
    rules: RuleBook;
    /** Set only when a session edit differs from the record. */
    recordedHp: number | null;
    /** True when session edits changed a duration or dismissed a condition. */
    conditionsEdited?: boolean;
    /** Interaction scope note, supplied by the screen that owns those interactions. */
    scope: Snippet;
    effect?: Snippet;
    ondismiss?: (conditionId: string) => void;
    onclose: () => void;
  }

  let {
    sheet,
    recordedSheet,
    rules,
    recordedHp,
    conditionsEdited = false,
    scope,
    effect,
    ondismiss,
    onclose,
  }: Props = $props();

  let heading: HTMLHeadingElement;

  const KIND_WORDS = { character: 'Character', npc: 'NPC', monster: 'Monster' } as const;

  // The session view drops dismissed conditions, so it can look empty when the record is not.
  const header = $derived(sheetHeader(recordedSheet));

  // The sheet opens beside the map without taking over the page: move focus, never scroll.
  onMount(() => heading.focus({ preventScroll: true }));
</script>

<section id="character-sheet" class="sheet" aria-labelledby="character-sheet-title">
  <header class="head">
    <div>
      <p class="kind">{KIND_WORDS[sheet.actor.kind]}</p>
      <h3 id="character-sheet-title" bind:this={heading} tabindex="-1">{sheet.actor.name}</h3>
      <p class="rules">{header.editionLine}</p>
    </div>
    <button type="button" class="sheet-control" onclick={onclose}>Close sheet</button>
  </header>

  <EvidenceBadge provenance={sheet.provenance} wording={header.badge} />
  {@render scope()}

  {#if header.supplied}
    {#if sheet.details}
      <p class="details">
        {sheet.details.ancestry} · {sheet.details.background} · {sheet.details.experience} XP
      </p>
      <p class="details">{sheet.details.biography}</p>
    {/if}
    {#if sheet.state}<SheetHealth state={sheet.state} {recordedHp} />{/if}
    {#if sheet.stats}<SheetAbilities stats={sheet.stats} />{/if}
    <SheetStatus {sheet} {rules} {conditionsEdited} {effect} {ondismiss} />
    <SheetMoves {sheet} {rules} />
    <SheetKit {sheet} {rules} />
  {:else}
    <p class="absent">
      <strong>No sheet supplied.</strong> Only what the source above confirms is known. Attributes,
      hit points, equipment, actions, spells and conditions are left empty, not invented.
    </p>
  {/if}
</section>

<style>
  .sheet {
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

  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .kind,
  .rules,
  .details {
    margin: 0;
    font-size: var(--text-ui-sm);
    color: var(--color-mist);
  }

  .kind {
    font-family: var(--font-label);
    letter-spacing: var(--tracking-label);
  }

  h3 {
    margin: 2px 0;
    font-family: var(--font-display);
    font-size: var(--text-name);
    font-weight: 400;
  }

  .absent {
    margin: 0;
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-rule);
  }
</style>
