import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from tests.test_native_features import ROOT, CONSTANTS, _load_standalone_functions


class DeviceLifecycleTests(unittest.IsolatedAsyncioTestCase):
    def make_light(self, options):
        methods = _load_standalone_functions(
            (ROOT / "light.py").read_text(encoding="utf-8"),
            {"set_extended_effects_enabled", "_restore_extended_effects"},
        )
        entry = SimpleNamespace(options=dict(options))
        update = Mock(side_effect=lambda entry, **changes: vars(entry).update(changes))
        light = SimpleNamespace(
            _config_entry=entry, _extended_effects_enabled=False,
            hass=SimpleNamespace(config_entries=SimpleNamespace(async_update_entry=update)),
        )
        light.set_extended_effects_enabled = lambda value: methods["set_extended_effects_enabled"](light, value)
        light.restore = lambda state: methods["_restore_extended_effects"](light, state)
        return light

    def test_experimental_options_survive_missing_and_stale_restore_states(self):
        for enabled in (True, False):
            for old_state in (None, SimpleNamespace(attributes={}), SimpleNamespace(
                    attributes={"extended_effects_enabled": not enabled})):
                with self.subTest(enabled=enabled, old_state=old_state):
                    light = self.make_light({"extended_effects_enabled": enabled})
                    light.restore(old_state)
                    self.assertIs(light._extended_effects_enabled, enabled)
                    light.hass.config_entries.async_update_entry.assert_not_called()

    def test_experimental_legacy_migration_and_toggle_preserve_other_options(self):
        for enabled in (True, False):
            light = self.make_light({"auto_turn_on": False})
            light.restore(SimpleNamespace(attributes={"extended_effects_enabled": enabled}))
            self.assertEqual(light._config_entry.options,
                             {"auto_turn_on": False, "extended_effects_enabled": enabled})
            light.set_extended_effects_enabled(not enabled)
            replacement = self.make_light(light._config_entry.options)
            replacement.restore(None)
            self.assertIs(replacement._extended_effects_enabled, not enabled)

    async def test_switch_saves_setting_and_refreshes_linked_controls(self):
        setter = _load_standalone_functions(
            (ROOT / "switch.py").read_text(encoding="utf-8"), {"_set_enabled"})["_set_enabled"]
        light = self.make_light({"auto_turn_on": False})
        light.async_write_ha_state = Mock()
        light._native_effect_select_entity = SimpleNamespace(hass=light.hass, async_write_ha_state=Mock())
        light._clock_style_select_entity = SimpleNamespace(hass=light.hass, async_write_ha_state=Mock())
        switch = SimpleNamespace(_light_entity=light, async_write_ha_state=Mock())
        for enabled in (True, False):
            await setter(switch, enabled)
            self.assertIs(light._config_entry.options["extended_effects_enabled"], enabled)
            self.assertIs(light._extended_effects_enabled, enabled)
        self.assertEqual(light._native_effect_select_entity.async_write_ha_state.call_count, 2)
        self.assertEqual(light._clock_style_select_entity.async_write_ha_state.call_count, 2)
        self.assertEqual(switch.async_write_ha_state.call_count, 2)
        self.assertEqual(light.async_write_ha_state.call_count, 2)

    async def test_experimental_clock_service_persists_implicit_enable(self):
        light = self.make_light({"auto_turn_on": True})
        light._is_on = True
        light._mode = "Clock"
        light._refresh_linked_entities = Mock()
        light.async_write_ha_state = Mock()
        light.async_apply_display_mode = AsyncMock()
        pending = []
        handler = _load_standalone_functions(
            (ROOT / "light_services.py").read_text(encoding="utf-8"),
            {"handle_set_clock_style"},
            {**CONSTANTS, "_resolve_entities": lambda *args: [light],
             "HomeAssistantError": ValueError, "_fire_and_forget": lambda *tasks: pending.extend(tasks)},
        )["handle_set_clock_style"]
        await handler(SimpleNamespace(data={"style": "Twinkle"}))
        for task in pending:
            await task
        self.assertIs(light._config_entry.options["extended_effects_enabled"], True)
        self.assertIs(light._config_entry.options["auto_turn_on"], True)
        light._refresh_linked_entities.assert_called_once()

    async def test_manual_setup_checks_existing_ip_before_creating_entry(self):
        step = _load_standalone_functions(
            (ROOT / "config_flow.py").read_text(encoding="utf-8"), {"async_step_user"}, CONSTANTS)["async_step_user"]
        flow = SimpleNamespace(_async_abort_entries_match=Mock(side_effect=ValueError("already_configured")),
                               async_set_unique_id=AsyncMock(), async_create_entry=Mock())
        with self.assertRaisesRegex(ValueError, "already_configured"):
            await step(flow, {CONSTANTS["CONF_IP"]: "192.168.4.102"})
        flow._async_abort_entries_match.assert_called_once_with({CONSTANTS["CONF_IP"]: "192.168.4.102"})
        flow.async_create_entry.assert_not_called()

    async def test_zeroconf_delegates_to_same_identity_path(self):
        step = _load_standalone_functions(
            (ROOT / "config_flow.py").read_text(encoding="utf-8"), {"async_step_zeroconf"},
            {"parse_service_name": lambda name: {}, "is_cube_device": lambda *args: True},
        )["async_step_zeroconf"]
        flow = SimpleNamespace(async_step_discovery=AsyncMock(return_value={"reason": "already_configured"}))
        info = SimpleNamespace(name="CubeLite", host="new-ip", properties={"md": "cubelite", "id": "0x4217ae4bfc02"})
        self.assertEqual(await step(flow, info), {"reason": "already_configured"})
        flow.async_step_discovery.assert_awaited_once_with({"ip": "new-ip", "model": "cubelite",
            "name": "cubelite", "device_id": "0x4217ae4bfc02"})

    def make_flow(self, entries):
        namespace = _load_standalone_functions(
            (ROOT / "discovery.py").read_text(encoding="utf-8"),
            {"normalize_device_id"},
        )
        methods = _load_standalone_functions(
            (ROOT / "config_flow.py").read_text(encoding="utf-8"),
            {"async_step_discovery"},
            {**CONSTANTS, **namespace, "_LOGGER": Mock(),
             "config_entries": SimpleNamespace(ConfigEntryState=SimpleNamespace(
                 SETUP_ERROR="error", SETUP_RETRY="retry"))},
        )
        flow = SimpleNamespace(
            hass=SimpleNamespace(config_entries=SimpleNamespace(async_update_entry=Mock())),
            context={}, _async_current_entries=lambda: entries,
            async_set_unique_id=AsyncMock(), _abort_if_unique_id_configured=Mock(),
            async_abort=lambda **kwargs: kwargs,
            async_step_discovery_confirm=AsyncMock(return_value={"type": "form"}),
        )
        return flow, methods["async_step_discovery"]

    async def test_discovery_does_not_guess_identity_of_legacy_entries(self):
        entries = [SimpleNamespace(entry_id=name, unique_id=ip,
                    data={CONSTANTS["CONF_IP"]: ip}, state="retry")
                   for name, ip in (("bottom", "192.168.4.102"), ("top", "192.168.4.145"))]
        flow, discover = self.make_flow(entries)
        result = await discover(flow, {"ip": "192.168.4.200", "model": "cubelite",
                                       "device_id": "0x4217ae4bfc02"})
        self.assertEqual(result, {"type": "form"})
        flow.hass.config_entries.async_update_entry.assert_not_called()

    async def test_discovery_remaps_two_lamps_by_normalized_hardware_id(self):
        entries = [SimpleNamespace(entry_id=name, unique_id=ip,
                    data={CONSTANTS["CONF_IP"]: ip, CONSTANTS["CONF_DEVICE_ID"]: device_id},
                    options={"extended_effects_enabled": True}, title=name)
                   for name, ip, device_id in (
                       ("bottom", "192.168.4.102", "0x00004217AE4BFC02"),
                       ("top", "192.168.4.145", "0x0000c34c87917e78"))]
        flow, discover = self.make_flow(entries)
        for entry, new_ip in zip(reversed(entries), ("192.168.4.201", "192.168.4.202")):
            result = await discover(flow, {"ip": new_ip, "device_id": entry.data[CONSTANTS["CONF_DEVICE_ID"]]})
            self.assertEqual(result, {"reason": "already_configured"})
            changed_entry, = flow.hass.config_entries.async_update_entry.call_args.args
            changes = flow.hass.config_entries.async_update_entry.call_args.kwargs
            self.assertIs(changed_entry, entry)
            self.assertEqual(changes["data"][CONSTANTS["CONF_IP"]], new_ip)
            self.assertNotIn("title", changes)
            self.assertNotIn("options", changes)
        flow.async_step_discovery_confirm.assert_not_awaited()

    def init_helpers(self, names, **namespace):
        source = (ROOT / "__init__.py").read_text(encoding="utf-8")
        source = source.replace("    from .discovery import normalize_device_id\n", "")
        source = source.replace("        from yeelight import discover_bulbs  # type: ignore\n", "")
        normalize = _load_standalone_functions(
            (ROOT / "discovery.py").read_text(encoding="utf-8"), {"normalize_device_id"})
        return _load_standalone_functions(source, names, {
            **CONSTANTS, **normalize, "_LOGGER": Mock(),
            "ha_callback": lambda method: method, **namespace,
        })

    async def test_competing_discovery_uses_id_without_hiding_other_devices(self):
        entries = [SimpleNamespace(data={CONSTANTS["CONF_IP"]: "old-ip",
                    CONSTANTS["CONF_DEVICE_ID"]: "0x00004217ae4bfc02"}, unique_id="old-ip")]
        def flow(flow_id, unique_id, source="ssdp", host="new-ip"):
            return {"flow_id": flow_id, "context": {"source": source, "unique_id": unique_id,
                    "title_placeholders": {"model": "Cubelite", "id": unique_id, "host": host}}}
        flows = [flow("known", "0x4217AE4BFC02"), flow("other", "0xc34c87917e78"),
                 flow("manual", "0x4217ae4bfc02", "user"),
                 flow("reused-ip", "0x9999", host="old-ip")]
        manager = SimpleNamespace(async_progress_by_handler=Mock(return_value=flows), async_abort=Mock())
        hass = SimpleNamespace(config_entries=SimpleNamespace(
            async_entries=Mock(return_value=entries), flow=manager))
        helpers = self.init_helpers({"_async_dismiss_yeelight_discoveries", "_get_managed_ips"})
        await helpers["_async_dismiss_yeelight_discoveries"](hass)
        manager.async_abort.assert_called_once_with("known")

    async def test_reconnect_does_not_guess_and_preserves_two_lamp_identity(self):
        bulbs = [{"ip": ip, "capabilities": {"model": "cubelite", "id": identity}}
                 for ip, identity in (("new-top", "0xc34c87917e78"), ("new-bottom", "0x4217ae4bfc02"))]
        hass = SimpleNamespace(async_add_executor_job=AsyncMock(return_value=bulbs),
            config_entries=SimpleNamespace(async_update_entry=Mock()))
        dismiss = Mock()
        helpers = self.init_helpers({"_async_try_rediscover", "_is_cubelite_model"},
                                    discover_bulbs=Mock(), _async_dismiss_own_discovery_flows=dismiss)
        rediscover = helpers["_async_try_rediscover"]
        for identity, expected in ((None, None), ("0x00004217AE4BFC02", "new-bottom"),
                                   ("c34c87917e78", "new-top"), ("missing", None)):
            entry = SimpleNamespace(entry_id="stable", data={CONSTANTS["CONF_DEVICE_ID"]: identity},
                                    options={"extended_effects_enabled": True})
            result = await rediscover(hass, entry, "old-ip")
            self.assertEqual(result, expected)
            if expected:
                self.assertIs(hass.config_entries.async_update_entry.call_args.args[0], entry)
                self.assertNotIn("options", hass.config_entries.async_update_entry.call_args.kwargs)
            else:
                hass.config_entries.async_update_entry.assert_not_called()
            hass.config_entries.async_update_entry.reset_mock()

    async def test_setting_updates_do_not_reload_but_ip_updates_do(self):
        entry = SimpleNamespace(entry_id="stable", title="Bottom", data={CONSTANTS["CONF_IP"]: "old-ip"})
        hass = SimpleNamespace(data={CONSTANTS["DOMAIN"]: {"stable": {"active_ip": "old-ip"}}},
                               config_entries=SimpleNamespace(async_reload=AsyncMock()))
        update = self.init_helpers({"_async_entry_updated"})["_async_entry_updated"]
        await update(hass, entry)
        hass.config_entries.async_reload.assert_not_awaited()
        entry.data[CONSTANTS["CONF_IP"]] = "new-ip"
        await update(hass, entry)
        hass.config_entries.async_reload.assert_awaited_once_with("stable")