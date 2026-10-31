import {test} from 'node:test';
import assert from 'node:assert/strict';
import {measureRgbaRegion} from '../skills/phaser-verification/scripts/assets/measure-rgba-regions.mjs';

const black = [0, 0, 0, 255], white = [255, 255, 255, 255];
const input = () => ({rgba: new Uint8Array(Array(16).fill(black).flat()), width: 4, height: 4, region: {x: 0, y: 0, width: 4, height: 4}, palette: [black, white], grid: {size: 2, originX: 0, originY: 0}});

test('exact RGBA includes transparent colour and alpha; inputs are immutable', () => {
  const args = {...input(), rgba: new Uint8ClampedArray([0,0,0,0, 1,0,0,0, 0,0,0,255, 0,0,0,254]), width: 4, height: 1, region: {x: 0, y: 0, width: 4, height: 1}, palette: [[0,0,0,0], black], grid: {size: 1, originX: 0, originY: 0}};
  const before = structuredClone(args), result = measureRgbaRegion(args);
  assert.equal(result.offPalettePixels, 2);
  assert.deepEqual(result.offPaletteSamples, [{x:1,y:0,rgba:[1,0,0,0]}, {x:3,y:0,rgba:[0,0,0,254]}]);
  assert.equal(result.completeCells, 4); assert.equal(result.splitCells, 0);
  assert.deepEqual(args, before);
});

test('one altered pixel is one off-palette pixel and one split complete block', () => {
  const args = input(); args.rgba.set([9,8,7,255], 4 * 5);
  const result = measureRgbaRegion(args);
  assert.equal(result.offPalettePixels, 1); assert.equal(result.splitCells, 1);
  assert.equal(result.completeCells, 4); assert.equal(result.partialCells, 0);
  assert.deepEqual(result.offPaletteSamples, [{x:1,y:1,rgba:[9,8,7,255]}]);
  assert.deepEqual(result.splitSamples, [{x:0,y:0,expected:black,mismatch:{x:1,y:1,rgba:[9,8,7,255]}}]);
});

test('membership and block uniformity are independent, with capped samples', () => {
  const args = input(); for (let i = 0; i < 16; i += 2) args.rgba.set(white, i * 4);
  const result = measureRgbaRegion({...args, sampleLimit: 1});
  assert.equal(result.offPalettePixels, 0); assert.equal(result.splitCells, 4); assert.equal(result.splitSamples.length, 1);
  assert.equal(measureRgbaRegion({...args, palette:[black], sampleLimit:0}).offPalettePixels, 8);
  assert.deepEqual(measureRgbaRegion({...args, palette:[black], sampleLimit:0}).offPaletteSamples, []);
  const capped = measureRgbaRegion({...args, palette:[black,black], sampleLimit:1});
  assert.equal(capped.offPalettePixels,8); assert.equal(capped.offPaletteSamples.length,1);
});

test('explicit grid origins and cropped boundaries exclude partial cells', () => {
  const args = input(); args.rgba.set(white, 0);
  const result = measureRgbaRegion({...args, grid:{size:2,originX:1,originY:-1}});
  assert.equal(result.completeCells, 1); assert.equal(result.partialCells, 8); assert.equal(result.splitCells, 0);
  const crop = measureRgbaRegion({...args, region:{x:1,y:1,width:3,height:3}});
  assert.equal(crop.pixels, 9); assert.equal(crop.completeCells, 1); assert.equal(crop.partialCells, 3);
  const large = measureRgbaRegion({...args,grid:{size:10,originX:0,originY:0}});
  assert.equal(large.completeCells, 0); assert.equal(large.partialCells, 1);
});

test('malformed and missing public inputs refuse measurement', () => {
  assert.throws(() => measureRgbaRegion());
  for (const patch of [
    {rgba:undefined}, {rgba:Array(64).fill(0)}, {rgba:new Uint8Array(63)}, {rgba:new Float32Array(64)},
    {width:0}, {width:1.5}, {height:NaN}, {height:Number.MAX_SAFE_INTEGER},
    {region:undefined}, {region:{x:-1,y:0,width:4,height:4}}, {region:{x:1,y:0,width:4,height:4}}, {region:{x:0,y:0,width:0,height:4}},
    {grid:undefined}, {grid:{size:0,originX:0,originY:0}}, {grid:{size:2,originX:0}}, {grid:{size:2,originX:0.5,originY:0}},
    {palette:[]}, {palette:[[0,0,0]]}, {palette:[[256,0,0,255]]}, {palette:[[0,0,0,0.5]]},
    {sampleLimit:-1}, {sampleLimit:1001}, {sampleLimit:1.5}
  ]) assert.throws(() => measureRgbaRegion({...input(), ...patch}), JSON.stringify(patch));
});
