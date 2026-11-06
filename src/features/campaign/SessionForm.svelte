<!--
  Opens a session. Shown to DMs only for clarity. The API still rejects anyone else, and that
  rejection is displayed here rather than assumed impossible.
-->
<script lang="ts">
  import FailureNotice from '../../app/FailureNotice.svelte';
  import { t } from '../../app/messages.ts';
  import type { Id } from '../../generated/contracts.ts';
  import { createSession } from '../../lib/api/campaigns.ts';
  import type { ApiContext } from '../../lib/api/client.ts';
  import { TITLE_MAX_LENGTH, validateTitle } from './forms.ts';

  interface Props {
    api: ApiContext;
    campaignId: Id;
    oncreated: () => void;
    /** A failed write may still have committed, so the owner re-reads the sessions. */
    onfailed: () => void;
  }

  let { api, campaignId, oncreated, onfailed }: Props = $props();

  let title = $state('');
  let titleError = $state('');
  let failure = $state<unknown>(null);
  let submitting = $state(false);
  let titleInput = $state<HTMLInputElement>();

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const invalid = validateTitle(title);
    titleError = invalid ? t(invalid) : '';
    if (invalid) {
      titleInput?.focus();
      return;
    }
    failure = null;
    submitting = true;
    try {
      await createSession(api, campaignId, { title: title.trim() });
      title = '';
      oncreated();
    } catch (error) {
      failure = error;
      onfailed();
    } finally {
      submitting = false;
    }
  }
</script>

<form class="form" novalidate onsubmit={submit}>
  <div class="field">
    <label for="session-title">{t('session.title_label')}</label>
    <input
      bind:this={titleInput}
      bind:value={title}
      id="session-title"
      type="text"
      autocomplete="off"
      maxlength={TITLE_MAX_LENGTH}
      aria-invalid={titleError ? 'true' : undefined}
      aria-describedby={titleError ? 'session-title-error' : undefined}
    />
    {#if titleError}<p id="session-title-error" class="field-error">{titleError}</p>{/if}
  </div>
  <button class="action" type="submit" aria-disabled={submitting}>
    {submitting ? t('form.creating') : t('session.create')}
  </button>
  {#if failure}
    <FailureNotice error={failure} title={t('session.create_failed')} />
    <p class="hint">{t('form.create_failed_hint')}</p>
  {/if}
</form>

<style>
  .form {
    display: grid;
    gap: var(--space-3);
  }

  .hint {
    margin: 0;
    color: var(--color-mist);
    font-size: var(--text-ui-sm);
  }
</style>
