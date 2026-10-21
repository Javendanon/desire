<script lang="ts">
  interface Props {
    kicker: string;
    name: string;
    text: string;
  }

  let { kicker, name, text }: Props = $props();
</script>

<div class="caption" aria-live="polite">
  <p class="kicker">{kicker}</p>
  <h2 class="name">{name}</h2>
  <p class="text">{text}</p>
</div>

<style>
  .caption {
    text-align: center;
    text-shadow: var(--shadow-text);
    pointer-events: none;
  }

  .kicker {
    margin: 0;
    font-family: var(--font-label);
    font-size: var(--text-label);
    letter-spacing: 0.14em;
    color: var(--color-lantern);
  }

  .name {
    margin: 6px 0 var(--space-2);
    font-family: var(--font-display);
    font-weight: 400;
    font-size: var(--text-place);
    line-height: 1.05;
  }

  .text {
    margin: 0;
    font-size: var(--text-body);
    line-height: 1.45;
    color: var(--color-mist);
  }
</style>
