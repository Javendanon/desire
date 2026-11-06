<!-- One line of the turn order. Every state is written out; the mark only repeats it visually. -->
<script lang="ts">
  import type { ParticipantView } from './tactical-view.ts';

  interface Props {
    view: ParticipantView;
    onopen: () => void;
    onadjust: (delta: number) => void;
  }

  let { view, onopen, onadjust }: Props = $props();
</script>

<li
  class="row"
  class:current={view.currentTurn}
  aria-current={view.currentTurn ? 'true' : undefined}
>
  <p class="line">
    {#if view.currentTurn}<strong>▶ Current turn:</strong>{/if}
    <button type="button" class="sheet-link" data-open-sheet={view.actorId} onclick={onopen}>
      {view.name}
    </button>
  </p>
  <p class="line">{view.initiativeText} · {view.dispositionText}</p>
  <div class="line hp">
    <span>{view.hpText}{view.hpEdited ? ' · local change' : ''}</span>
    {#if view.canAdjustHp}
      <span class="steps">
        <button
          type="button"
          class="sheet-control"
          aria-label={`Lower ${view.name}'s HP by 1, locally`}
          onclick={() => onadjust(-1)}
        >
          −1
        </button>
        <button
          type="button"
          class="sheet-control"
          aria-label={`Raise ${view.name}'s HP by 1, locally`}
          onclick={() => onadjust(1)}
        >
          +1
        </button>
      </span>
    {/if}
  </div>
  <p class="line">{view.conditionsText}{view.conditionsEdited ? ' · local change' : ''}</p>
  {#if view.concentrationText}<p class="line">◉ {view.concentrationText}</p>{/if}
  {#if view.visibilityText}<p class="line">{view.visibilityText}</p>{/if}
</li>

<style>
  .row {
    padding: var(--space-2);
    border: 1px solid var(--color-fog);
    border-radius: var(--radius);
  }

  .row.current {
    border: 2px solid var(--color-lantern);
  }

  .line {
    margin: 0;
    font-size: var(--text-ui-sm);
  }

  .hp {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }

  .steps {
    display: flex;
    gap: var(--space-1);
  }
</style>
