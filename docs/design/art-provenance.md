# Art and text provenance

Every visual and written element in this prototype is either original work for card D03 or an
existing repository asset with a recorded origin. No atlas image, path, coordinate or prose was
copied. The prototype makes no network request at runtime.

| Asset | Origin | Status |
| --- | --- | --- |
| Map illustration | Inline SVG authored for this card in `prototype/index.html`. Abstract wards, roads, canal, wall, coastline and labels. | Original. |
| Map markers | HTML buttons positioned by percentage over the SVG using `lore-data.js` coordinates. | Original. |
| Brand mark | `public/assets/mark.svg`, present in the repository snapshot `7f3d994`. | Reused as is. |
| Lore summaries | Written for this card in `prototype/lore-data.js`. Spanish, one or two sentences per entry. | Original. |
| Character names, stats and notes | Written for this card. | Original, not imported from any rulebook. |
| Scenario summaries | Written for this card. | Original. |
| `public/assets/abbey.png`, `public/assets/abbey.jpg` | Present in the repository snapshot `7f3d994` with no recorded author, licence or source. | **Not used.** Flagged for the asset owner (card D18) to document or remove. |
| Fonts | No font file is bundled and none is downloaded. The stack tries Geist, then Manrope, then Avenir Next, then the system UI. | No provenance needed; nothing is redistributed. |
| Icon sets | None. Navigation uses Spanish words instead of glyphs. | No dependency. |

## Waterdeep reference

`docs/waterdeep-atlas.md` records the external atlas by Jason Engle and the AideDD viewer. That
document informs the intent only: a recognizable, uncluttered city and a place based lore search.
The prototype does not embed the atlas image, its overlay geometry, its data scripts or its text,
and it stores no distance or scale claim. Place names such as Puerto Profundo, Castillo Waterdeep
or Portal Bostezante are used as campaign references; the sentences around them are original.

The repository document explicitly notes that the atlas cannot be treated as a runtime dependency
during a session. The prototype agrees: with the local files it renders fully offline, and the
map is an interpretation for layout review, not a calibrated cartographic product. Calibration
belongs to card D05 and scene generation to D13.
