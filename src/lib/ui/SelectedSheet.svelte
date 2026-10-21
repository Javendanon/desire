<script lang="ts">
  import { hpPercent, sideColor, statLine, type Combatant } from './table-view.ts';

  interface Props {
    combatant: Combatant;
  }

  let { combatant }: Props = $props();

  const sideLabel = $derived(combatant.side === 'enemy' ? 'Hostil' : combatant.role);
</script>

<aside class="sheet" aria-label="Seleccionado">
  <p class="side" style:color={sideColor(combatant.side)}>{sideLabel}</p>
  <h3 class="name">{combatant.fullName}</h3>
  <div
    class="bar"
    role="meter"
    aria-label="Puntos de vida"
    aria-valuemin={0}
    aria-valuemax={combatant.maxHp}
    aria-valuenow={combatant.hp}
  >
    <div
      class="fill"
      style:width={hpPercent(combatant)}
      style:background={sideColor(combatant.side)}
    ></div>
  </div>
  <p class="stats">{statLine(combatant)}</p>
</aside>

<style>
  .sheet {
    padding: var(--space-4) 18px;
    background: var(--color-hull-glass);
    border: 1px solid var(--color-fog);
    border-radius: var(--radius);
  }

  .side {
    margin: 0;
    font-family: var(--font-label);
    font-size: 13px;
    letter-spacing: var(--tracking-label);
  }

  .name {
    margin: 2px 0 var(--space-2);
    font-family: var(--font-display);
    font-weight: 400;
    font-size: var(--text-name);
  }

  .bar {
    height: 6px;
    background: var(--color-rule);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .fill {
    height: 6px;
    transition: width var(--duration-panel) ease;
  }

  .stats {
    margin: var(--space-2) 0 0;
    font-size: var(--text-ui-sm);
    color: var(--color-mist);
  }
</style>
