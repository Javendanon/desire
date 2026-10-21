# Motion

Motion explains where things are and what changed. It never decorates.

| Moment | What moves | Timing |
| --- | --- | --- |
| Intro | Camera flies from water level at the harbour mouth, past the ships, up over the city. Letterbox bars frame it. The kicker, title, subtitle and button rise in sequence. | Flight about 8 s; title from 1.2 s to 3.6 s; bars sweep out in 1.2 s on entering. |
| Zoom | City, district and scene are camera positions; the camera eases between them. | Damped approach, about 1.2 s; never a cut. |
| Turn | A lantern gem floats over the acting miniature; the camera recentres on it. | Gem bobs slowly; recentre uses the zoom easing. |
| Miniatures | Lifted, carried and set down on the target hex; a fallen miniature tips over on its base. | About 0.7 s per move. |
| Ambience | Low dusk sun, slow swell, ships rocking, lanterns flickering, fog banks drifting. | Continuous and slow; never competes with the turn. |
| Panels | HP rings and bars animate to their new value. | 500 ms. |

## Reduced motion

With `prefers-reduced-motion: reduce`:

- the intro skips the flight and shows the city at once;
- the camera jumps to each zoom level instead of easing;
- ambience stops (water, ships, lanterns, fog);
- panel transitions and the title animation are cut to 1 ms by `base.css`.

Nothing that carries information depends on motion: the turn is also in the ribbon and the
medal label, and a fallen combatant is also "Caída" in the sheet.
