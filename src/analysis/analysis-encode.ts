    const PNG_HEADER = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function encodePngRgba(
  width: number,
  height: number,
  rgba: Uint8Array,
): ArrayBuffer {
  const scanlineSize = width * 4 + 1;
  const raw = new Uint8Array(scanlineSize * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineSize;
    raw[rowOffset] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowOffset + 1);
  }

  const idatData = zlibStore(raw);
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width >>> 0);
  writeUint32(ihdr, 4, height >>> 0);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunks = [
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idatData),
    makeChunk("IEND", new Uint8Array(0)),
  ];

  const totalLength =
    PNG_HEADER.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const png = new Uint8Array(totalLength);
  let offset = 0;
  png.set(PNG_HEADER, offset);
  offset += PNG_HEADER.length;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }

  return png.buffer.slice(0);
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crc = crc32(out, 4, 8 + data.length);
  writeUint32(out, 8 + data.length, crc >>> 0);
  return out;
}

function zlibStore(raw: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const blocks = Math.ceil(raw.length / maxBlock);
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let offset = 0;

  out[offset++] = 0x78;
  out[offset++] = 0x01;

  let pos = 0;
  while (pos < raw.length) {
    const len = Math.min(maxBlock, raw.length - pos);
    const final = pos + len >= raw.length;
    out[offset++] = final ? 1 : 0;
    out[offset++] = len & 0xff;
    out[offset++] = (len >>> 8) & 0xff;
    const nlen = ~len & 0xffff;
    out[offset++] = nlen & 0xff;
    out[offset++] = (nlen >>> 8) & 0xff;
    out.set(raw.subarray(pos, pos + len), offset);
    offset += len;
    pos += len;
  }

  writeUint32(out, offset, adler32(raw));
  offset += 4;
  return out.subarray(0, offset);
}

function writeUint32(data: Uint8Array, offset: number, value: number) {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
