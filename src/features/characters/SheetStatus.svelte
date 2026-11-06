<!-- Concentration and conditions with their durations and rule sources. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import RuleDetails from './RuleDetails.svelte';
  import SheetSection from './SheetSection.svelte';
  import type { RuleBook } from './rule-book.ts';
  import type { ActorSheet } from './sheet-model.ts';
  import { concentrationView, conditionRows } from './sheet-rows.ts';

  interface Props {
    sheet: ActorSheet;
    rules: RuleBook;
    /** True when session edits changed a duration or dismissed a condition. */
    conditionsEdited: boolean;
    /** Decorative layer behind an active concentration. */
    effect?: Snippet;
    /** Hides a condition for this session only. */
    ondismiss?: (conditionId: string) => void;
  }

  let { sheet, rules, conditionsEdited, effect, ondismiss }: Props = $props();

  const concentration = $derived(concentrationView(sheet, rules));
  const conditions = $derived(conditionRows(sheet, rules));

  let conditionList = $state<HTMLElement>();

  // Dismissing removes the button that was just pressed, so keyboard focus needs a new home.
  function dismiss(conditionId: string): void {
    ondismiss?.(conditionId);
    conditionList?.focus({ preventScroll: true });
  }
</script>

<SheetSection title="Concentration">
  <div class="concentration" class:active={concentration.rule !== null}>
    {#if concentration.rule}{@render effect?.()}{/if}
    <p>
      <span aria-hidden="true">{concentration.rule ? '◉' : '○'}</span>
      {concentration.text}
    </p>
    {#if concentration.rule}
      <RuleDetails rule={concentration.rule} />
      <p class="hint">The contract stores no timer for concentration: see the rule's duration.</p>
    {/if}
  </div>
</SheetSection>

<SheetSection title="Conditions">
  <div bind:this={conditionList} tabindex="-1">
    {#if conditionsEdited}
      <p class="edited">Local change, not saved: this list differs from the record.</p>
    {/if}
    {#if conditions.length === 0}
      <p>No conditions recorded.</p>
    {:else}
      <ul>
        {#each conditions as condition (condition.id)}
          <li>
            <RuleDetails rule={condition.rule} />
            <p class="duration">{condition.duration}</p>
            {#if ondismiss}
              <button
                type="button"
                class="sheet-control"
                aria-label={`Dismiss ${condition.rule.name} in this session only`}
                onclick={() => dismiss(condition.id)}
              >
                Dismiss locally
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</SheetSection>

<style>
  .concentration {
    position: relative;
  }

  .concentration.active {
    padding: var(--space-2);
    border: 1px solid var(--color-lantern);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .hint {
    font-size: var(--text-ui-sm);
    color: var(--color-ash);
  }

  .duration {
    font-size: var(--text-ui-sm);
  }

  .edited {
    font-size: var(--text-ui-sm);
    color: var(--color-lantern);
  }
</style>
