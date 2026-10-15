# Entity ids change: never rely on one staying the same

Developer rules for the integration and its cards. Guarded by the tests
listed at the end; read this before touching entity classes, lifecycle
hooks, the lamp lookup, or how the cards find their lamps and sensors.

A user can rename any entity's id (Settings → Entities). Until Home Assistant
2026.10 the entity was removed and added again; **from 2026.11 it is renamed
in place**: `self.entity_id` changes, `async_added_to_hass` /
`async_will_remove_from_hass` do **not** run, and only
`async_entity_id_changed(old_entity_id)` is called. Custom integrations keep
the old behaviour for a class that defines its own lifecycle hooks without
that method until **2027.11**; after that every entity is renamed in place.
Background: GitHub issue #4, and
https://developers.home-assistant.io/blog/2026/10/12/new-entity-lifecycle-hooks/

## Rules

1. **Every entity class that defines `async_added_to_hass`,
   `async_will_remove_from_hass` or `async_prepare_to_add_to_hass` also
   defines `async_entity_id_changed`** in that same class: a plain
   `@callback` (not async) that calls
   `super().async_entity_id_changed(old_entity_id)`. A hook on a base class
   does **not** cover a subclass that defines its own lifecycle hook.
   `tests/test_entity_id_changes.py` fails otherwise. The method is harmless
   on older Home Assistant (minimum 2024.12): it is simply never called.
2. **Never key, store or look up anything by an entity id** that can outlive
   a rename:
   - Services find a lamp by its **live** id: `_lamp_for(entity_id)` in
     `light_services_common.py` (used by `_resolve_entity` /
     `_resolve_entities`). `_ENTITY_REGISTRY` (light.py) is keyed by the
     lamp's **IP**, never by entity id: a stored id lets an old id reach a
     renamed lamp, or the **wrong lamp** once two lamps swap names.
   - Persisted data is keyed by the **config entry id**
     (`_music_flow_runtime_storage_key()`): favourites, rotation, drawings,
     Music Flow state.
   - A multi-lamp rotation's saved `group` lists the lamps by **unique id**
     (`unique_id`, falling back to `entity_id` only for test doubles). It is
     only ever compared, never resolved to lamps.
   - Helper entities reach their lamp through the object
     (`self._light_entity`), never by looking up an id.
   - Reading `self.entity_id` live (logs, attributes, event payloads) is fine.
3. **If something must follow the entity id, update it in
   `async_entity_id_changed`** (it runs after `self.entity_id` changed; it may
   call `self.async_write_ha_state()`). Add a test for it.
4. **Cards: never find an entity by a fragment of its id.**
   - Collection sensors (palettes, pixel arts) are found by the attribute
     that holds the collection, restricted to this integration's sensors
     (`sensor-lookup.js` `findCollectionSensor`, like the clock presets in
     `clock-preset-utils.js`). Ids differ between installations (a fresh
     one gets `sensor.saved_drawings`, not `…pixel_art…`).
   - A configured sensor that no longer exists (renamed) is found again
     (`_autoResolveSensor` in card-base.js, `collectionSensor` in
     user-collections.js): never only fill an *unset* option.
   - Lamps come from the card's `target_entities`; the primary lamp is the
     first one Home Assistant knows (`_primaryEntity`). The shared frame
     (card-shell.js) names the card's lamps that no longer exist while
     others still work; a card that skips renders in `set hass` must still
     re-render when one of its lamps appears or disappears (see the Native
     Effects card's `_lampsShown`).
5. Home Assistant never updates dashboards, automations or Node-RED flows
   after a rename: user configs keep the old id. Cards must stay usable and
   say which lamp is missing (`lampNotFoundNotice`, the frame's line), never
   fail silently.

## Tests that guard this

- `tests/test_entity_id_changes.py`: every class with lifecycle hooks opts
  in; a renamed lamp answers to its new id only; a two-lamp name swap never
  reaches the wrong lamp; lamps are registered by IP.
- `tests/test_effect_rotation.py`: the rotation group records unique ids.
- `tests/sensor-lookup.test.mjs`: sensors found by attribute, other
  integrations ignored, renamed sensors found again.
- `tests/browser/events/14-renamed-sensors.cjs`: Draw and Palette with a
  fresh installation's ids and a sensor renamed while open.
- `tests/browser/events/10-card-frame.cjs`: every card names a renamed lamp
  among its lamps, also when it goes while the card is open.
