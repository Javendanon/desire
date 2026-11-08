# Trollskull Manor (D32)

`floor-plan.json` describes Trollskull Manor as data. That one file feeds three things: the movement
rules of the interior scene, the 3D model built by D33 and the camera paths of the prologue. It
follows the `FloorPlan` contract in `contracts/schema.json`. The furniture kinds come from
`content/props/catalog.json` (`PropCatalog`).

## Source

The layout was transcribed by hand from the players' floor plan (*Waterdeep: Dragon Heist*,
appendix C) and the colour map by Lios, at 1 square = 5 ft. **The images are not in this public
repository**: only our own transcription lives here. Where the two sources disagree, or the plan is
ambiguous, the transcription chooses the reading that plays better at the table:

- the stairs between the tavern and the first-floor landing;
- the door from the outside stairs into the tavern;
- the furniture positions.

The **giant slide** is not on any plan. It came up in the campaign: it starts at the top of the
turret, runs around the outside of the house about 0.9 m from the walls (north front, east side,
south side) on a gentle slope, then drops down the west side into the alley in front of the tavern
door. A spiral hugging the tower would cut through the first floor, which is built against it.

## Coordinates

- Each floor has its own grid. `x` grows east and `y` grows south, as on the plan.
- `origin_x`/`origin_y` place a floor's grid over the ground floor, so the floors stack.
- `elevation_m` is the height of the floor's surface. `cell_size_m` is 1.524 (5 ft).
- A room is one or more cell rectangles. `chamfer` cuts the outer corners of an octagonal
  turret in the model; for movement every square of the rectangle is walkable.
- Doors, windows and openings sit on the edge of a cell (`side`: n, e, s or w).
- Furniture rotates in quarter turns. A turn of 90 or 270 swaps its width and depth. `x`/`y` is
  always the north-west square of the footprint *after* the turn.
- Links join cells on different floors: stairs, a ladder, the cellar trapdoor and the slide. The
  slide is one-way (`two_way: false`) and carries its spiral path in metres.

## Rules derived from the data

- **Walls** (`floorEdges`): wherever an indoor room meets another room or the outside, with doors
  and windows cut into them. Two outdoor areas never share a wall, and an opening is left empty.
  Between an indoor room and the outside, the wall takes the finish of the indoor room. Between two
  indoor rooms it takes the finish of the room listed first in the floor.
- **Movement** (`floor-board.ts`): one square per move, and a diagonal also counts as one, as in
  D&D. The edge between two squares is passable when any of these holds:
  - both squares belong to the same room;
  - both are outdoors;
  - an opening sits on the edge;
  - an open door sits on the edge.

  A diagonal is legal only when both orthogonal detours are, so it never cuts a wall corner.
  Furniture with `blocks: true` fills its squares.

## Editing

1. Change `floor-plan.json` or `catalog.json`.
2. Run `node --test tests/floor-plan.test.ts`. The validation names each problem by id: overlapping
   rooms, a door off a room's edge, furniture outside a room or on top of other furniture, a link to
   a square that does not exist. The suite also checks that, with every door open, every room can
   be reached from the tavern, so a misplaced bed cannot seal off a room.
3. Run `python3 -m unittest discover -s tools/contracts/tests -p 'test_*.py'` to check the
   contract.

Colours and materials live in the data: `floor_material`, `wall_material` and `tint` per room, and
`variant` per piece of furniture, chosen from the catalogue. The DM editor (D36) will save
per-campaign changes on top of this file without editing it.
