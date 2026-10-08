// A deliberately tiny Phaser 4 game: a blue sky, a green ground and an orange block that a tween slides. It exists to give the harness
// something to boot, step, and read pixels from. Replace it with your own game; keep the three hooks marked HARNESS.
import { gate, installDebug } from './debug.mjs';

export const SIZE = { w: 640, h: 360 };
export const COLOURS = { sky: 0x2060c0, ground: 0x30a050, block: 0xff8a2a };

class World extends Phaser.Scene {
  create() {
    this.add.rectangle(0, 0, SIZE.w, 240, COLOURS.sky).setOrigin(0, 0);
    this.add.rectangle(0, 240, SIZE.w, SIZE.h - 240, COLOURS.ground).setOrigin(0, 0);
    this.block = this.add.rectangle(100, 200, 40, 40, COLOURS.block);
    this.tweens.add({ targets: this.block, x: 500, duration: 2000, yoyo: true, repeat: -1 });
    this.ticks = 0;
    this.ready = true;                                   // HARNESS 1: a named readiness flag the tests wait on, never a sleep
  }
  update() { this.ticks++; }
}

const game = new Phaser.Game({
  type: Phaser.WEBGL,                                    // fail loudly instead of falling back to Canvas
  width: SIZE.w, height: SIZE.h, backgroundColor: '#000000',
  pixelArt: true, audio: { noAudio: true },
  scene: [World],
});
globalThis.__game = game;                                // HARNESS 2: the one global the tests reach for
if (gate(location.search)) installDebug(game);           // HARNESS 3: tooling loads only in dev or when the URL asks (?debug=1)
