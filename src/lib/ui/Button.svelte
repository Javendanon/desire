<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  interface Props {
    children?: Snippet;
    variant?: 'primary' | 'secondary';
    icon?: IconName;
    /** Toggle buttons only: true or false. Leave undefined for plain buttons. */
    pressed?: boolean;
    /** Unavailable this turn: stays focusable and announced, but does nothing. */
    unavailable?: boolean;
    label?: string;
    onclick?: () => void;
  }

  let {
    children,
    variant = 'secondary',
    icon,
    pressed,
    unavailable = false,
    label,
    onclick,
  }: Props = $props();

  function activate(): void {
    if (!unavailable) onclick?.();
  }
</script>

<button
  type="button"
  class="button"
  class:primary={variant === 'primary'}
  class:pressed
  class:unavailable
  aria-pressed={pressed}
  aria-disabled={unavailable}
  aria-label={label}
  onclick={activate}
>
  {#if icon}<Icon name={icon} />{/if}
  {#if children}{@render children()}{/if}
</button>

<style>
  .button {
    min-height: var(--control-height);
    padding: 0 var(--space-4);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border-radius: var(--radius);
    border: 1px solid var(--color-fog-strong);
    background: var(--color-control);
    color: var(--color-parchment);
    font-family: var(--font-label);
    font-weight: 700;
    font-size: var(--text-ui-sm);
    letter-spacing: 0.06em;
    cursor: pointer;
    transition:
      border-color var(--duration-quick) ease,
      background var(--duration-quick) ease;
  }

  .button:hover {
    border-color: var(--color-parchment);
  }

  .primary {
    background: var(--color-lantern);
    border-color: var(--color-lantern);
    color: var(--color-ink);
  }

  .primary:hover {
    background: var(--color-lantern-hover);
    border-color: var(--color-lantern-hover);
  }

  .pressed {
    background: var(--color-lantern-shadow);
    border-color: var(--color-lantern);
  }

  .unavailable {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
