// The sections-to-markers converter for agent-beeps song sidecars: marker times equal the section frames, the loop is set only where asked,
// repeated section names stay unique, and a sidecar without sections fails loudly instead of producing markers that never play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markersFromSections, uniqueMarkerNames } from '../skills/phaser-audio/scripts/assets/beeps-markers.mjs';

// A real `beeps song export --manifest --sections` sidecar (agent-beeps 0.35.0) with its identity fields made neutral.
const sidecar = JSON.parse(readFileSync(new URL('./fixtures/beeps-song-sections-0.35.0.json', import.meta.url), 'utf8'));

test('one marker per played section, in order, with times on the delivered samples', () => {
  const markers = markersFromSections(sidecar);
  assert.deepEqual(markers.map(m => m.name), sidecar.sections.map(s => s.name));
  markers.forEach((m, i) => {
    const s = sidecar.sections[i];
    assert.equal(m.start, s.startFrame / sidecar.sampleRate);
    assert.ok(Math.abs(m.start - s.start) < 1 / sidecar.sampleRate, `${m.name} start follows the section seconds`);
    assert.ok(Math.abs(m.start + m.duration - s.end) < 1 / sidecar.sampleRate, `${m.name} end follows the section seconds`);
  });
});

test('the markers tile the song: contiguous, and the durations sum to the looped file length', () => {
  const markers = markersFromSections(sidecar);
  assert.equal(markers[0].start, 0);
  markers.slice(1).forEach((m, i) => assert.ok(Math.abs(m.start - (markers[i].start + markers[i].duration)) < 1e-9, `${m.name} starts where the section before ends`));
  const total = markers.reduce((sum, m) => sum + m.duration, 0);
  assert.ok(sidecar.loop, 'the fixture loops, so its sections fill the file');
  assert.ok(Math.abs(total - sidecar.durationSec) < 1e-6, `${total} against ${sidecar.durationSec}`);
});

test('no marker loops unless asked; named sections loop; true loops all', () => {
  assert.ok(markersFromSections(sidecar).every(m => m.config.loop === false));
  const some = markersFromSections(sidecar, { loopSections: ['survey', 'hover'] });
  assert.deepEqual(some.filter(m => m.config.loop).map(m => m.name), ['survey', 'hover']);
  assert.ok(markersFromSections(sidecar, { loopSections: true }).every(m => m.config.loop === true));
  assert.throws(() => markersFromSections(sidecar, { loopSections: ['chorus'] }), /names no section: chorus/);
});

test('a sidecar without sections throws a message that says how to export them', () => {
  const { sections, ...old } = sidecar;
  assert.throws(() => markersFromSections(old), /no sections.*--sections.*0\.35\.0/);
  assert.throws(() => markersFromSections({ ...old, sections: [] }), /no sections/);
  assert.throws(() => markersFromSections(undefined), /no sections/);
  assert.equal(old.durationSec, sidecar.durationSec, 'the rest of the old sidecar is still readable');
});

test('a section played twice gets a unique marker name and loops wherever its name is listed', () => {
  assert.deepEqual(uniqueMarkerNames(['a', 'b', 'a', 'a', 'b']), ['a', 'b', 'a-2', 'a-3', 'b-2']);
  assert.deepEqual(uniqueMarkerNames(['a', 'a-2', 'a']), ['a', 'a-2', 'a-3'], 'a suffix never collides with a real section name');
  const repeated = { sampleRate: 1000, sections: [
    { name: 'a', start: 0, end: 1, startFrame: 0, endFrame: 1000 },
    { name: 'b', start: 1, end: 2, startFrame: 1000, endFrame: 2000 },
    { name: 'a', start: 2, end: 3, startFrame: 2000, endFrame: 3000 },
  ] };
  const markers = markersFromSections(repeated, { loopSections: ['a'] });
  assert.deepEqual(markers.map(m => [m.name, m.start, m.duration, m.config.loop]), [['a', 0, 1, true], ['b', 1, 1, false], ['a-2', 2, 1, true]]);
});

test('a sidecar with no sample rate is refused', () => {
  assert.throws(() => markersFromSections({ sections: sidecar.sections }), /sampleRate/);
});
