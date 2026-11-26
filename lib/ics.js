/** ICS text helpers (RFC 5545). */

export function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

export function foldLine(line) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let i = 0;
  let first = true;
  while (i < bytes.length) {
    const budget = first ? 75 : 74;
    let end = Math.min(i + budget, bytes.length);
    while (end > i && (bytes[end] & 0b11000000) === 0b10000000) end--;
    if (end === i) end = Math.min(i + budget, bytes.length);
    const chunk = decoder.decode(bytes.subarray(i, end));
    parts.push(first ? chunk : " " + chunk);
    first = false;
    i = end;
  }
  return parts.join("\r\n");
}

export function icsLines(lines) {
  return lines.filter((line) => line != null).map(foldLine).join("\r\n") + "\r\n";
}

export function formatUtc(date) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

export function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate());
}

export function addUtcDays(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}
