import assert from "node:assert/strict";
import test from "node:test";
import { createIntentSender, type ActionInput } from "./intent-client";
const input = (requestId: string, quantity = 3): ActionInput => ({
  path: "/stock-movements",
  data: { productId: "product", direction: "out", quantity, requestId },
});
test("concurrent retries share one write; successful next intent gets a new key", async () => {
  const sent: ActionInput[] = [];
  let finish!: (value: unknown) => void;
  const client = createIntentSender((p) => {
    sent.push(p);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = client.send(input("first-key"));
  const second = client.send(input("second-key"));
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(sent.length, 1);
  finish({ ok: true });
  await first;
  const third = client.send(input("third-key"));
  await Promise.resolve();
  assert.equal((sent[1].data as any).requestId, "third-key");
  finish({ ok: true });
  await third;
});
test("network and 5xx outcomes reuse the same intent key", async () => {
  const sent: ActionInput[] = [];
  let attempts = 0;
  const client = createIntentSender(async (p) => {
    sent.push(p);
    attempts++;
    if (attempts === 1) throw new TypeError("connection lost");
    if (attempts === 2)
      throw Object.assign(new Error("unavailable"), { status: 503 });
    return { ok: true };
  });
  await assert.rejects(client.send(input("first-key")));
  await assert.rejects(client.send(input("second-key")));
  await client.send(input("third-key"));
  assert.deepEqual(
    sent.map((x) => (x.data as any).requestId),
    ["first-key", "first-key", "first-key"],
  );
});
test("definitive validation rejection releases intent; changed quantity creates a distinct intent", async () => {
  const sent: ActionInput[] = [];
  const client = createIntentSender(async (p) => {
    sent.push(p);
    if (sent.length === 1)
      throw Object.assign(new Error("conflict"), { status: 409 });
    return {};
  });
  await assert.rejects(client.send(input("first-key")));
  await client.send(input("second-key"));
  await client.send(input("third-key", 4));
  assert.deepEqual(
    sent.map((x) => (x.data as any).requestId),
    ["first-key", "second-key", "third-key"],
  );
});

test("device event identifiers survive uncertain response retries", async () => {
  const sent: ActionInput[] = [];
  const client = createIntentSender(async (input) => {
    sent.push(input);
    if (sent.length === 1) throw new Error("connection lost");
    return {};
  });
  await assert.rejects(
    client.send({
      path: "/telemetry/events",
      data: { deviceId: "device", status: "running", eventId: "first-event" },
    }),
  );
  await client.send({
    path: "/telemetry/events",
    data: { status: "running", deviceId: "device", eventId: "retry-event" },
  });
  assert.deepEqual(
    sent.map((x) => (x.data as any).eventId),
    ["first-event", "first-event"],
  );
});
