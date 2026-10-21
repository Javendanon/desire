<script lang="ts">
  interface Props {
    message: string;
  }

  let { message }: Props = $props();
</script>

<p class="toast" role="status">{message}</p>

<style>
  .toast {
    margin: 0;
    padding: 10px 18px;
    background: var(--color-ink);
    border: 1px solid var(--color-lantern);
    border-radius: var(--radius);
    font-family: var(--font-display);
    font-size: 20px;
    white-space: nowrap;
  }
</style>
