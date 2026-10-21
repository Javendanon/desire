<script lang="ts">
  import Button from './Button.svelte';
  import type { TurnAction } from './table-view.ts';

  interface Props {
    actions: readonly TurnAction[];
    onaction: (id: string) => void;
  }

  let { actions, onaction }: Props = $props();
</script>

<div class="bar" role="toolbar" aria-label="Acciones del turno">
  {#each actions as action (action.id)}
    <Button
      variant={action.primary ? 'primary' : 'secondary'}
      icon={action.icon}
      unavailable={action.unavailable}
      pressed={action.pressed}
      onclick={() => onaction(action.id)}
    >
      {action.label}
    </Button>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  /* Phones: a 2 × 2 grid, so the bar keeps a fixed height above the narrative panel. */
  @media (max-width: 600px) {
    .bar {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
