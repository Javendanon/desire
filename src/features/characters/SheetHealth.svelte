<!-- Hit points in words and a meter. A session edit shows the recorded value beside it. -->
<script lang="ts">
  import type { ActorState } from '../../generated/contracts.ts';
  import SheetSection from './SheetSection.svelte';
  import { healthView } from './sheet-view.ts';

  interface Props {
    state: ActorState;
    /** Set only when a session edit differs from the record. */
    recordedHp: number | null;
  }

  let { state, recordedHp }: Props = $props();

  const health = $derived(healthView(state));
</script>

<SheetSection title="Hit points">
  <p><strong>{health.text}</strong> · {health.status}</p>
  <div
    class="meter"
    role="meter"
    aria-label="Hit points"
    aria-valuemin={0}
    aria-valuemax={state.max_hp}
    aria-valuenow={state.current_hp}
    aria-valuetext={health.text}
  >
    <div class="fill" style:width={`${health.percent}%`}></div>
  </div>
  {#if health.temporary}<p>{health.temporary}</p>{/if}
  {#if recordedHp !== null}
    <p class="edited">Local change, not saved. Recorded value: {recordedHp} HP.</p>
  {/if}
</SheetSection>

<style>
  .meter {
    height: 6px;
    margin-bottom: var(--space-2);
    background: var(--color-rule);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--color-mist);
  }

  .edited {
    font-size: var(--text-ui-sm);
    color: var(--color-lantern);
  }
</style>
