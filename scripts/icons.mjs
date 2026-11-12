import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
const crc = (b) => {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const n = Buffer.from(name),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  n.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([n, data])), 8 + data.length);
  return out;
};
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const lines = [
    [130, 190, 130, 322],
    [195, 146, 195, 366],
    [317, 146, 317, 366],
    [382, 190, 382, 322],
    [195, 256, 317, 256],
  ];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const xx = (x * 512) / size,
        yy = (y * 512) / size;
      const ink = lines.some(([ax, ay, bx, by]) => {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((xx - ax) * (bx - ax) + (yy - ay) * (by - ay)) /
              ((bx - ax) ** 2 + (by - ay) ** 2),
          ),
        );
        return (
          Math.hypot(xx - ax - t * (bx - ax), yy - ay - t * (by - ay)) < 22
        );
      });
      const pos = y * (size * 3 + 1) + 1 + x * 3;
      raw.set(ink ? [164, 68, 45] : [246, 241, 232], pos);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    new URL("../public/" + name, import.meta.url),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
