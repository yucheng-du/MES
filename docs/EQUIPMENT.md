# Equipment status integration

[简体中文](EQUIPMENT.zh-CN.md) · English

Enter a unique equipment identifier in **Equipment register → Telemetry device ID**. Configure `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, and `MQTT_TOPIC` on the server. Credentials stay on the server and are not returned to the browser or Android web application. The default subscription is `device/send/+`; the final topic segment identifies the equipment.

## Message formats

The legacy equipment message format is supported: topic `device/send/CNC001`, payload `{"RGY":3}`. The mapping is `0 → offline`, `1 → fault`, `2 → idle`, and `3 → running`. Messages without an equipment timestamp use server receipt time and cannot reconstruct exact status during a connection outage.

The recommended event format is:

```json
{
  "eventId": "CNC001-00001234",
  "status": "running",
  "occurredAt": "2026-10-14T09:30:00+08:00"
}
```

Supported status values are `offline`, `idle`, `running`, `fault`, and `maintenance`. Event IDs must be unique within a device. Re-delivery of the same ID and content does not create another event; conflicting content for that ID is rejected. Late events enter history without replacing a newer current state. Daily summaries are recalculated using actual event times. Events more than one minute in the future are rejected; synchronize equipment clocks.

Equipment identifiers must match existing register entries; unknown equipment is not created automatically. Inbound payloads are limited to 16 KiB and processed serially per device. Repeated identical legacy statuses act as heartbeats: they update the last communication time without adding redundant status records.

## Daily summaries and validation

Daily summaries use `FACTORY_TIMEZONE`, which defaults to `Asia/Shanghai`. Periods with no preceding status evidence are classified as `unknown`, not invented as running or stopped. A stale-data warning is separate from a recorded status: missing communication does not itself create an `offline` event. Running duration is a status measure, not OEE; OEE also requires planned time, ideal cycle time, and a defined quality measure.

Administrators and production managers can use manual status entry in the equipment page to verify the view. Manual entries are audited. Actual telemetry still requires validation against the equipment's messages and timestamps.

Production connections require MQTT over TLS by default (`mqtts:` or `wss:`). A plain-text broker on a trusted private network requires explicit `ALLOW_PRIVATE_MQTT=true`; that setting is unsuitable for public-network traffic.

See the [API contract](API-CONTRACT.md) for telemetry endpoints. A local protocol or database test does not establish compatibility with the physical equipment, broker, or production network.
