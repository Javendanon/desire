<!-- Ability scores with derived modifiers, plus armor class and speed as recorded. -->
<script lang="ts">
  import type { ActorStats } from '../../generated/contracts.ts';
  import SheetSection from './SheetSection.svelte';
  import { abilityRows } from './sheet-view.ts';

  interface Props {
    stats: ActorStats;
  }

  let { stats }: Props = $props();

  const rows = $derived(abilityRows(stats));
</script>

<SheetSection title="Attributes">
  <ul class="abilities">
    {#each rows as row (row.short)}
      <li class="ability">
        <span class="visually-hidden">{row.spoken}</span>
        <span class="short" aria-hidden="true">{row.short}</span>
        <span class="value" aria-hidden="true"><b>{row.score}</b> {row.modifier}</span>
      </li>
    {/each}
  </ul>
  <p>Armor class {stats.armor_class} · Speed {stats.speed_m} m</p>
</SheetSection>

<style>
  .abilities {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
  }

  .ability {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-fog);
    border-radius: var(--radius);
  }

  .short {
    display: block;
    font-family: var(--font-label);
    font-size: var(--text-label);
    color: var(--color-ash);
  }

  .value {
    display: block;
  }
</style>
