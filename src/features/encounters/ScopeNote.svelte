<!-- States how far the interactions next to it reach. -->
<script lang="ts">
  import { scopeNote, type InteractionScope } from './interaction-scope.ts';

  interface Props {
    scope: InteractionScope;
  }

  let { scope }: Props = $props();

  const note = $derived(scopeNote(scope));
</script>

<p class="scope"><strong>{note.label}.</strong> {note.text}</p>

<style>
  .scope {
    margin: 0;
    font-size: var(--text-ui-sm);
    color: var(--color-mist);
  }

  strong {
    color: var(--color-parchment);
  }
</style>
