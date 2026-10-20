<script lang="ts">
  import { initiativeOrder, toMedal, type Combatant } from './table-view.ts';

  interface Props {
    combatants: readonly Combatant[];
    currentId: string;
    selectedId: string;
    onselect: (id: string) => void;
  }

  let { combatants, currentId, selectedId, onselect }: Props = $props();

  const medals = $derived(
    initiativeOrder(combatants).map((c) => toMedal(c, currentId, selectedId)),
  );
</script>

<div class="ribbon" role="group" aria-label="Orden de iniciativa">
  {#each medals as medal (medal.id)}
    <button
      type="button"
      class="medal"
      class:current={medal.current}
      aria-label={medal.label}
      aria-pressed={medal.selected}
      onclick={() => onselect(medal.id)}
    >
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle class="frame" class:selected={medal.selected} cx="32" cy="32" r="29" />
        <circle class="track" cx="32" cy="32" r="24" />
        <circle
          class="hp"
          cx="32"
          cy="32"
          r="24"
          stroke={medal.ringColor}
          stroke-dasharray={medal.ringDash}
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="38" text-anchor="middle">{medal.initials}</text>
        {#if medal.enemy}<path class="enemy-mark" d="M32 0 38 6 32 12 26 6z" />{/if}
      </svg>
      <span class="name">{medal.name}</span>
      <span class="caption">{medal.caption}</span>
    </button>
  {/each}
</div>

<style>
  .ribbon {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }

  .medal {
    min-width: 64px;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    background: none;
    border: 0;
    color: var(--color-parchment);
    font-family: var(--font-label);
    font-size: 13px;
    letter-spacing: 0.06em;
    text-shadow: var(--shadow-text);
    cursor: pointer;
  }

  .frame {
    fill: var(--color-hull);
    stroke: var(--color-fog);
    stroke-width: 1.5;
  }

  .frame.selected {
    stroke: var(--color-parchment);
  }

  .current .frame {
    stroke: var(--color-lantern);
    stroke-width: 3;
  }

  .track {
    fill: none;
    stroke: var(--color-rule);
    stroke-width: 4;
  }

  .hp {
    fill: none;
    stroke-width: 4;
    transition: stroke-dasharray var(--duration-panel) ease;
  }

  text {
    fill: var(--color-parchment);
    font-family: var(--font-display);
    font-size: 20px;
  }

  .enemy-mark {
    fill: var(--color-ember);
  }

  .current .name {
    color: var(--color-lantern);
  }

  .caption {
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--color-mist);
  }
</style>
