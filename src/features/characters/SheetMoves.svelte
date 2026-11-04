<!-- What the actor can do, as text only: nothing here rolls dice or prepares a spell. -->
<script lang="ts">
  import RuleDetails from './RuleDetails.svelte';
  import SheetSection from './SheetSection.svelte';
  import type { RuleBook } from './rule-book.ts';
  import type { ActorSheet } from './sheet-model.ts';
  import { actionGroups, emptyActionsText, spellRows } from './sheet-rows.ts';

  interface Props {
    sheet: ActorSheet;
    rules: RuleBook;
  }

  let { sheet, rules }: Props = $props();

  const groups = $derived(actionGroups(sheet.actions));
  const spells = $derived(spellRows(sheet, rules));
</script>

<SheetSection title="Actions">
  {#if groups.length === 0}
    <p>{emptyActionsText(sheet)}</p>
  {:else}
    {#each groups as group (group.label)}
      <p><strong>{group.label}</strong></p>
      <ul>
        {#each group.actions as action (action.id)}
          <li><strong>{action.name}.</strong> {action.description}</li>
        {/each}
      </ul>
    {/each}
  {/if}
</SheetSection>

<SheetSection title="Spells">
  {#if spells.length === 0}
    <p>No spells recorded.</p>
  {:else}
    <ul>
      {#each spells as spell (spell.id)}
        <li>
          <RuleDetails rule={spell.rule} />
          <p>{spell.preparation}, as recorded</p>
        </li>
      {/each}
    </ul>
  {/if}
</SheetSection>
