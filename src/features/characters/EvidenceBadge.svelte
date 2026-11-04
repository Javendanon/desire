<!-- How far a record can be trusted: a text mark and a word, so colour is not the only signal. -->
<script lang="ts">
  import type { Provenance } from '../../generated/contracts.ts';
  import { evidenceBadge } from './sheet-model.ts';

  interface Props {
    provenance: Provenance;
  }

  let { provenance }: Props = $props();

  const badge = $derived(evidenceBadge(provenance.evidence));
</script>

<p class="evidence">
  <strong class="mark"><span aria-hidden="true">{badge.glyph}</span> {badge.label}</strong>
  <span>{badge.detail} Source: {provenance.attribution}.</span>
</p>

<style>
  .evidence {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: 1px dashed var(--color-fog-strong);
    border-radius: var(--radius);
    font-size: var(--text-ui-sm);
    color: var(--color-mist);
  }

  .mark {
    font-family: var(--font-label);
    letter-spacing: var(--tracking-label);
    color: var(--color-parchment);
  }
</style>
