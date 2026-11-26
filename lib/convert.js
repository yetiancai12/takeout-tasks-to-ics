/** Parse Google Takeout Tasks.json and render VTODO / VEVENT ICS. */

import {
  escapeText,
  icsLines,
  formatUtc,
  formatDate,
  addUtcDays,
} from "./ics.js";

const PRODID = "-//Takeout Tasks to ICS//EN";
const UID_HOST = "takeout-tasks-to-ics.local";

const RECURRENCE_KEYS = [
  "recurrence",
  "rrule",
  "rRule",
  "recurrenceInfo",
  "repeat",
  "repeating",
  "recurring",
  "recurrenceSpec",
];

export function parseGoogleDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function isAllDay(date) {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function extractRrules(task) {
  const rules = [];
  const rawRecurrence = asArray(task.recurrence);
  for (const entry of rawRecurrence) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    rules.push(trimmed.startsWith("RRULE:") ? trimmed.slice(6) : trimmed);
  }
  if (typeof task.rrule === "string" && task.rrule.trim()) {
    const trimmed = task.rrule.trim();
    rules.push(trimmed.startsWith("RRULE:") ? trimmed.slice(6) : trimmed);
  }
  if (typeof task.rRule === "string" && task.rRule.trim()) {
    const trimmed = task.rRule.trim();
    rules.push(trimmed.startsWith("RRULE:") ? trimmed.slice(6) : trimmed);
  }
  return [...new Set(rules.filter(looksLikeRrule))];
}

function looksLikeRrule(rule) {
  return /^FREQ=/i.test(rule);
}

function recurrenceHints(task) {
  const present = [];
  for (const key of RECURRENCE_KEYS) {
    if (task[key] != null && task[key] !== false && task[key] !== "") present.push(key);
  }
  return present;
}

export function parseTasksJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!data || !Array.isArray(data.items)) {
    throw new Error("This JSON does not look like a Google Takeout Tasks export. Expected a top-level items array of task lists.");
  }

  const warnings = [];
  const lists = [];
  let skippedDeleted = 0;

  for (const rawList of data.items) {
    if (!rawList || typeof rawList !== "object") continue;
    const listId = String(rawList.id ?? rawList.title ?? `list-${lists.length + 1}`);
    const listTitle = String(rawList.title ?? "Untitled list");
    const tasks = [];
    const items = Array.isArray(rawList.items) ? rawList.items : [];

    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      if (raw.deleted === true) {
        skippedDeleted += 1;
        continue;
      }
      const id = String(raw.id ?? `${listId}-task-${tasks.length + 1}`);
      const title = String(raw.title ?? "").trim() || "(untitled)";
      const due = parseGoogleDate(raw.due);
      const updated = parseGoogleDate(raw.updated);
      const created = parseGoogleDate(raw.created) ?? updated;
      const completedAt = parseGoogleDate(raw.completed);
      const status = raw.status === "completed" || completedAt ? "completed" : "needsAction";
      const rrules = extractRrules(raw);
      const hintKeys = recurrenceHints(raw);
      let recurrenceIssue = null;
      if (hintKeys.length && rrules.length === 0) {
        recurrenceIssue = "Takeout includes a recurrence hint, but no usable RRULE. This occurrence was exported once, without a repeat rule.";
      }

      tasks.push({
        id,
        listId,
        listTitle,
        title,
        notes: raw.notes != null ? String(raw.notes) : "",
        status,
        due,
        dueRaw: raw.due ?? null,
        updated,
        created,
        completedAt,
        parentId: raw.parent ? String(raw.parent) : null,
        selfLink: raw.selfLink ? String(raw.selfLink) : null,
        starred: raw.starred === true,
        hidden: raw.hidden === true,
        rrules,
        recurrenceIssue,
        recurrenceHintKeys: hintKeys,
      });
    }

    lists.push({
      id: listId,
      title: listTitle,
      updated: parseGoogleDate(rawList.updated),
      tasks,
    });
  }

  if (lists.length === 0) {
    throw new Error("This Tasks export has no task lists.");
  }

  if (skippedDeleted) {
    warnings.push(`Skipped ${skippedDeleted} deleted task${skippedDeleted === 1 ? "" : "s"}.`);
  }

  const incompleteRecurrence = lists.flatMap((list) =>
    list.tasks.filter((task) => task.recurrenceIssue).map((task) => ({
      listTitle: list.title,
      title: task.title,
      id: task.id,
      issue: task.recurrenceIssue,
    }))
  );
  if (incompleteRecurrence.length) {
    warnings.push(
      `${incompleteRecurrence.length} task${incompleteRecurrence.length === 1 ? " has" : "s have"} incomplete recurrence data in this export. They are included as one-off items and marked in the result.`
    );
  }
  warnings.push(
    "Google Takeout often omits or only partly includes repeat rules. Any task whose repeat rule could not be kept is marked in the preview and in the ICS as X-RECURRENCE-INCOMPLETE."
  );

  return { lists, warnings, incompleteRecurrence, skippedDeleted };
}

export function flattenTasks(lists, listId) {
  const selected = listId ? lists.filter((list) => list.id === listId) : lists;
  return selected.flatMap((list) => list.tasks.map((task) => ({ ...task, listTitle: list.title, listId: list.id })));
}

function uidFor(task) {
  return `${task.id}@${UID_HOST}`;
}

function stamp(task, now) {
  return formatUtc(task.updated ?? task.created ?? now);
}

function dueLines(task, name) {
  if (!task.due) return [];
  if (isAllDay(task.due)) return [`${name};VALUE=DATE:${formatDate(task.due)}`];
  return [`${name}:${formatUtc(task.due)}`];
}

function vtodoBlock(task, now) {
  const lines = [
    "BEGIN:VTODO",
    `UID:${uidFor(task)}`,
    `DTSTAMP:${stamp(task, now)}`,
  ];
  if (task.created) lines.push(`CREATED:${formatUtc(task.created)}`);
  if (task.updated) lines.push(`LAST-MODIFIED:${formatUtc(task.updated)}`);
  lines.push(`SUMMARY:${escapeText(task.title)}`);
  if (task.notes) lines.push(`DESCRIPTION:${escapeText(task.notes)}`);
  lines.push(...dueLines(task, "DUE"));
  if (task.status === "completed") {
    lines.push("STATUS:COMPLETED");
    lines.push("PERCENT-COMPLETE:100");
    if (task.completedAt) lines.push(`COMPLETED:${formatUtc(task.completedAt)}`);
  } else {
    lines.push("STATUS:NEEDS-ACTION");
  }
  if (task.starred) lines.push("PRIORITY:1");
  if (task.listTitle) lines.push(`CATEGORIES:${escapeText(task.listTitle)}`);
  if (task.parentId) lines.push(`RELATED-TO:${task.parentId}@${UID_HOST}`);
  for (const rule of task.rrules) lines.push(`RRULE:${rule}`);
  if (task.recurrenceIssue) {
    lines.push("X-RECURRENCE-INCOMPLETE:1");
    lines.push(`X-RECURRENCE-NOTE:${escapeText(task.recurrenceIssue)}`);
  }
  if (task.selfLink) lines.push(`URL:${task.selfLink}`);
  lines.push("END:VTODO");
  return lines;
}

function veventBlock(task, now) {
  if (!task.due) return null;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${task.id}-due@${UID_HOST}`,
    `DTSTAMP:${stamp(task, now)}`,
  ];
  if (task.updated) lines.push(`LAST-MODIFIED:${formatUtc(task.updated)}`);
  if (isAllDay(task.due)) {
    lines.push(`DTSTART;VALUE=DATE:${formatDate(task.due)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDate(addUtcDays(task.due, 1))}`);
  } else {
    lines.push(`DTSTART:${formatUtc(task.due)}`);
    lines.push(`DTEND:${formatUtc(new Date(task.due.getTime() + 30 * 60 * 1000))}`);
  }
  lines.push(`SUMMARY:${escapeText(task.title)}`);
  const description = [task.notes, task.status === "completed" ? "Completed in Google Tasks." : null]
    .filter(Boolean)
    .join("\n");
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (task.listTitle) lines.push(`CATEGORIES:${escapeText(task.listTitle)}`);
  for (const rule of task.rrules) lines.push(`RRULE:${rule}`);
  if (task.recurrenceIssue) {
    lines.push("X-RECURRENCE-INCOMPLETE:1");
    lines.push(`X-RECURRENCE-NOTE:${escapeText(task.recurrenceIssue)}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

function calendar(name, components, now, timeZone) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    name ? `X-WR-CALNAME:${escapeText(name)}` : null,
    timeZone && timeZone !== "UTC" ? `X-WR-TIMEZONE:${escapeText(timeZone)}` : null,
  ];
  for (const block of components) lines.push(...block);
  lines.push("END:VCALENDAR");
  return icsLines(lines);
}

export function toVtodoIcs(lists, options = {}) {
  const now = options.now ?? new Date();
  const selected = options.listId ? lists.filter((list) => list.id === options.listId) : lists;
  if (selected.length === 0) throw new Error("No matching list to export.");
  const tasks = selected.flatMap((list) => list.tasks);
  const name = selected.length === 1 ? selected[0].title : "Google Tasks";
  return {
    ics: calendar(name, tasks.map((task) => vtodoBlock(task, now)), now, options.timeZone),
    taskCount: tasks.length,
    filename: safeFilename(name) + "-tasks.ics",
  };
}

export function toVeventIcs(lists, options = {}) {
  const now = options.now ?? new Date();
  const selected = options.listId ? lists.filter((list) => list.id === options.listId) : lists;
  if (selected.length === 0) throw new Error("No matching list to export.");
  const tasks = selected.flatMap((list) => list.tasks).filter((task) => task.due);
  const name = (selected.length === 1 ? selected[0].title : "Google Tasks") + " due dates";
  return {
    ics: calendar(name, tasks.map((task) => veventBlock(task, now)).filter(Boolean), now, options.timeZone),
    taskCount: tasks.length,
    skippedWithoutDue: selected.flatMap((list) => list.tasks).length - tasks.length,
    filename: safeFilename(name) + ".ics",
  };
}

export function safeFilename(name) {
  const cleaned = String(name).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "tasks";
}

export function formatDueLabel(date, timeZone) {
  if (!date) return "—";
  if (isAllDay(date)) return formatDate(date).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
  if (!timeZone || timeZone === "UTC") return date.toISOString().replace(".000Z", "Z");
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toISOString().replace(".000Z", "Z");
  }
}

export function previewRows(lists, options = {}) {
  const timeZone = options.timeZone || "UTC";
  return lists.map((list) => ({
    id: list.id,
    title: list.title,
    tasks: list.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      notes: task.notes,
      due: task.due ? (isAllDay(task.due) ? formatDate(task.due) : formatUtc(task.due)) : "",
      dueLabel: formatDueLabel(task.due, timeZone),
      status: task.status,
      isSubtask: Boolean(task.parentId),
      parentId: task.parentId,
      recurrenceKept: task.rrules.length > 0,
      recurrenceIncomplete: Boolean(task.recurrenceIssue),
      recurrenceNote: task.recurrenceIssue,
    })),
  }));
}
