<script lang="ts">
  import { onMount } from 'svelte';

  let api = $state('Comprobando conexión…');
  let engine = $state('Comprobando biblioteca…');

  onMount(() => {
    const controller = new AbortController();
    let disposed = false;

    void fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('API no disponible');
        const body: unknown = await response.json();
        if (disposed) return;
        api = typeof body === 'object' && body !== null &&
          'service' in body && body.service === 'desire-api' &&
          'status' in body && body.status === 'ok'
          ? 'Servidor Rust conectado'
          : 'Respuesta de servidor no reconocida';
      })
      .catch(() => {
        if (!disposed) api = 'Servidor pendiente · ejecuta pnpm dev:api';
      });

    void import('playcanvas')
      .then((pc) => {
        if (!disposed) engine = `PlayCanvas ${pc.version} importado · GPU aún no comprobada`;
      })
      .catch(() => {
        if (!disposed) engine = 'No se pudo importar PlayCanvas';
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  });
</script>

<svelte:head><title>Desire · Entorno de desarrollo</title></svelte:head>

<main>
  <img src="/assets/mark.svg" alt="" width="40" height="40" />
  <p class="eyebrow">DESIRE / DESARROLLO</p>
  <h1>El viaje empieza en Waterdeep.</h1>
  <p>Base del entorno. El diseño de la mesa y las reglas de código se definirán a continuación.</p>
  <ul aria-label="Estado del entorno" aria-live="polite">
    <li>Svelte 5 y TypeScript</li>
    <li>{api}</li>
    <li>{engine}</li>
    <li>PostgreSQL y WebAssembly: verificación externa pendiente</li>
  </ul>
</main>

<style>
  :global(body) { margin: 0; background: #f4f3ed; color: #25392f; font-family: system-ui, sans-serif; }
  main { max-width: 46rem; margin: 12vh auto; padding: 2rem; }
  .eyebrow { font-size: .75rem; letter-spacing: .14em; margin-top: 2rem; }
  h1 { font-size: clamp(2rem, 6vw, 3.5rem); font-weight: 600; line-height: 1.1; }
  p, li { line-height: 1.7; }
  ul { padding: 1.5rem 1.5rem 1.5rem 2.5rem; border: 1px solid #c4cec4; border-radius: .75rem; }
</style>
