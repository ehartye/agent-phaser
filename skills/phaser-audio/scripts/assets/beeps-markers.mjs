// Section markers for an agent-beeps song export, for a game that plays the exported file through Phaser's own sound manager and so
// needs `sound.addMarker` objects to start, loop or cut to one region of the song. Pure: no Phaser import and no Web Audio, so it runs in Node.
// Needs a sidecar written with `beeps song export --manifest --sections` (or `"sections": true` on a song recipe), agent-beeps 0.35.0 or later:
//   { sampleRate, sections: [{ name, start, end, startFrame, endFrame }] }
// Usage:
//   const markers = markersFromSections(sidecar, { loopSections: ['survey'] });
//   const music = this.sound.add('theme');
//   for (const m of markers) music.addMarker(m);
//   music.play('survey');                               // then music.play('outro') to cut to another region; pass the full config each time
// Times come from the frame offsets (startFrame / sampleRate), so they land on the delivered file's samples, not on the form's float seconds.
// A section the form plays twice keeps its name the first time and gets "-2", "-3" ... after, because Phaser refuses a duplicate marker name.

/** Marker names for a list of section names: the first use keeps the name, repeats get "-2", "-3" ..., and a suffix never collides. */
export function uniqueMarkerNames(names) {
  const seen = new Set(), counts = new Map();
  return names.map(name => {
    let n = counts.get(name) ?? 0, candidate;
    do { n += 1; candidate = n === 1 ? name : `${name}-${n}`; } while (seen.has(candidate));
    counts.set(name, n); seen.add(candidate);
    return candidate;
  });
}

/**
 * `sound.addMarker` objects for every played section of a song sidecar, in order.
 * `loopSections` is a list of section names whose marker loops that region only (every play of that name), or `true` for all of them.
 * Throws when the sidecar has no `sections`: an empty list would make every `play('name')` a silent no-op.
 */
export function markersFromSections(sidecar, { loopSections = [] } = {}) {
  const sections = sidecar?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error(`sidecar${sidecar?.id ? ` "${sidecar.id}"` : ''} has no sections: export the song with "beeps song export --manifest --sections" (agent-beeps 0.35.0 or later), or set "sections": true on its build recipe`);
  }
  const rate = sidecar.sampleRate;
  if (!(rate > 0)) throw new Error('sidecar has no sampleRate');
  const looped = loopSections === true ? null : new Set(loopSections);
  if (looped) {
    const known = new Set(sections.map(s => s.name));
    const missing = [...looped].filter(name => !known.has(name));
    if (missing.length) throw new Error(`loopSections names no section: ${missing.join(', ')} (sections are ${[...known].join(', ')})`);
  }
  const names = uniqueMarkerNames(sections.map(s => s.name));
  return sections.map((s, i) => ({
    name: names[i],
    start: s.startFrame / rate,
    duration: (s.endFrame - s.startFrame) / rate,
    config: { loop: looped === null || looped.has(s.name) },
  }));
}
