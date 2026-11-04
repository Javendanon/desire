<!-- Decorative particles from a bounded plan. Hidden from assistive tech; carries no meaning. -->
<script lang="ts">
  import type { Particle } from './effects.ts';

  interface Props {
    particles: readonly Particle[];
  }

  let { particles }: Props = $props();
</script>

<div class="field" aria-hidden="true">
  {#each particles as particle (particle.id)}
    <span
      class="particle"
      style:left={`${particle.leftPercent}%`}
      style:animation-delay={`${particle.delayMs}ms`}
    ></span>
  {/each}
</div>

<style>
  .field {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .particle {
    position: absolute;
    bottom: 0;
    width: 3px;
    height: 3px;
    background: var(--color-lantern);
    opacity: 0;
    animation: rise var(--duration-title) ease-out infinite;
    will-change: transform, opacity;
  }

  @keyframes rise {
    0% {
      transform: translateY(0);
      opacity: 0;
    }

    30% {
      opacity: 0.55;
    }

    100% {
      transform: translateY(-64px);
      opacity: 0;
    }
  }
</style>
