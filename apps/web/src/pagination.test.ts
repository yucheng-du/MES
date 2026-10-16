import assert from "node:assert/strict";
import test from "node:test";
import { readAllPages } from "./pagination";

test("options include records older than the first 100 rows", async () => {
  const all = Array.from({ length: 237 }, (_, index) => ({
    id: `record-${index}`,
    name: `历史工单 ${index}`,
  }));
  const requests: number[] = [];
  const result = await readAllPages(async (page, pageSize) => {
    requests.push(page);
    return {
      items: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      page,
      pageSize,
    };
  });
  assert.deepEqual(requests, [1, 2, 3]);
  assert.equal(result.items.length, 237);
  assert.equal(result.items.at(-1)?.id, "record-236");
});

test("honors a smaller page size returned by the server and handles full lookup responses", async () => {
  const records = Array.from({ length: 73 }, (_, i) => ({ id: String(i) }));
  const requested: number[] = [];
  const result = await readAllPages(async (page) => {
    requested.push(page);
    return {
      items: records.slice((page - 1) * 25, page * 25),
      page,
      pageSize: 25,
      total: 73,
    };
  });
  assert.deepEqual(requested, [1, 2, 3]);
  assert.equal(result.items.length, 73);
  let calls = 0;
  const lookup = await readAllPages(async () => {
    calls++;
    return { items: records, total: 73, page: 1, pageSize: 73 };
  });
  assert.equal(calls, 1);
  assert.equal(lookup.items.length, 73);
});

test("an API that ignores page numbers fails explicitly instead of looping or truncating", async () => {
  await assert.rejects(
    readAllPages(async () => ({
      items: [{ id: "same" }],
      total: 3,
      page: 1,
      pageSize: 1,
    })),
    /分页未继续/,
  );
});
