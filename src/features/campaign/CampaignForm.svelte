<!-- Creates a campaign. A failed write may still have committed, so failure reloads the list. -->
<script lang="ts">
  import { onDestroy } from 'svelte';

  import FailureNotice from '../../app/FailureNotice.svelte';
  import { t } from '../../app/messages.ts';
  import type { Campaign, RulesEdition } from '../../generated/contracts.ts';
  import { createCampaign } from '../../lib/api/campaigns.ts';
  import type { ApiContext } from '../../lib/api/client.ts';
  import { withSignal } from './api-context.ts';
  import {
    DEFAULT_EDITION,
    EDITION_OPTIONS,
    NAME_MAX_LENGTH,
    newCampaign,
    validateName,
  } from './forms.ts';

  interface Props {
    api: ApiContext;
    oncreated: (campaign: Campaign) => void;
    onfailed: () => void;
  }

  let { api, oncreated, onfailed }: Props = $props();

  let name = $state('');
  let edition = $state<RulesEdition>(DEFAULT_EDITION);
  let nameError = $state('');
  let failure = $state<unknown>(null);
  let submitting = $state(false);
  let nameInput = $state<HTMLInputElement>();

  // Leaving the hub cancels the wait: a late answer must not pull the user out of another campaign.
  const lifetime = new AbortController();
  onDestroy(() => lifetime.abort());

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const invalid = validateName(name);
    nameError = invalid ? t(invalid) : '';
    if (invalid) {
      nameInput?.focus();
      return;
    }
    failure = null;
    submitting = true;
    try {
      const context = withSignal(api, lifetime.signal);
      const created = await createCampaign(context, newCampaign(name, edition));
      if (!lifetime.signal.aborted) oncreated(created);
    } catch (error) {
      if (lifetime.signal.aborted) return;
      failure = error;
      onfailed();
    } finally {
      submitting = false;
    }
  }
</script>

<form class="form" novalidate onsubmit={submit}>
  <div class="field">
    <label for="campaign-name">{t('form.campaign_name')}</label>
    <input
      bind:this={nameInput}
      bind:value={name}
      id="campaign-name"
      type="text"
      autocomplete="off"
      maxlength={NAME_MAX_LENGTH}
      aria-invalid={nameError ? 'true' : undefined}
      aria-describedby={nameError ? 'campaign-name-error' : undefined}
    />
    {#if nameError}<p id="campaign-name-error" class="field-error">{nameError}</p>{/if}
  </div>
  <div class="field">
    <label for="campaign-edition">{t('form.campaign_edition')}</label>
    <select id="campaign-edition" bind:value={edition}>
      {#each EDITION_OPTIONS as option (option.value)}
        <option value={option.value}>{t(option.label)}</option>
      {/each}
    </select>
  </div>
  <button class="action primary" type="submit" aria-disabled={submitting}>
    {submitting ? t('form.creating') : t('form.create_campaign')}
  </button>
  {#if failure}
    <FailureNotice error={failure} title={t('form.create_failed')} />
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
