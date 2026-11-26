import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parseTasksJson, toVtodoIcs, toVeventIcs, previewRows } from "../lib/convert.js";
import { extractTasksJson, isZip } from "../lib/zip.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, "..");
const proofDir = join(rootDir, "proof");
const now = new Date("2026-11-26T04:00:00.000Z");

async function loadSample() {
  const text = await readFile(join(rootDir, "sample/Tasks.json"), "utf8");
  return parseTasksJson(text);
}

test("parses the built-in sample and skips deleted tasks", async () => {
  const parsed = await loadSample();
  assert.equal(parsed.lists.length, 2);
  assert.equal(parsed.lists[0].tasks.length, 5);
  assert.equal(parsed.lists[1].tasks.length, 2);
  assert.equal(parsed.skippedDeleted, 1);
  assert.equal(parsed.lists[1].tasks.some((task) => task.title === "Old draft"), false);
  assert.equal(parsed.incompleteRecurrence.length, 1);
  assert.equal(parsed.incompleteRecurrence[0].title, "Standup notes");
  const weekly = parsed.lists[0].tasks.find((task) => task.title === "Weekly review");
  assert.deepEqual(weekly.rrules, ["FREQ=WEEKLY;BYDAY=FR"]);
  assert.equal(weekly.recurrenceIssue, null);
});

test("writes VTODO ICS with subtasks, due dates, and recurrence marks", async () => {
  const parsed = await loadSample();
  const { ics, taskCount, filename } = toVtodoIcs(parsed.lists, { now });
  assert.equal(taskCount, 7);
  assert.equal(filename, "Google Tasks-tasks.ics");
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /BEGIN:VTODO/);
  assert.match(ics, /SUMMARY:Buy groceries/);
  assert.ok(ics.includes("DESCRIPTION:Milk\\, eggs\\, and bread.\\nAlso coffee."));
  assert.match(ics, /DUE;VALUE=DATE:20261128/);
  assert.match(ics, /RELATED-TO:task-buy-groceries@takeout-tasks-to-ics\.local/);
  assert.match(ics, /STATUS:COMPLETED/);
  assert.match(ics, /COMPLETED:20261118T151200Z/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=FR/);
  assert.match(ics, /X-RECURRENCE-INCOMPLETE:1/);
  assert.match(ics, /PRIORITY:1/);
  assert.equal((ics.match(/BEGIN:VTODO/g) || []).length, 7);
  assert.doesNotMatch(ics, /Old draft/);
  await mkdir(proofDir, { recursive: true });
  await writeFile(join(proofDir, "sample-vtodo.ics"), ics);
});

test("writes optional due-date VEVENT ICS and skips tasks without a due date", async () => {
  const parsed = await loadSample();
  const { ics, taskCount, skippedWithoutDue } = toVeventIcs(parsed.lists, { now });
  assert.equal(taskCount, 6);
  assert.equal(skippedWithoutDue, 1);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261128/);
  assert.match(ics, /DTEND;VALUE=DATE:20261129/);
  assert.match(ics, /DTSTART:20261201T170000Z/);
  assert.doesNotMatch(ics, /Decide on a gift/);
  await writeFile(join(proofDir, "sample-vevent.ics"), ics);
});

test("preview marks incomplete recurrence and subtasks", async () => {
  const parsed = await loadSample();
  const rows = previewRows(parsed.lists);
  const pack = rows[0].tasks.find((task) => task.title === "Pack bags");
  assert.equal(pack.isSubtask, true);
  const standup = rows[1].tasks.find((task) => task.title === "Standup notes");
  assert.equal(standup.recurrenceIncomplete, true);
});

test("rejects files that are not a Tasks export", () => {
  assert.throws(() => parseTasksJson("{"), /not valid JSON/);
  assert.throws(() => parseTasksJson('{"hello":1}'), /does not look like a Google Takeout Tasks export/);
});

test("extracts Tasks.json from a Takeout-style ZIP", async () => {
  const zipPath = join(proofDir, "sample-takeout.zip");
  await mkdir(proofDir, { recursive: true });
  execFileSync("python3", [
    "-c",
    "import zipfile,sys\n"
    + "z=zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_DEFLATED)\n"
    + "z.write(sys.argv[2],'Takeout/Tasks/Tasks.json')\n"
    + "z.writestr('Takeout/archive_browser.html','x')\n"
    + "z.close()",
    zipPath,
    join(rootDir, "sample/Tasks.json"),
  ]);
  const bytes = new Uint8Array(await readFile(zipPath));
  assert.equal(isZip(bytes), true);
  const text = await extractTasksJson(bytes);
  const parsed = parseTasksJson(text);
  assert.equal(parsed.lists[0].title, "Personal");
});

test("per-list export uses the list name", async () => {
  const parsed = await loadSample();
  const work = toVtodoIcs(parsed.lists, { listId: "list-work", now });
  assert.equal(work.taskCount, 2);
  assert.equal(work.filename, "Work-tasks.ics");
  assert.match(work.ics, /X-WR-CALNAME:Work/);
  assert.doesNotMatch(work.ics, /Buy groceries/);
});

test("optional time zone is written for timed exports and changes preview labels", async () => {
  const parsed = await loadSample();
  const { ics } = toVeventIcs(parsed.lists, { now, timeZone: "America/New_York" });
  assert.match(ics, /X-WR-TIMEZONE:America\/New_York/);
  const rows = previewRows(parsed.lists, { timeZone: "UTC" });
  const invoice = rows[1].tasks.find((task) => task.title === "Send invoice");
  assert.equal(invoice.dueLabel, "2026-12-01T17:00:00Z");
});
