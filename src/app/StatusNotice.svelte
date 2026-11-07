<!-- One visual and spoken form for loading, empty and failure states, with an optional retry. -->
<script lang="ts">
  import Button from '../lib/ui/Button.svelte';
  import { t } from './messages.ts';
  import { MAIN_CONTENT_ID } from './routes.ts';

  interface Props {
    tone?: 'info' | 'error';
    title: string;
    detail?: string;
    onretry?: () => void;
  }

  let { tone = 'info', title, detail, onretry }: Props = $props();

  // Retrying usually replaces this notice, which would drop focus to the document body.
  function retry(): void {
    document.getElementById(MAIN_CONTENT_ID)?.focus();
    onretry?.();
  }
</script>

<div class="notice" class:error={tone === 'error'} role={tone === 'error' ? 'alert' : 'status'}>
  <p class="title">{title}</p>
  {#if detail}<p class="detail">{detail}</p>{/if}
  {#if onretry}<Button onclick={retry}>{t('action.retry')}</Button>{/if}
</div>

<style>
  .notice {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius);
    background: var(--color-hull);
  }

  .error {
    border-color: var(--color-ember);
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-voice);
  }

  .detail {
    margin: 0;
    color: var(--color-mist);
  }
</style>
