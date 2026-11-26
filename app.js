import { parseTasksJson, toVtodoIcs, toVeventIcs, previewRows } from "./lib/convert.js";
import { extractTasksJson, isZip } from "./lib/zip.js";
import { createStoreZip } from "./lib/zipwrite.js";
import {
  REVIEW_KEY,
  verifyLicense,
  loadCachedLicense,
  saveCachedLicense,
  clearCachedLicense,
} from "./lib/license.js";

const SAMPLE_URL = new URL("./sample/Tasks.json", import.meta.url);
const TIME_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file");
const preview = document.getElementById("preview");
const warningsEl = document.getElementById("warnings");
const statusEl = document.getElementById("status");
const listSelect = document.getElementById("list-select");
const downloadTodos = document.getElementById("download-todos");
const downloadEvents = document.getElementById("download-events");
const downloadPerList = document.getElementById("download-per-list");
const useSample = document.getElementById("use-sample");
const actions = document.getElementById("actions");
const sourceLabel = document.getElementById("source-label");
const licenseInput = document.getElementById("license-key");
const licenseButton = document.getElementById("license-unlock");
const licenseClear = document.getElementById("license-clear");
const licenseStatus = document.getElementById("license-status");
const zoneSelect = document.getElementById("time-zone");

let parsed = null;
let sourceKind = "none"; // sample | user
let license = loadCachedLicense();

function selectedZone() {
  return zoneSelect.value || "UTC";
}

function isUnlocked() {
  return Boolean(license && license.ok && license.status === "valid");
}

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
}

function renderLicense() {
  if (isUnlocked()) {
    const how = license.source === "review" ? "review key" : "Gumroad license";
    licenseStatus.textContent = `Unlocked with a ${how}. Your files stay in this browser.`;
    licenseStatus.dataset.kind = "ok";
    licenseInput.disabled = true;
    licenseButton.hidden = true;
    licenseClear.hidden = false;
  } else {
    licenseStatus.textContent = "No license yet. You can still convert the built-in sample.";
    licenseStatus.dataset.kind = "";
    licenseInput.disabled = false;
    licenseButton.hidden = false;
    licenseClear.hidden = true;
  }
}

function fillTimeZones() {
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [...TIME_ZONES];
  if (browserZone && !zones.includes(browserZone)) zones.splice(1, 0, browserZone);
  zoneSelect.innerHTML = "";
  for (const zone of zones) {
    const option = document.createElement("option");
    option.value = zone;
    option.textContent = zone === browserZone ? `${zone} (this browser)` : zone;
    zoneSelect.appendChild(option);
  }
  zoneSelect.value = zones.includes(browserZone) ? browserZone : "UTC";
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename, text, type = "text/calendar;charset=utf-8") {
  downloadBlob(filename, new Blob([text], { type }));
}

function selectedListId() {
  return listSelect.value || null;
}

function render() {
  if (!parsed) {
    preview.innerHTML = "";
    warningsEl.innerHTML = "";
    actions.hidden = true;
    return;
  }

  warningsEl.innerHTML = "";
  for (const warning of parsed.warnings) {
    const li = document.createElement("li");
    li.textContent = warning;
    warningsEl.appendChild(li);
  }

  const current = listSelect.value;
  listSelect.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All lists (one file)";
  listSelect.appendChild(all);
  for (const list of parsed.lists) {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = `${list.title} (${list.tasks.length})`;
    listSelect.appendChild(option);
  }
  if ([...listSelect.options].some((option) => option.value === current)) {
    listSelect.value = current;
  }

  const rows = previewRows(parsed.lists, { timeZone: selectedZone() });
  preview.innerHTML = "";
  for (const list of rows) {
    const section = document.createElement("section");
    section.className = "list";
    const heading = document.createElement("h2");
    heading.textContent = `${list.title} · ${list.tasks.length} task${list.tasks.length === 1 ? "" : "s"}`;
    section.appendChild(heading);
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Task</th><th>Due</th><th>Status</th><th>Notes</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const task of list.tasks) {
      const tr = document.createElement("tr");
      if (task.isSubtask) tr.classList.add("subtask");
      const title = document.createElement("td");
      const name = document.createElement("div");
      name.className = "title";
      name.textContent = (task.isSubtask ? "↳ " : "") + task.title;
      title.appendChild(name);
      if (task.recurrenceKept) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "repeat kept";
        title.appendChild(tag);
      }
      if (task.recurrenceIncomplete) {
        const tag = document.createElement("span");
        tag.className = "tag warn";
        tag.title = task.recurrenceNote;
        tag.textContent = "repeat not kept";
        title.appendChild(tag);
      }
      const due = document.createElement("td");
      due.textContent = task.dueLabel;
      const status = document.createElement("td");
      status.textContent = task.status === "completed" ? "Completed" : "Needs action";
      const notes = document.createElement("td");
      notes.className = "notes";
      notes.textContent = task.notes || "—";
      tr.append(title, due, status, notes);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    section.appendChild(table);
    preview.appendChild(section);
  }

  actions.hidden = false;
}

async function loadFromText(text, label, kind) {
  parsed = parseTasksJson(text);
  sourceKind = kind;
  sourceLabel.textContent = label;
  const taskCount = parsed.lists.reduce((sum, list) => sum + list.tasks.length, 0);
  setStatus(`Loaded ${taskCount} tasks in ${parsed.lists.length} list${parsed.lists.length === 1 ? "" : "s"}. The file was not uploaded.`, "ok");
  render();
}

async function loadFromFile(file) {
  if (!isUnlocked()) {
    setStatus("To convert your own file, paste a Gumroad license key first. You can still convert the built-in sample.", "error");
    licenseInput.focus();
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = isZip(bytes) ? await extractTasksJson(bytes) : new TextDecoder("utf-8").decode(bytes);
  await loadFromText(text, file.name, "user");
}

async function loadSample() {
  const response = await fetch(SAMPLE_URL);
  if (!response.ok) throw new Error("Could not load the built-in sample.");
  const text = await response.text();
  await loadFromText(text, "Built-in sample (no payment needed)", "sample");
}

dropzone.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  fileInput.click();
});
dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("drag");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropzone.classList.remove("drag");
  const file = event.dataTransfer.files[0];
  if (!file) return;
  try {
    await loadFromFile(file);
  } catch (error) {
    setStatus(error.message, "error");
    parsed = null;
    sourceKind = "none";
    render();
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    await loadFromFile(file);
  } catch (error) {
    setStatus(error.message, "error");
    parsed = null;
    sourceKind = "none";
    render();
  } finally {
    fileInput.value = "";
  }
});

useSample.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  try {
    await loadSample();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

licenseButton.addEventListener("click", async () => {
  const result = await verifyLicense(licenseInput.value);
  if (result.ok) {
    license = result;
    saveCachedLicense(result);
    renderLicense();
    setStatus(result.message, "ok");
  } else {
    setStatus(result.message, "error");
  }
});

licenseClear.addEventListener("click", () => {
  clearCachedLicense();
  license = null;
  licenseInput.value = "";
  renderLicense();
  if (sourceKind === "user") {
    parsed = null;
    sourceKind = "none";
    sourceLabel.textContent = "";
    render();
  }
  setStatus("License removed. Your own files cannot be converted until you unlock again. The built-in sample still works.");
});

zoneSelect.addEventListener("change", () => {
  if (parsed) render();
});

downloadTodos.addEventListener("click", () => {
  if (!parsed) return;
  const result = toVtodoIcs(parsed.lists, { listId: selectedListId(), timeZone: selectedZone() });
  downloadText(result.filename, result.ics);
});

downloadEvents.addEventListener("click", () => {
  if (!parsed) return;
  const result = toVeventIcs(parsed.lists, { listId: selectedListId(), timeZone: selectedZone() });
  if (result.taskCount === 0) {
    setStatus("None of the selected tasks have a due date, so there is no calendar file to download.", "error");
    return;
  }
  downloadText(result.filename, result.ics);
});

downloadPerList.addEventListener("click", () => {
  if (!parsed) return;
  const kind = document.querySelector('input[name="per-list-kind"]:checked')?.value || "vtodo";
  const files = [];
  for (const list of parsed.lists) {
    const result = kind === "vevent"
      ? toVeventIcs([list], { timeZone: selectedZone() })
      : toVtodoIcs([list], { timeZone: selectedZone() });
    if (kind === "vevent" && result.taskCount === 0) continue;
    files.push({ name: result.filename, data: result.ics });
  }
  if (files.length === 0) {
    setStatus("None of the lists produced a file to download.", "error");
    return;
  }
  const zip = createStoreZip(files);
  downloadBlob("tasks-by-list.zip", new Blob([zip], { type: "application/zip" }));
});

fillTimeZones();
renderLicense();
