<!-- App shell: owns the route, connection state and focus. Features own everything else. -->
<script lang="ts">
  import { onMount, tick } from 'svelte';

  import { connectionState, ServerMonitor, type ConnectionState } from './app/connection.ts';
  import { browserStorage, createDevIdentity, resolveDevIdentity } from './app/identity.ts';
  import { t, type MessageKey } from './app/messages.ts';
  import {
    focusTarget,
    formatRoute,
    HUB_ROUTE,
    MAIN_CONTENT_ID,
    parseRoute,
    placeButtonId,
    type FocusTarget,
    type Route,
  } from './app/routes.ts';
  import StatusNotice from './app/StatusNotice.svelte';
  import { createApiContext } from './features/campaign/api-context.ts';
  import CampaignHub from './features/campaign/CampaignHub.svelte';
  import CampaignWorkspace from './features/campaign/CampaignWorkspace.svelte';

  const CONNECTION_LABELS: Readonly<Record<ConnectionState, MessageKey>> = {
    checking: 'connection.checking',
    online: 'connection.online',
    offline: 'connection.offline',
    server_down: 'connection.server_down',
  };

  const PROBE_INTERVAL_MS = 30_000;
  const PROBE_TIMEOUT_MS = 5_000;

  const api = createApiContext(resolveDevIdentity(browserStorage, createDevIdentity));

  let route = $state<Route>(parseRoute(location.hash));
  let browserOnline = $state(navigator.onLine);
  let serverReachable = $state<boolean | null>(null);
  let main = $state<HTMLElement>();

  const connection = $derived(connectionState(browserOnline, serverReachable));

  function applyFocus(target: FocusTarget): void {
    if (!target) return;
    const place = target.kind === 'place' ? placeButtonId(target.placeId) : '';
    const element = document.getElementById(place) ?? main;
    element?.focus();
  }

  function show(next: Route): void {
    const target = focusTarget(route, next);
    route = next;
    void tick().then(() => applyFocus(target));
  }

  // Browsers may rate-limit this call on every keystroke. The screen must not depend on it: the
  // address simply catches up on the next edit.
  function replaceAddress(hash: string): void {
    try {
      history.replaceState(null, '', hash);
    } catch (error) {
      console.warn('The browser refused to update the address', error);
    }
  }

  function navigate(next: Route, options: { replace?: boolean } = {}): void {
    const hash = formatRoute(next);
    if (options.replace) {
      replaceAddress(hash);
      show(next);
    } else if (location.hash === hash) {
      show(next);
    } else {
      location.hash = hash;
    }
  }

  function skipToContent(event: MouseEvent): void {
    event.preventDefault();
    main?.focus();
  }

  const monitor = new ServerMonitor(
    (input, init) => fetch(input, init),
    (reachable) => (serverReachable = reachable),
    PROBE_TIMEOUT_MS,
  );

  onMount(() => {
    monitor.check();
    const interval = setInterval(() => monitor.check(), PROBE_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      monitor.dispose();
    };
  });

  function wentOnline(): void {
    browserOnline = true;
    monitor.check();
  }
</script>

<svelte:window
  onhashchange={() => show(parseRoute(location.hash))}
  ononline={wentOnline}
  onoffline={() => (browserOnline = false)}
/>
<svelte:head><title>{t('app.title')}</title></svelte:head>

<div class="shell">
  <a class="skip" href={formatRoute(route)} onclick={skipToContent}>{t('app.skip')}</a>
  <header class="bar">
    <a class="brand" href={formatRoute(HUB_ROUTE)}>
      <img src="/assets/mark.svg" alt="" width="24" height="24" />
      {t('app.name')}
    </a>
    <p
      class="connection"
      class:bad={connection === 'offline' || connection === 'server_down'}
      role="status"
    >
      {t(CONNECTION_LABELS[connection])}
    </p>
  </header>
  <main
    bind:this={main}
    id={MAIN_CONTENT_ID}
    class="content"
    tabindex="-1"
    aria-label={t('app.main')}
  >
    {#if route.view === 'campaign'}
      {#key route.campaignId}
        <CampaignWorkspace {api} {route} onnavigate={navigate} />
      {/key}
    {:else if route.view === 'hub'}
      <CampaignHub {api} onnavigate={navigate} />
    {:else}
      <div class="missing">
        <StatusNotice tone="error" title={t('route.missing')} />
        <a class="action" href={formatRoute(HUB_ROUTE)}>{t('route.back_to_hub')}</a>
      </div>
    {/if}
  </main>
</div>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 100%;
  }

  .skip {
    position: absolute;
    top: var(--space-1);
    left: var(--space-1);
    z-index: 10;
    padding: var(--space-2) var(--space-3);
    background: var(--color-ink);
    transform: translateY(-200%);
  }

  .skip:focus {
    transform: none;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-hull);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-height);
    color: var(--color-parchment);
    font-family: var(--font-display);
    font-size: var(--text-voice);
    text-decoration: none;
  }

  .connection {
    margin: 0;
    color: var(--color-ash);
    font-size: var(--text-ui-sm);
  }

  .connection.bad {
    color: var(--color-ember);
  }

  .content {
    min-width: 0;
    outline: none;
  }

  .missing {
    display: grid;
    justify-items: start;
    gap: var(--space-3);
    max-width: 40rem;
    margin: var(--space-7) auto;
    padding: 0 var(--space-4);
  }
</style>
