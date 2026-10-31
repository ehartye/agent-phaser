// Bounded native example: Canvas, opaque colours, ASCII BitmapText, integer transforms.
export async function createTextFitFixture() {
  const Phaser = globalThis.Phaser;
  let scene, timer, game, disposed = false, revision = 0, overlay;
  const ready = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('text fixture boot timed out')), 10000);
    class Main extends Phaser.Scene { create() { scene = this; resolve(); } }
    game = new Phaser.Game({type: Phaser.CANVAS, width: 160, height: 120, pixelArt: true, backgroundColor: '#102030', audio: {noAudio: true}, scene: Main});
  });
  try { await ready; } catch (error) { game?.destroy(true); game?.runDestroy(); throw error; } finally { clearTimeout(timer); }
  game.loop.sleep();
  // Canvas batchSprite expands the destination by 0.5 source pixels when roundPixels is true.
  // Integer placements need no rounding; keep the declared source blocks exact at both scales.
  scene.cameras.main.roundPixels = false;
  const glyphPatterns = {A: ['010','101','111','101','101'], B: ['110','101','110','101','110'], C: ['011','100','100','100','011'], ' ': ['000','000','000','000','000']};
  const chars = 'ABC ', font = scene.textures.createCanvas('evidence-font-strip', 12, 5), fc = font.getContext();
  fc.fillStyle = '#ffffff';
  for (const [i, character] of [...chars].entries()) for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (glyphPatterns[character][y][x] === '1') fc.fillRect(i * 3 + x, y, 1, 1);
  font.refresh();
  scene.cache.bitmapFont.add('evidence-font', Phaser.GameObjects.RetroFont.Parse(scene, {image:'evidence-font-strip', width:3, height:5, chars, charsPerRow:4}));
  const colour = scene.textures.createCanvas('evidence-colours', 8, 4), cc = colour.getContext();
  cc.fillStyle = '#203040'; cc.fillRect(0, 0, 8, 4); cc.fillStyle = '#e0d0a0'; cc.fillRect(4, 0, 4, 4); colour.refresh();
  const tile = scene.add.image(0, 0, 'evidence-colours').setOrigin(0);
  const registrations = [
    {id:'heading', object:scene.add.bitmapText(0, 0, 'evidence-font', 'AB C', 3), text:'AB C'},
    {id:'caption', object:scene.add.bitmapText(0, 0, 'evidence-font', 'CAB', 3), text:'CAB'}
  ];
  let declaration;
  const rect = value => ({x:value.x, y:value.y, width:value.width, height:value.height});
  const source = (texture, width, height) => ({width, height, rgba:Array.from(texture.getContext().getImageData(0,0,width,height).data), png:texture.getSourceImage().toDataURL('image/png')});
  const sources = {font:source(font,12,5), colours:source(colour,8,4)};
  function layout(scale, mutation = null) {
    if (disposed) throw new Error('fixture disposed');
    if (![1,2].includes(scale)) throw new Error('supported scales are 1 and 2');
    if (mutation && !['off-palette','split-cell','long-word','missing-glyph'].includes(mutation)) throw new Error('unsupported mutation');
    overlay?.destroy(); overlay = null;
    revision++;
    const region = {x:8*scale,y:8*scale,width:16*scale,height:8*scale};
    tile.setPosition(region.x, region.y).setScale(2 * scale);
    for (const [i, registration] of registrations.entries()) {
      registration.allocation = {x:8*scale, y:(24+i*16)*scale, width:30*scale, height:12*scale};
      const allocation = registration.allocation;
      const text = i === 0 && mutation === 'long-word' ? 'ABCABCABCABCABCABC' : i === 0 && mutation === 'missing-glyph' ? 'ABXC' : registration.text;
      registration.object.setPosition(allocation.x, allocation.y).setScale(scale).setText(text).setMaxWidth(allocation.width);
    }
    if (mutation === 'off-palette' || mutation === 'split-cell') overlay = scene.add.rectangle(region.x,region.y,1,1,mutation === 'off-palette' ? 0xff00ff : 0xe0d0a0).setOrigin(0);
    declaration = {revision,layout:scale===1?'compact':'large',scale,mutation,camera:{zoom:scene.cameras.main.zoom,scrollX:scene.cameras.main.scrollX,scrollY:scene.cameras.main.scrollY,rotation:scene.cameras.main.rotation,roundPixels:scene.cameras.main.roundPixels},region,palette:[[32,48,64,255],[224,208,160,255]],grid:{size:2*scale,originX:region.x,originY:region.y}};
    game.step(performance.now(), 0);
  }
  function capture() {
    if (disposed || !declaration) throw new Error('an active layout is required');
    // Canvas keeps its drawing buffer; readback and PNG describe the same completed native step.
    const rgba = Array.from(game.canvas.getContext('2d').getImageData(0,0,160,120).data);
    const text = registrations.map(({id,object,allocation}) => {
      const native = object.getTextBounds(), bounds = rect(object.getBounds());
      const required = [...object.text].map(character => ({character,code:character.charCodeAt(0)}));
      const missing = required.filter(glyph => !Object.hasOwn(object.fontData.chars, glyph.code));
      return {id,type:object.type,registered:scene.sys.displayList.exists(object),font:object.font,fontSize:object.fontSize,text:object.text,scale:{x:object.scaleX,y:object.scaleY},allocation:{...allocation},bounds,requiredGlyphs:required,missingGlyphs:missing,nativeCharacters:native.characters.map(c => ({char:c.char,code:c.code,x:c.x,y:c.y,w:c.w,h:c.h})),wrappedText:native.wrappedText, fits:bounds.x>=allocation.x && bounds.y>=allocation.y && bounds.x+bounds.width<=allocation.x+allocation.width && bounds.y+bounds.height<=allocation.y+allocation.height};
    });
    return {version:Phaser.VERSION,renderer:game.renderer.constructor.name,width:160,height:120,pixelSpace:'Canvas getImageData RGBA after completed native game.step',normalization:'none; measured region is opaque',declaration:structuredClone(declaration),text,rgba,png:game.canvas.toDataURL('image/png'),font:{key:'evidence-font',texture:'evidence-font-strip',characters:chars,glyphCodes:Object.keys(scene.cache.bitmapFont.get('evidence-font').data.chars).map(Number)}};
  }
  function dispose() {
    if (!disposed) { disposed = true; game.destroy(true); game.runDestroy(); }
    return {disposed,canvasRemoved:!game.canvas?.isConnected,rendererCanvasReleased:game.renderer.gameCanvas===null,rendererContextReleased:game.renderer.gameContext===null,sceneCount:game.scene.scenes.length};
  }
  return {layout,capture,dispose,sources};
}
