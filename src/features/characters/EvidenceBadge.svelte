<!-- How far a record can be trusted: a text mark and a word, so colour is not the only signal. -->
<script lang="ts">
  import type { Provenance } from '../../generated/contracts.ts';
  import { evidenceBadge, type EvidenceBadge } from './sheet-model.ts';

  interface Props {
    provenance: Provenance;
    /** Overrides the wording when the record's reach is narrower than its evidence level. */
    wording?: EvidenceBadge;
  }

  let { provenance, wording }: Props = $props();

  const badge = $derived(wording ?? evidenceBadge(provenance.evidence));
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
