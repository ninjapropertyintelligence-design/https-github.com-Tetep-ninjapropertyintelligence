/**
 * A small uncompressed RGB GeoTIFF — the same kind of file as a DroneDeploy
 * map export — built in code so tests need no binary fixture.
 *
 * Georeferenced in UTM (EPSG:326xx) when `utm` is given: a tie point at the
 * top-left corner and a pixel size in metres, the way photogrammetry tools
 * write it.
 */
export function rgbGeoTiff(
  width: number,
  height: number,
  utm?: { zone: number; easting: number; northing: number; pixelMeters: number },
): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = 40;
    pixels[i * 3 + 1] = (i % width) * 4;
    pixels[i * 3 + 2] = 90;
  }

  // [tag, type, values]: type 3 = SHORT, 4 = LONG, 12 = DOUBLE.
  const entries: Array<[number, 3 | 4 | 12, number[]]> = [
    [256, 3, [width]],
    [257, 3, [height]],
    [258, 3, [8, 8, 8]],
    [259, 3, [1]],
    [262, 3, [2]],
    [273, 4, [0]], // strip offset, filled in below
    [277, 3, [3]],
    [278, 3, [height]],
    [279, 4, [pixels.length]],
    [284, 3, [1]],
  ];
  if (utm) {
    entries.push([33550, 12, [utm.pixelMeters, utm.pixelMeters, 0]]);
    entries.push([33922, 12, [0, 0, 0, utm.easting, utm.northing, 0]]);
    // GeoKey directory: version 1.1.0, three keys — projected model, pixel-is-area, the UTM zone.
    entries.push([34735, 3, [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 32600 + utm.zone]]);
  }

  const size = (type: number) => (type === 3 ? 2 : type === 4 ? 4 : 8);
  const header = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let cursor = header + ifdSize;
  const outOfLine: Array<{ offset: number; type: number; values: number[] }> = [];
  const offsets = entries.map(([, type, values]) => {
    const bytes = size(type) * values.length;
    if (bytes <= 4) return null;
    const offset = cursor;
    outOfLine.push({ offset, type, values });
    cursor += bytes;
    return offset;
  });
  const dataOffset = cursor;
  entries[5][2] = [dataOffset];

  const buf = Buffer.alloc(dataOffset + pixels.length);
  buf.write("II", 0, "ascii");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(header, 4);
  buf.writeUInt16LE(entries.length, header);
  entries.forEach(([tag, type, values], i) => {
    const at = header + 2 + i * 12;
    buf.writeUInt16LE(tag, at);
    buf.writeUInt16LE(type, at + 2);
    buf.writeUInt32LE(values.length, at + 4);
    if (offsets[i] !== null) buf.writeUInt32LE(offsets[i]!, at + 8);
    else if (type === 3) values.forEach((v, j) => buf.writeUInt16LE(v, at + 8 + j * 2));
    else buf.writeUInt32LE(values[0], at + 8);
  });
  buf.writeUInt32LE(0, header + 2 + entries.length * 12);
  for (const { offset, type, values } of outOfLine) {
    values.forEach((v, j) => {
      if (type === 3) buf.writeUInt16LE(v, offset + j * 2);
      else if (type === 4) buf.writeUInt32LE(v, offset + j * 4);
      else buf.writeDoubleLE(v, offset + j * 8);
    });
  }
  pixels.copy(buf, dataOffset);
  return buf;
}
