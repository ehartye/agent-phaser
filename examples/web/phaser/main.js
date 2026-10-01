// Phaser 3.90.0 build of the agent-engine sample scene (2D parts: campfire, courier, audio).
// The campfire and courier load through Phaser's Aseprite loader from the agent-sprites atlas unchanged, which
// is the wiring agent-sprites documents. Audio goes through the vendored agent-beeps browser player.
import { createPlayer } from '/web/vendor/beeps-player/player/player.js';

const W = 960, H = 540;
const state = { ready: false, audioErrors: [], pickups: [], unlocked: false, anims: {} };
window.__state = () => snapshot();

const player = createPlayer({
  catalog: '/assets/audio/index.json', voices: 8,
  onError: (e) => state.audioErrors.push(e),
});
window.__player = player;

let fire, courier, glow;

class SampleScene extends Phaser.Scene {
  preload() {
    this.load.aseprite('campfire', '/assets/sprites/campfire.png', '/assets/sprites/campfire.atlas.json');
    this.load.aseprite('courier', '/assets/sprites/courier.png', '/assets/sprites/courier.atlas.json');
  }

  create() {
    // dusk sky and ground
    const g = this.add.graphics();
    g.fillGradientStyle(0x070b24, 0x070b24, 0x3a2140, 0x3a2140, 1);
    g.fillRect(0, 0, W, 360);
    g.fillStyle(0x141a3a, 1).fillRect(0, 360, W, H - 360);
    g.fillStyle(0x0d1230, 1).fillRect(0, 360, W, 4);

    const burn = this.anims.createFromAseprite('campfire');
    const walk = this.anims.createFromAseprite('courier');
    state.anims.campfire = burn.map(a => ({ key: a.key, frames: a.frames.length, frameRate: a.frameRate, durations: [...new Set(a.frames.map(f => f.duration))] }));
    state.anims.courier = walk.map(a => ({ key: a.key, frames: a.frames.length, durations: [...new Set(a.frames.map(f => f.duration))] }));

    glow = this.add.ellipse(W / 2, 452, 520, 120, 0xff8a2a, 0.22);
    fire = this.add.sprite(W / 2, 470, 'campfire').setOrigin(0.5, 1).setScale(8).play({ key: 'burn', repeat: -1 });
    // Phaser ignores the atlas pivot slice, so set the origin by hand (bottom centre, as the slice says)
    courier = this.add.sprite(W / 2 + 280, 470, 'courier').setOrigin(11 / 24, 29 / 32).setScale(6).play({ key: 'walk', repeat: -1 });
    this.tweens.add({ targets: courier, x: { from: W / 2 + 280, to: W / 2 + 420 }, duration: 3500, yoyo: true, repeat: -1,
      onYoyo: () => courier.setFlipX(true), onRepeat: () => courier.setFlipX(false) });
    this.tweens.add({ targets: glow, alpha: { from: 0.16, to: 0.3 }, duration: 260, yoyo: true, repeat: -1 });

    this.input.keyboard.on('keydown-SPACE', start);
    this.input.keyboard.on('keydown-P', pickup);
    this.input.on('pointerdown', start);
    state.ready = true;
  }
}

async function start() {
  if (state.unlocked) return;
  await player.unlock();
  state.unlocked = true;
  await player.music('survey-drone', { fadeSec: 1 });
}

function pickup(opts = {}) {
  const handle = player.play('relic-discovered', opts);
  state.pickups.push(handle ? handle.file : null);
  return handle ? handle.file : null;
}
window.__pickup = pickup;

function snapshot() {
  const f = fire && fire.anims && fire.anims.currentFrame;
  const c = courier && courier.anims && courier.anims.currentFrame;
  return {
    ready: state.ready, unlocked: state.unlocked, audioErrors: state.audioErrors, pickups: state.pickups, anims: state.anims,
    fire: f ? { anim: fire.anims.currentAnim.key, frameIndex: f.index, textureFrame: f.textureFrame, playing: fire.anims.isPlaying } : null,
    courier: c ? { anim: courier.anims.currentAnim.key, frameIndex: c.index, textureFrame: c.textureFrame, playing: courier.anims.isPlaying, x: Math.round(courier.x) } : null,
    audio: player.inspect(),
    renderer: window.__game ? window.__game.renderer.type : null,
  };
}

window.__game = new Phaser.Game({
  type: Phaser.WEBGL, width: W, height: H, parent: 'game', pixelArt: true, backgroundColor: '#05060f',
  scene: SampleScene, audio: { noAudio: true },
});
