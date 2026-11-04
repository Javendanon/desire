<!-- What the actor has: classes, features, equipment, resources and proficiencies. -->
<script lang="ts">
  import RuleDetails from './RuleDetails.svelte';
  import SheetSection from './SheetSection.svelte';
  import type { RuleBook } from './rule-book.ts';
  import type { ActorSheet } from './sheet-model.ts';
  import {
    classRows,
    equipmentText,
    featureRules,
    proficiencyText,
    resourceText,
  } from './sheet-rows.ts';
  import { totalLevel } from './sheet-view.ts';

  interface Props {
    sheet: ActorSheet;
    rules: RuleBook;
  }

  let { sheet, rules }: Props = $props();

  const classes = $derived(classRows(sheet, rules));
  const features = $derived(featureRules(sheet, rules));
</script>

{#if classes.length > 0}
  <SheetSection title={`Classes · level ${totalLevel(sheet.classes)}`}>
    <ul>
      {#each classes as entry (entry.id)}
        <li>
          <RuleDetails rule={entry.rule} />
          <p>Level {entry.level} · hit die {entry.hitDie}</p>
          {#if entry.subclass}<RuleDetails rule={entry.subclass} />{/if}
        </li>
      {/each}
    </ul>
  </SheetSection>
{/if}

{#if features.length > 0}
  <SheetSection title="Class features">
    <ul>
      {#each features as feature, index (index)}
        <li><RuleDetails rule={feature} /></li>
      {/each}
    </ul>
  </SheetSection>
{/if}

<SheetSection title="Equipment">
  {#if sheet.equipment.length === 0}
    <p>No equipment recorded.</p>
  {:else}
    <ul>
      {#each sheet.equipment as item (item.id)}
        <li>{equipmentText(item)}</li>
      {/each}
    </ul>
  {/if}
</SheetSection>

{#if sheet.resources.length > 0}
  <SheetSection title="Resources">
    <ul>
      {#each sheet.resources as resource (resource.name)}
        <li>{resourceText(resource)}</li>
      {/each}
    </ul>
  </SheetSection>
{/if}

{#if sheet.proficiencies.length > 0}
  <SheetSection title="Proficiencies">
    <ul>
      {#each sheet.proficiencies as entry (`${entry.category}:${entry.name}`)}
        <li>{proficiencyText(entry)}</li>
      {/each}
    </ul>
  </SheetSection>
{/if}
