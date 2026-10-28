from laptop.twin_bridge import TwinSerialWorker, YawState, find_esp32s3_ports


class PortInfo:
    def __init__(self, device, vid, pid):
        self.device = device
        self.vid = vid
        self.pid = pid


class PortProvider:
    def __init__(self, ports):
        self.ports = ports

    def comports(self):
        return self.ports


class MemoryEventLog:
    def record(self, *args, **kwargs):
        return {}


class FakeConnection:
    def open(self):
        self.opened = True


class FakeSerialModule:
    def Serial(self):
        return FakeConnection()


def test_usb_uart_ports_are_supported_and_preferred_to_native_s3_cdc():
    ports = PortProvider([
        PortInfo("COM7", 0x303A, 0x1001),
        PortInfo("COM8", 0x10C4, 0xEA60),
        PortInfo("COM9", 0x1A86, 0x7523),
    ])
    assert find_esp32s3_ports(ports) == ["COM8", "COM9", "COM7"]


def test_mixed_input_yaw_and_malformed_lines_reach_the_existing_state_path():
    state = YawState()
    worker = TwinSerialWorker(state, serial_backend=object(), port_provider=lambda: [], event_log=MemoryEventLog())
    lines = [
        b'{"v":1,"type":"hello","board":"base-io"}\n',
        b'{"v":1,"type":"wheel","delta":2}\n',
        b'{"v":1,"type":"button","name":"scan","state":"down"}\n',
        b'{broken json\n',
        b'{"v":1,"type":"yaw","deg":123.5,"raw":1400,"ok":true,"magnet":"ok"}\n',
        b'{"v":1,"type":"wheel","delta":0}\n',
        b'{"v":1,"type":"button","name":"erase","state":"down"}\n',
    ]
    outcomes = [worker._process_line(line, "COM8") for line in lines]
    snapshot = state.snapshot()

    assert [event["type"] for event in snapshot["events"]] == ["hello", "wheel", "button"]
    assert snapshot["events"][1]["delta"] == 2
    assert snapshot["deg"] == 123.5
    assert outcomes[3] == (False, False)
    assert worker.parse_errors == 1


def test_base_hello_marks_that_port_as_preferred():
    state = YawState()
    worker = TwinSerialWorker(state, serial_backend=object(), port_provider=lambda: ["COM7", "COM8"])
    worker._process_line(b'{"v":1,"type":"hello","board":"base-io"}\n', "COM8")
    assert worker._select_port() == "COM8"


def test_events_are_consumed_once_by_sequence_id_without_changing_yaw_shape():
    state = YawState()
    for message in [
        {"v": 1, "type": "wheel", "delta": -1},
        {"v": 1, "type": "button", "name": "analyze", "state": "down"},
    ]:
        state.update(message)
    state.update({"v": 1, "type": "yaw", "deg": 17, "ok": True, "magnet": "ok"})

    first = state.snapshot(after_event_id=0)
    consumed = state.snapshot(after_event_id=first["events"][-1]["id"])
    assert first["deg"] == 17
    assert first["events"][0]["delta"] == -1
    assert [event["type"] for event in consumed["events"]] == []
    assert set(first).issuperset({"deg", "ok", "magnet", "age_ms", "simulated", "port", "events"})


def test_bridge_sequence_id_overrides_an_id_in_incoming_messages():
    state = YawState()
    state.update({"v": 1, "type": "wheel", "delta": 1, "id": 800})
    state.update({"v": 1, "type": "hello", "board": "base-io", "id": 900})
    assert [event["id"] for event in state.snapshot()["events"]] == [1, 2]


def test_event_session_and_latest_id_support_reload_and_bridge_restart_cursors():
    old_bridge = YawState()
    for _ in range(5):
        old_bridge.update({"v": 1, "type": "wheel", "delta": 1})
    first_poll = old_bridge.snapshot(after_event_id=0)
    # The browser's initial cursor is event_latest_id, so these buffered events are skipped.
    reload_cursor = first_poll["event_latest_id"]
    assert reload_cursor == 5
    assert first_poll["event_session"]

    restarted_bridge = YawState()
    restarted_bridge.update({"v": 1, "type": "button", "name": "scan", "state": "down"})
    after_restart = restarted_bridge.snapshot(after_event_id=reload_cursor)
    assert after_restart["event_session"] != first_poll["event_session"]
    assert after_restart["event_latest_id"] == 1
    assert after_restart["events"] == []


def test_cp210x_and_ch340_open_without_dtr_but_s3_keeps_dtr():
    for vid, expected_dtr in ((0x10C4, False), (0x1A86, False), (0x303A, True)):
        connection = FakeConnection()
        state = YawState()
        worker = TwinSerialWorker(
            state, serial_backend=type("Backend", (), {"Serial": lambda self: connection})(),
            port_provider=lambda: [],
            port_metadata_provider=PortProvider([PortInfo("COM10", vid, 0x1001)]),
            event_log=MemoryEventLog(),
        )
        opened = worker._open("COM10")
        assert opened is connection and connection.opened
        assert connection.dtr is expected_dtr
        assert connection.rts is False
