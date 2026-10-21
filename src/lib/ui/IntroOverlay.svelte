<script lang="ts">
  import Button from './Button.svelte';

  interface Props {
    open: boolean;
    kicker: string;
    title: string;
    subtitle: string;
    onenter: () => void;
  }

  let { open, kicker, title, subtitle, onenter }: Props = $props();
</script>

<div class="bar top" class:gone={!open} aria-hidden="true"></div>
<div class="bar bottom" class:gone={!open} aria-hidden="true"></div>
<div class="intro" class:gone={!open} inert={!open}>
  <p class="kicker">{kicker}</p>
  <h1 class="title">{title}</h1>
  <p class="subtitle">{subtitle}</p>
  <div class="enter">
    <Button onclick={onenter}>Entrar a la mesa</Button>
  </div>
</div>

<style>
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    height: 11vh;
    background: #050809;
    pointer-events: none;
    transition: transform 1200ms var(--ease-sweep);
  }

  .top {
    top: 0;
  }

  .bottom {
    bottom: 0;
  }

  .top.gone {
    transform: translateY(-100%);
  }

  .bottom.gone {
    transform: translateY(100%);
  }

  .intro {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    text-align: center;
    text-shadow: 0 2px 24px rgba(0, 0, 0, 0.7);
    transition: opacity 900ms ease;
  }

  .intro.gone {
    opacity: 0;
    pointer-events: none;
  }

  .kicker,
  .title,
  .subtitle,
  .enter {
    margin: 0;
    animation: rise var(--duration-title) var(--ease-settle) both;
  }

  .kicker {
    font-family: var(--font-label);
    font-size: var(--text-ui);
    letter-spacing: var(--tracking-kicker);
    color: var(--color-lantern);
    animation-delay: 1200ms;
  }

  .title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: var(--text-title);
    line-height: 0.9;
    letter-spacing: 0.04em;
    animation-delay: 1600ms;
  }

  .subtitle {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-voice);
    color: var(--color-mist);
    animation-delay: 2300ms;
  }

  .enter {
    margin-top: 18px;
    animation-delay: 3600ms;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(18px);
      letter-spacing: 0.18em;
    }

    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
