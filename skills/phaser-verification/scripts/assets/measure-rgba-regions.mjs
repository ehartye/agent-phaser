/** Measure declared decoded RGBA bytes. No decoding, compositing, tolerance or scale inference. */
export function measureRgbaRegion({rgba, width, height, region, palette, grid, sampleLimit = 16} = {}) {
  const integer = (value, name, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${name} must be an integer in [${min}, ${max}]`);
  };
  integer(width, 'width', 1); integer(height, 'height', 1);
  if (!Number.isSafeInteger(width * height * 4)) throw new RangeError('image byte length is unsafe');
  if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4) throw new TypeError('rgba must be an exact-length Uint8Array or Uint8ClampedArray');
  if (!region || !grid) throw new TypeError('region and grid are required');
  integer(region.x, 'region.x'); integer(region.y, 'region.y');
  integer(region.width, 'region.width', 1); integer(region.height, 'region.height', 1);
  if (region.x > width - region.width || region.y > height - region.height) throw new RangeError('region must be inside the image');
  // Bounded coordinates also keep grid arithmetic exact for every accepted image.
  integer(grid.size, 'grid.size', 1, 1_000_000_000);
  integer(grid.originX, 'grid.originX', -1_000_000_000, 1_000_000_000);
  integer(grid.originY, 'grid.originY', -1_000_000_000, 1_000_000_000);
  integer(sampleLimit, 'sampleLimit', 0, 1000);
  if (!Array.isArray(palette) || !palette.length) throw new TypeError('palette must contain RGBA arrays');
  for (const colour of palette) {
    if (!Array.isArray(colour) || colour.length !== 4) throw new TypeError('each palette entry must have four channels');
    for (const channel of colour) integer(channel, 'palette channel', 0, 255);
  }
  const allowed = new Set(palette.map(colour => colour.join(',')));
  const pixel = (x, y) => Array.from(rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
  const result = {pixels: region.width * region.height, offPalettePixels: 0, offPaletteSamples: [], completeCells: 0, partialCells: 0, splitCells: 0, splitSamples: []};
  const right = region.x + region.width, bottom = region.y + region.height;
  for (let y = region.y; y < bottom; y++) for (let x = region.x; x < right; x++) {
    const value = pixel(x, y);
    if (!allowed.has(value.join(','))) {
      result.offPalettePixels++;
      if (result.offPaletteSamples.length < sampleLimit) result.offPaletteSamples.push({x, y, rgba: value});
    }
  }
  const first = (start, origin) => start - ((start - origin) % grid.size + grid.size) % grid.size;
  for (let y = first(region.y, grid.originY); y < bottom; y += grid.size) {
    for (let x = first(region.x, grid.originX); x < right; x += grid.size) {
      if (x < region.x || y < region.y || x + grid.size > right || y + grid.size > bottom) { result.partialCells++; continue; }
      result.completeCells++;
      const expected = pixel(x, y), key = expected.join(',');
      let mismatch;
      for (let py = y; py < y + grid.size && !mismatch; py++) for (let px = x; px < x + grid.size; px++) {
        const value = pixel(px, py);
        if (value.join(',') !== key) { mismatch = {x: px, y: py, rgba: value}; break; }
      }
      if (mismatch) {
        result.splitCells++;
        if (result.splitSamples.length < sampleLimit) result.splitSamples.push({x, y, expected, mismatch});
      }
    }
  }
  return result;
}
