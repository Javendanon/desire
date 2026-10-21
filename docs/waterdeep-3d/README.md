# Waterdeep 3D diorama

Branch `task/waterdeep-3d-diorama`. Goal set by the project owner on 2026-10-20: turn the Waterdeep
city map into a navigable 3D diorama with the visual quality of the design canvas
(<https://claude.ai/artifact/7g4jHdGAfSRdwYTMst4ZVg>, "Farol en la niebla") or better. It should
look like a game without being one, support animated movement and smooth zoom between city, ward
and scene, and never read as low-poly "PS2" graphics.

Licence position, decided by the owner: personal, non-commercial project. Source rasters and
downloaded data stay under ignored `outputs/` or outside the repository and are never
redistributed. Only derived, attributed layers enter the repository.

## Sources

| Source | What it gives | Where it lives |
| --- | --- | --- |
| AideDD atlas, map art by Jason Engle | 3560 × 7256 px raster (building-level painting, street names printed on it); 768 markers in `dataW.js` | `outputs/waterdeep-sources/aidedd/`, verified against the D05 SHA-256 values |
| Tych Maps (<https://tychmaps.com/waterdeep/>) | Battle-map-scale painting of the whole city on a 5 ft grid, no printed labels; z18 stitch is 6319 × 9136 px. Vector layers: 312 named street centrelines, 8 ward polygons, about 580 named points of interest, the 5 ft grid | Owner's local copy `~/dev/waterdeep-map/` (not in the repository) |
| Official art (Dragon Heist) | Mood reference: golden-hour backlight, layered haze, steep slate roofs, chimney smoke, the castle's many spires, tall ships, the lighthouse | Visual reference only |

No navigable 3D Waterdeep was found: existing work is 2D interactive maps (AideDD, Tych Maps,
Forgotten Maps, the Fandom wiki), a 2.5D animated map on Sketchfab and a Minecraft build.

## Registration: Tych into the D05 frame

- Tych geometry is authored in UTM metres: grid lines are exactly 1.524 m (5 ft) apart.
- Eleven names appear in both D05 and Tych. A similarity fit over the nine point-like ones
  (gates and small landmarks; the Market and the Castle are areas) gives rotation ≈ 0° and a median
  residual of 14 m, about one building.
- **Scale conflict.** Every gate-to-gate distance is 1.84 ± 0.01 times longer in D05 than in Tych
  (ten pairs). The geometry agrees; the scales do not. D05 takes AideDD's `310 px = 1000 ft`;
  Tych draws on a 5 ft battle grid. North Gate to South Gate is 5,414 m in D05 and 2,934 m in Tych.
  The choice changes building sizes, travel times (D12/D14) and the D05/D13 frame; it is open
  below.

## Plan

1. **Layers from the sources** (D18's "semantic interpretation" step): water and shore, city wall
   and towers, street network (Tych centrelines), blocks, building footprints (segmented from the
   label-free Tych raster), parks and the City of the Dead, piers, relief. Each layer carries
   provenance and a review state.
2. **Vertical slice: Dock Ward and the Market.** Diorama at target quality: dense blocks with varied
   silhouettes, chimney smoke, shaded water and ships, golden-hour light with layered haze, smooth
   city → ward → scene zoom. Measured (frame time, memory) and compared side by side with the design
   canvas and the reference art.
3. **Whole city**, with the castle and landmarks as authored pieces.

## Decisions

- **World scale: Tych's 5 ft grid** (owner, 2026-10-21). Buildings and streets are drawn for that
  grid, so houses get credible medieval sizes and the tactical scene's 5 ft cells need no
  conversion. Consequence: D05's calibration (`meters_per_pixel` 0.983, from AideDD's
  `310 px = 1000 ft`) is replaced by a new D04 map-version revision scaled by 1 / 1.84, and D13's
  Waterdeep content is rescaled with it. Until that revision lands, layers are produced in the
  Tych frame and converted through one documented transform.

## Layer extraction: first pass (Dock Ward)

An exploratory per-pixel classifier on the label-free Tych raster (hue and saturation rules,
5 × 5 majority filter) already separates roof masses, paved streets, red landmark roofs and open
water. Known errors to fix before building footprints: shallow shore water reads as street or
ground (same colour, but smooth and connected to open water); piers read as roofs (they touch
water and lie outside the land mask); narrow dirt lanes merge adjacent blocks (Tych's street
centrelines, rasterised at their width, force them open).
