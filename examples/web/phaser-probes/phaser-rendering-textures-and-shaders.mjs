// Probe for skills/phaser-rendering/references/textures-and-render-targets.md and custom-shaders-in-phaser.md (Phaser 4.2.1).
//
// Purpose: prove DynamicTexture / RenderTexture behaviour that fails silently (nothing draws before render(), commands queued
// inside callback() are dropped, forceEven rounds up), which sampling filter framebuffers get from `antialias`, what a global
// `render.alphaStrategy: 'dither'` does to a half-transparent sprite, the tint-mode matrix including MULTIPLY_TWO, and the
// Shader game object facts: `updateShaderConfig(drawingContext, gameObject, node)` argument order and the missing alpha.
// Run:  node phaser-rendering-textures-and-shaders.mjs /absolute/path/to/project-with-phaser-and-playwright
// Expected: JSON evidence, then {"passed":true}. Tint modes HARD_LIGHT and MULTIPLY_TWO are asserted only on a hardware GL stack
// (set PROBE_GL=hardware): the software stack leaves those two modes untinted, which the evidence records as `software: true`.
import assert from 'node:assert/strict';
import { runProbe } from './phaser-rendering-harness.mjs';

const { evidence, errors } = await runProbe('textures-and-shaders', async page => {
  const out = await page.evaluate(async () => {
    const out = {};
    const { scene } = await H.boot({}, {
      create() { H.solid(this, 'red', 8, '#f00'); H.solid(this, 'gray', 8, '#808080'); H.solid(this, 'black', 8, '#000'); H.solid(this, 'green', 8, '#0f0'); },
    });

    // 1. DynamicTexture / RenderTexture.
    const rt = scene.add.renderTexture(80, 60, 40, 40);
    rt.fill(0xff0000);
    out.beforeRender = await H.pixel(80, 60);
    rt.render();
    out.afterRender = await H.pixel(80, 60);
    rt.fill(0x00ff00);
    rt.callback(() => { rt.fill(0x0000ff); });   // queued while the buffer is being executed
    rt.render();
    out.afterCallback = await H.pixel(80, 60);
    out.bufferLength = rt.texture.commandBuffer.length;
    const odd = scene.textures.addDynamicTexture('odd', 33, 33);
    const exact = scene.textures.addDynamicTexture('exact', 33, 33, false);
    out.forceEven = { default: [odd.width, odd.height], off: [exact.width, exact.height] };
    out.framebufferMag = { antialiasFalse: odd.drawingContext.texture.magFilter === game.renderer.gl.NEAREST ? 'NEAREST' : 'LINEAR' };
    scene.children.removeAll(true);

    // 2. Tint modes on a mid-gray and a black texel, tint 0xff4020, tint2 0x2040ff.
    out.tint = {};
    for (const key of ['gray', 'black']) {
      for (const [name, mode] of Object.entries(Phaser.TintModes)) {
        scene.children.removeAll(true);
        scene.add.image(80, 60, key).setScale(10).setTint(0xff4020).setTint2(0x2040ff).setTintMode(mode);
        out.tint[`${key}:${name}`] = (await H.pixel(80, 60)).slice(0, 3);
      }
    }
    const gl = game.renderer.gl, info = gl.getExtension('WEBGL_debug_renderer_info');
    out.software = /swiftshader|llvmpipe|software/i.test(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    scene.children.removeAll(true);

    // 3. Shader game object.
    let args = null;
    const shader = scene.add.shader({
      name: 'probeShader',
      fragmentSource: 'precision mediump float; varying vec2 outTexCoord; void main () { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }',
      updateShaderConfig() { args = Array.from(arguments).map(a => a && a.constructor && a.constructor.name); },
    }, 80, 60, 40, 40);
    await H.frames(2);
    out.updateShaderConfigArgs = args;
    out.shaderAlpha = { alpha: shader.alpha, setAlphaReturnsThis: shader.setAlpha(0.2) === shader };
    out.shaderPixel = await H.pixel(80, 60);

    // OVERLAY is not a WebGL blend mode, but the camera Blend filter reproduces it from a camera-sized DynamicTexture filled with neutral gray.
    scene.children.removeAll(true);
    const cam = scene.cameras.main;
    cam.setBackgroundColor(0x806040);
    const layer = scene.textures.addDynamicTexture('overlayLayer', cam.width, cam.height);
    layer.fill(0x808080); layer.fill(0x4080c0, 1, 20, 20, 40, 40); layer.render();
    const blend = cam.filters.external.addBlend('overlayLayer', Phaser.BlendModes.OVERLAY, 1);
    out.overlayFilter = { inside: (await H.pixel(30, 30)).slice(0, 3), neutral: (await H.pixel(30, 90)).slice(0, 3) };
    cam.filters.external.remove(blend);
    //   A layer whose empty areas are transparent instead of gray is not neutral: OVERLAY with zero darkens the scene.
    const clear = scene.textures.addDynamicTexture('overlayClear', cam.width, cam.height);
    clear.fill(0x4080c0, 1, 20, 20, 40, 40); clear.render();
    const blend2 = cam.filters.external.addBlend('overlayClear', Phaser.BlendModes.OVERLAY, 1);
    out.overlayTransparentLayer = (await H.pixel(30, 90)).slice(0, 3);
    cam.filters.external.remove(blend2);
    cam.setBackgroundColor(0x000000);

    // saveTexture renames the RenderTexture's own texture into the manager; the texture then outlives the RenderTexture.
    const keep = scene.add.renderTexture(0, 0, 8, 8);
    const keepKey = keep.texture.key;
    keep.saveTexture('saved-a');
    const afterFirstSave = { oldKeyExists: scene.textures.exists(keepKey), newKeyExists: scene.textures.exists('saved-a') };
    keep.saveTexture('saved-b');
    const afterRename = { aExists: scene.textures.exists('saved-a'), bExists: scene.textures.exists('saved-b') };
    keep.destroy();
    const survivesDestroy = scene.textures.exists('saved-b');
    scene.textures.remove('saved-b');
    const temp = scene.add.renderTexture(0, 0, 8, 8);
    const tempKey = temp.texture.key;
    temp.destroy();
    out.saveTexture = { afterFirstSave, afterRename, survivesDestroy, removedByRemove: !scene.textures.exists('saved-b'), unsavedTextureRemainsAfterDestroy: scene.textures.exists(tempKey) };

    // CaptureFrame needs a framebuffer context: with forceComposite it copies what was drawn before it, upright; without it, nothing.
    const capture = async force => {
      scene.children.removeAll(true);
      if (scene.textures.exists('cap')) scene.textures.remove('cap');
      cam.setForceComposite(force);
      scene.add.image(10, 10, 'red').setScale(2);
      scene.add.captureFrame('cap');
      scene.add.image(150, 110, 'green').setScale(2);               // drawn after the capture
      scene.add.image(120, 30, 'cap').setScale(0.5);                // an 80 x 60 view of the capture
      return { earlier: (await H.pixel(84, 4)).slice(0, 3), later: (await H.pixel(156, 56)).slice(0, 3) };
    };
    out.captureFrame = { forceComposite: await capture(true), mainCanvas: await capture(false) };
    cam.setForceComposite(false);
    scene.children.removeAll(true);

    // Factory names are lowercase for the noise family; the camel-case spelling in Phaser's skill does not exist.
    out.factories = { camelCase: typeof scene.add.noiseCell2D, lowercase: typeof scene.add.noisecell2d, all: ['noise', 'noisecell2d', 'noisecell3d', 'noisecell4d', 'noisesimplex2d', 'noisesimplex3d', 'gradient', 'shader', 'mesh2d', 'spriteGPULayer', 'stencil', 'stencilreference', 'customcontext'].filter(name => typeof scene.add[name] !== 'function') };

    // The blend is premultiplied (ONE, ONE_MINUS_SRC_ALPHA): a Shader that writes (1, 0, 0, 0.5) shows full red.
    scene.children.removeAll(true);
    const frag = rgba => 'precision mediump float; varying vec2 outTexCoord; void main () { gl_FragColor = vec4(' + rgba + '); }';
    scene.add.shader({ name: 'straight', fragmentSource: frag('1.0, 0.0, 0.0, 0.5') }, 40, 60, 30, 30);
    scene.add.shader({ name: 'premultiplied', fragmentSource: frag('0.5, 0.0, 0.0, 0.5') }, 120, 60, 30, 30);
    out.straightAlphaOutput = await H.pixel(40, 60);
    out.premultipliedOutput = await H.pixel(120, 60);
    return out;
  });

  // 4. Global alpha strategy and framebuffer filtering need their own games (they are boot-time options).
  const boot = async config => page.evaluate(async config => {
    const countFull = rgba => { let full = 0, off = 0, mid = 0; for (let i = 0; i < rgba.length; i += 4) { if (rgba[i] === 255) full++; else if (rgba[i] === 0) off++; else mid++; } return { full, off, mid, n: rgba.length / 4 }; };
    await window.game.destroy(true);
    const { scene } = await H.boot(config, { create() { H.solid(this, 'red', 8, '#f00'); this.add.image(80, 60, 'red').setScale(4).setAlpha(0.5); } });
    const result = {};
    result.region = countFull(await H.region(66, 46, 28, 28));
    const dt = scene.textures.addDynamicTexture('probeDt', 32, 32);
    result.framebufferMag = dt.drawingContext.texture.magFilter === game.renderer.gl.NEAREST ? 'NEAREST' : 'LINEAR';
    // Mipmaps need mipmapRegeneration, a mipmap filter and a power-of-two size.
    const mip = size => { const t = scene.textures.addDynamicTexture('mip' + size, size, size, false); return t.drawingContext.texture.minFilter === game.renderer.gl.LINEAR_MIPMAP_LINEAR; };
    result.mipmaps = { pow2: mip(32), npot: mip(33) };
    return result;
  }, config);
  out.alphaKeep = await boot({ render: { alphaStrategy: 'keep', antialias: true } });
  out.alphaDither = await boot({ render: { alphaStrategy: 'dither', antialias: true } });
  out.pixelArtFramebuffer = (await boot({ pixelArt: true })).framebufferMag;
  out.mipmapsOn = (await boot({ render: { antialias: true, mipmapFilter: 'LINEAR_MIPMAP_LINEAR', mipmapRegeneration: true } })).mipmaps;
  out.mipmapsOff = (await boot({ render: { antialias: true, mipmapFilter: 'LINEAR_MIPMAP_LINEAR' } })).mipmaps;
  return out;
});

assert.deepEqual(evidence.beforeRender.slice(0, 3), [0, 0, 0], 'nothing is drawn before render()');
assert.deepEqual(evidence.afterRender.slice(0, 3), [255, 0, 0]);
assert.deepEqual(evidence.afterCallback.slice(0, 3), [0, 255, 0], 'a fill queued inside callback() never draws');
assert.equal(evidence.bufferLength, 0, 'and the buffer is emptied after the run');
assert.deepEqual(evidence.forceEven, { default: [34, 34], off: [33, 33] });
assert.equal(evidence.framebufferMag.antialiasFalse, 'NEAREST');
assert.equal(evidence.alphaKeep.framebufferMag, 'LINEAR', 'default antialias: framebuffers are sampled LINEAR');
assert.equal(evidence.pixelArtFramebuffer, 'NEAREST', 'pixelArt: framebuffers are sampled NEAREST');
assert.deepEqual(evidence.mipmapsOn, { pow2: true, npot: false }, 'mipmapRegeneration gives power-of-two DynamicTextures mipmaps only');
assert.deepEqual(evidence.mipmapsOff, { pow2: false, npot: false }, 'without mipmapRegeneration there are none');
assert.equal(evidence.alphaKeep.region.mid, evidence.alphaKeep.region.n, 'keep: the half-transparent sprite is blended');
assert.equal(evidence.alphaDither.region.mid, 0, 'dither: every pixel is fully on or fully off');
assert.ok(Math.abs(evidence.alphaDither.region.full / evidence.alphaDither.region.n - 0.5) < 0.1);
// Modes that work on every stack.
assert.deepEqual(evidence.tint['gray:MULTIPLY'], [128, 32, 16]);
assert.deepEqual(evidence.tint['gray:FILL'], [255, 64, 32]);
assert.deepEqual(evidence.tint['black:ADD'], [255, 64, 32]);
if (evidence.software) {
  console.log('software GL: HARD_LIGHT and MULTIPLY_TWO assertions skipped; recorded:', evidence.tint['gray:HARD_LIGHT'], evidence.tint['gray:MULTIPLY_TWO']);
} else {
  assert.deepEqual(evidence.tint['black:MULTIPLY_TWO'], [0x20, 0x40, 0xff], 'a black texel takes tint2');
  assert.deepEqual(evidence.tint['gray:HARD_LIGHT'].map(v => v > 128), [true, false, false]);
}
const overlay = (base, top) => Math.round((base < 0.5 ? 2 * base * top : 1 - 2 * (1 - base) * (1 - top)) * 255);
assert.deepEqual(evidence.overlayFilter.inside, [[0x80, 0x40], [0x60, 0x80], [0x40, 0xc0]].map(([b, t]) => overlay(b / 255, t / 255)), 'OVERLAY formula from the Blend filter');
assert.deepEqual(evidence.overlayFilter.neutral, [0x80, 0x60, 0x40], 'neutral gray leaves the scene unchanged');
assert.ok(evidence.overlayTransparentLayer[0] <= 2 && evidence.overlayTransparentLayer[1] === 0 && evidence.overlayTransparentLayer[2] === 0, `a transparent layer darkens the scene: ${evidence.overlayTransparentLayer}`);
assert.deepEqual(evidence.saveTexture, {
  afterFirstSave: { oldKeyExists: false, newKeyExists: true },
  afterRename: { aExists: false, bExists: true },
  survivesDestroy: true,
  removedByRemove: true,
  unsavedTextureRemainsAfterDestroy: false,
});
assert.deepEqual(evidence.captureFrame, { forceComposite: { earlier: [255, 0, 0], later: [0, 0, 0] }, mainCanvas: { earlier: [0, 0, 0], later: [0, 0, 0] } });
assert.deepEqual(evidence.factories, { camelCase: 'undefined', lowercase: 'function', all: [] });
assert.deepEqual(evidence.updateShaderConfigArgs, ['DrawingContext', 'Shader', 'ShaderQuad']);
assert.equal(evidence.shaderAlpha.alpha, undefined);
assert.equal(evidence.shaderAlpha.setAlphaReturnsThis, true);
assert.deepEqual(evidence.shaderPixel.slice(0, 3), [255, 0, 0], 'setAlpha(0.2) changed nothing');
assert.deepEqual(evidence.straightAlphaOutput.slice(0, 3), [255, 0, 0], 'straight-alpha output is not halved');
assert.ok(Math.abs(evidence.premultipliedOutput[0] - 128) <= 1, 'premultiplied output is half red');
assert.deepEqual(errors.filter(e => !/CaptureFrame: Cannot capture from main canvas/.test(e)), [], 'only the one-time CaptureFrame warning is expected');
assert.equal(errors.filter(e => /CaptureFrame/.test(e)).length, 1);
console.log(JSON.stringify({ passed: true }));
