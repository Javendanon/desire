<script lang="ts">
  import { toneColor, type Choice, type StoryLine } from './table-view.ts';

  interface Props {
    lines: readonly StoryLine[];
    choices?: readonly Choice[];
    onchoose?: (index: number) => void;
  }

  let { lines, choices = [], onchoose }: Props = $props();
</script>

<section class="panel" aria-label="Narración" aria-live="polite">
  {#each lines as line, index (index)}
    <div class="line">
      <p class="speaker" style:color={toneColor(line.tone)}>{line.speaker}</p>
      <p class="text" class:voice={line.tone === 'voice'}>{line.text}</p>
    </div>
  {/each}
  {#each choices as choice, index (choice.text)}
    <button type="button" class="choice" onclick={() => onchoose?.(index)}>
      <span class="number">{index + 1}.</span>
      <span>{choice.text} {#if choice.tag}<span class="tag">{choice.tag}</span>{/if}</span>
    </button>
  {/each}
</section>

<style>
  .panel {
    padding: 22px var(--space-5) var(--space-3);
    background: var(--color-hull-glass);
    border: 1px solid var(--color-fog);
    border-radius: var(--radius);
  }

  .line {
    margin-bottom: 14px;
  }

  .speaker {
    margin: 0 0 var(--space-1);
    font-family: var(--font-label);
    font-size: var(--text-label);
    letter-spacing: var(--tracking-label);
  }

  .text {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-voice);
    line-height: 1.4;
  }

  .voice {
    font-style: italic;
  }

  .choice {
    display: flex;
    gap: var(--space-3);
    width: 100%;
    padding: 10px 0;
    text-align: left;
    background: none;
    border: 0;
    border-top: 1px solid var(--color-rule);
    color: var(--color-parchment);
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    line-height: 1.4;
    cursor: pointer;
  }

  .choice:hover {
    color: var(--color-lantern);
  }

  .number {
    font-family: var(--font-label);
    font-weight: 700;
    color: var(--color-lantern);
  }

  .tag {
    color: var(--color-ash);
  }
</style>
