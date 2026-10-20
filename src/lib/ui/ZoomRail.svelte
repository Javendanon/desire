<script lang="ts">
  import Button from './Button.svelte';

  interface Props {
    levels: readonly string[];
    current: number;
    onselect: (level: number) => void;
  }

  let { levels, current, onselect }: Props = $props();

  const zoomIn = (): void => onselect(Math.min(levels.length - 1, current + 1));
  const zoomOut = (): void => onselect(Math.max(0, current - 1));
</script>

<nav class="rail" aria-label="Nivel de zoom">
  <Button icon="plus" label="Acercar" onclick={zoomIn} />
  {#each levels as level, index (level)}
    <button
      type="button"
      class="level"
      class:current={index === current}
      aria-current={index === current ? 'true' : undefined}
      onclick={() => onselect(index)}
    >
      {level}
    </button>
  {/each}
  <Button icon="minus" label="Alejar" onclick={zoomOut} />
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    width: 112px;
  }

  .level {
    min-height: var(--control-height);
    border-radius: var(--radius);
    border: 1px solid var(--color-fog-strong);
    background: var(--color-control);
    color: var(--color-parchment);
    font-family: var(--font-label);
    font-weight: 700;
    font-size: var(--text-ui-sm);
    letter-spacing: 0.06em;
    cursor: pointer;
  }

  .level:hover {
    border-color: var(--color-parchment);
  }

  .current {
    background: var(--color-lantern);
    border-color: var(--color-lantern);
    color: var(--color-ink);
  }
</style>
