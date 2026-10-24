// Probe for skills/phaser-rendering/references/webgl-backends.md (Phaser 4.2.1): what breaks when you supply a WebGL 2 context.
//
// Purpose: boot one game per feature on a default WebGL 1 context and on a supplied WebGL 2 context (`config.context`), and
// record whether the render loop survives. Phaser's own shaders for smoothPixelArt, the Gradient game object, the GradientMap
// filter and noise normal maps are GLSL ES 1.00 and enable GL_OES_standard_derivatives, which a WebGL 2 context does not offer,
// so those fail with "Fragment Shader failed". Plain scenes, Blur, Mask and Stencil are unaffected.
// Run:  node phaser-rendering-webgl2-context.mjs /absolute/path/to/project-with-phaser-and-playwright
// It also checks custom GLSL ES 3 Shader game objects on the WebGL 2 context.
// Expected: JSON evidence (the expected shader errors appear under `errors`), then {"passed":true}.
import assert from 'node:assert/strict';
import { runProbe } from './phaser-rendering-harness.mjs';

const FEATURES = ['plain', 'smoothPixelArt', 'gradient', 'gradientMap', 'noiseNormalMap', 'blur', 'mask', 'stencil'];
const BREAKS_ON_WEBGL2 = new Set(['smoothPixelArt', 'gradient', 'gradientMap', 'noiseNormalMap']);

const { evidence } = await runProbe('webgl2-context', async page => {
  const results = {};
  for (const version of ['webgl', 'webgl2']) {
    for (const feature of FEATURES) {
      results[`${version}:${feature}`] = await page.evaluate(async ([version, feature]) => {
        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        const context = canvas.getContext(version);
        const render = feature === 'smoothPixelArt' ? { smoothPixelArt: true, antialias: true } : {};
        const game = new Phaser.Game({
          type: Phaser.WEBGL, canvas, context, width: 64, height: 48, audio: { noAudio: true }, backgroundColor: '#000000', render,
          scene: {
            create() {
              const t = this.textures.createCanvas('r', 8, 8), c = t.getContext();
              c.fillStyle = '#f80'; c.fillRect(0, 0, 8, 8); t.refresh();
              const image = this.add.image(32, 24, 'r').setScale(4);
              if (feature === 'gradient') this.add.gradient(undefined, 0, 0, 64, 48);
              if (feature === 'gradientMap') { image.enableFilters(); image.filters.internal.addGradientMap(); }
              if (feature === 'noiseNormalMap') this.add.noisecell2d({ noiseNormalMap: true }, 0, 0, 64, 48);
              if (feature === 'blur') { image.enableFilters(); image.filters.internal.addBlur(); }
              if (feature === 'mask') {
                image.enableFilters();
                const g = this.make.graphics({}); g.fillStyle(0xffffff).fillRect(0, 0, 32, 48);
                image.filters.internal.addMask(g);
              }
              if (feature === 'stencil') this.add.stencil(0, 0, [this.add.image(10, 10, 'r')]);
            },
          },
        });
        await new Promise(r => setTimeout(r, 1000));
        const rendering = await Promise.race([
          new Promise(r => game.events.once('postrender', () => r(true))),
          new Promise(r => setTimeout(() => r(false), 1500)),
        ]);
        const api = game.renderer.gl.getParameter(game.renderer.gl.VERSION);
        game.destroy(true);
        return { api: api.split(' ').slice(0, 2).join(' '), rendering };
      }, [version, feature]);
    }
  }
  // Custom GLSL ES 3 Shader game objects on the WebGL 2 context: the vertex and fragment sources must both be ES 3.
  for (const variant of ['es3pair', 'es3fragmentOnly', 'es1']) {
    results[`shader:${variant}`] = await page.evaluate(async variant => {
      const canvas = document.createElement('canvas');
      document.body.appendChild(canvas);
      const VERT3 = [
        '#version 300 es', 'precision highp float;', 'uniform mat4 uProjectionMatrix;', 'in vec2 inPosition;', 'in vec2 inTexCoord;',
        'out vec2 outTexCoord;',
        'void main () { gl_Position = uProjectionMatrix * vec4(inPosition, 1.0, 1.0); outTexCoord = inTexCoord; }',
      ].join('\n');
      const FRAG3 = [
        '#version 300 es', 'precision highp float;', 'in vec2 outTexCoord;', 'out vec4 fragColor;',
        'void main () { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }',
      ].join('\n');
      const FRAG1 = 'precision mediump float; varying vec2 outTexCoord; void main () { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }';
      const config = { name: 'es3' };
      if (variant === 'es3pair') { config.vertexSource = VERT3; config.fragmentSource = FRAG3; }
      if (variant === 'es3fragmentOnly') config.fragmentSource = FRAG3;
      if (variant === 'es1') config.fragmentSource = FRAG1;
      const game = new Phaser.Game({
        type: Phaser.WEBGL, canvas, context: canvas.getContext('webgl2'), width: 64, height: 48, audio: { noAudio: true },
        backgroundColor: '#000000', scene: { create() { this.add.shader(config, 32, 24, 40, 40); } },
      });
      window.game = game;
      await new Promise(r => setTimeout(r, 800));
      const rendering = await Promise.race([
        new Promise(r => game.events.once('postrender', () => r(true))),
        new Promise(r => setTimeout(() => r(false), 1500)),
      ]);
      const pixel = rendering ? await H.pixel(32, 24) : null;
      game.destroy(true);
      return { rendering, pixel };
    }, variant);
  }
  return results;
});

for (const feature of FEATURES) {
  assert.equal(evidence[`webgl:${feature}`].rendering, true, `${feature} renders on WebGL 1`);
  assert.equal(evidence[`webgl:${feature}`].api, 'WebGL 1.0');
  assert.equal(evidence[`webgl2:${feature}`].api, 'WebGL 2.0');
  assert.equal(evidence[`webgl2:${feature}`].rendering, !BREAKS_ON_WEBGL2.has(feature), `${feature} on WebGL 2`);
}
assert.deepEqual(evidence['shader:es3pair'], { rendering: true, pixel: [255, 0, 0, 255] });
assert.equal(evidence['shader:es3fragmentOnly'].rendering, false, 'an ES3 fragment shader with the default ES1 vertex shader fails to link');
assert.deepEqual(evidence['shader:es1'], { rendering: true, pixel: [255, 0, 0, 255] });
console.log(JSON.stringify({ passed: true }));
