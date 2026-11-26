import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { parseTasksJson } from "../lib/convert.js";
import { extractTasksJson } from "../lib/zip.js";
import { createStoreZip } from "../lib/zipwrite.js";

const here = dirname(fileURLToPath(import.meta.url));

test("empty files and broken JSON have a clear error", () => {
  assert.throws(() => parseTasksJson(""), /not valid JSON/);
  assert.throws(() => parseTasksJson("[]"), /does not look like a Google Takeout Tasks export/);
  assert.throws(() => parseTasksJson("{"), /not valid JSON/);
});

test("a ZIP without Tasks.json has a clear error", async () => {
  const zip = createStoreZip([{ name: "Takeout/readme.txt", data: "hello" }]);
  await assert.rejects(() => extractTasksJson(zip), /No Tasks.json was found in this ZIP/);
});

test("a ZIP written by this tool can be read back", async () => {
  const sample = await readFile(join(here, "../sample/Tasks.json"));
  const zip = createStoreZip([{ name: "Takeout/Tasks/Tasks.json", data: sample }]);
  const text = await extractTasksJson(zip);
  const parsed = parseTasksJson(text);
  assert.equal(parsed.lists[0].title, "Personal");
});
