<!-- Renders any caught failure through StatusNotice, with the request id for support. -->
<script lang="ts">
  import { describeFailure } from '../features/campaign/failures.ts';
  import { t } from './messages.ts';
  import StatusNotice from './StatusNotice.svelte';

  interface Props {
    error: unknown;
    title: string;
    onretry?: () => void;
  }

  let { error, title, onretry }: Props = $props();

  const report = $derived(describeFailure(error, navigator.onLine));
  const detail = $derived(
    report.requestId
      ? `${report.message} ${t('failure.request_id', { id: report.requestId })}`
      : report.message,
  );
</script>

<StatusNotice tone="error" {title} {detail} {onretry} />
