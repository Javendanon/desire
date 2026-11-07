<!-- A titled block of a sheet. Lists inside share this spacing, so the sections stay uniform. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    children: Snippet;
  }

  let { title, children }: Props = $props();
</script>

<section class="section">
  <h4>{title}</h4>
  {@render children()}
</section>

<style>
  .section {
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-rule);
  }

  h4 {
    margin: 0 0 var(--space-2);
    font-family: var(--font-label);
    font-size: var(--text-label);
    font-weight: 400;
    letter-spacing: var(--tracking-label);
    color: var(--color-ash);
  }

  .section :global(ul) {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .section :global(p) {
    margin: 0 0 var(--space-1);
  }
</style>
