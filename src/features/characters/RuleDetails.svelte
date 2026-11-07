<!-- One referenced rule: its name, its text in its own language, its source and any problem. -->
<script lang="ts">
  import type { RuleSummary } from './rule-book.ts';

  interface Props {
    rule: RuleSummary;
  }

  let { rule }: Props = $props();
</script>

<details class="rule">
  <summary lang={rule.language ?? undefined}>{rule.name}</summary>
  {#if rule.body}
    <p lang={rule.language ?? undefined}>{rule.body}</p>
  {/if}
  <p class="source">Source: {rule.source}</p>
</details>
{#if rule.problem}
  <p class="problem"><strong>Check this rule:</strong> {rule.problem}</p>
{/if}

<style>
  .rule summary {
    cursor: pointer;
    min-height: 24px;
  }

  p {
    margin: var(--space-1) 0;
    font-size: var(--text-ui-sm);
  }

  .source {
    color: var(--color-ash);
  }

  .problem {
    padding-left: var(--space-2);
    border-left: 2px solid var(--color-ember);
  }
</style>
