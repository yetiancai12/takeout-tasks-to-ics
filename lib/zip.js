/** Minimal ZIP reader for Takeout archives (store + deflate). */

const EOCD = 0x06054b50;
const LOCAL = 0x04034b50;

function findEocd(view) {
  const maxComment = 0xffff;
  const start = Math.max(0, view.byteLength - 22 - maxComment);
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD) return i;
  }
  throw new Error("This ZIP file is missing a central directory.");
}

function decodeName(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

async function inflateRaw(data) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot unpack compressed ZIP entries.");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export function isZip(bytes) {
  return bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

export async function listZipFiles(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("This ZIP file is not in a format we can read.");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLen));
    files.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export async function readZipEntry(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.localOffset;
  if (view.getUint32(local, true) !== LOCAL) {
    throw new Error(`Could not read ${entry.name} from this ZIP.`);
  }
  const nameLen = view.getUint16(local + 26, true);
  const extraLen = view.getUint16(local + 28, true);
  const dataStart = local + 30 + nameLen + extraLen;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRaw(compressed);
  throw new Error(`The file ${entry.name} uses a ZIP method this tool does not support.`);
}

export async function extractTasksJson(bytes) {
  const files = await listZipFiles(bytes);
  const match = files
    .filter((file) => /(^|\/)Tasks\.json$/i.test(file.name))
    .filter((file) => !file.name.includes("__MACOSX") && !file.name.endsWith("/"))
    .sort((a, b) => a.name.length - b.name.length)[0];
  if (!match) {
    throw new Error("No Tasks.json was found in this ZIP. Export Google Tasks from Google Takeout and drop that archive, or the Tasks.json file itself.");
  }
  const data = await readZipEntry(bytes, match);
  return new TextDecoder("utf-8").decode(data);
}
