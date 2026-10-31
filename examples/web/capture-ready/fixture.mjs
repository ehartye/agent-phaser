import {installDebug} from '/debug.mjs';
// Deliberately bounded: no attract loop, asynchronous art, tweens or second clock owner.
const model={ready:false,gate:true,running:false,ticks:0,actions:[],seedChoice:null};
const params=new URLSearchParams(location.search), mode=params.get('mode')||'external';
const start=document.querySelector('#start'),cue=document.querySelector('#cue');
let scene,block,game;
window.__vidsAudio=[];
function action(id,event){
  model.actions.push({id,owner:'capture-model',trusted:event.isTrusted,time:performance.now(),gateBefore:model.gate});
  if(id==='start'){model.running=true;model.gate=false;model.ticks=0;model.seedChoice=Math.floor(Math.random()*4);block.y=80+model.seedChoice*10;block.setFillStyle(params.get('variant')==='1'?0xff00ff:0xffcc00);}
  else window.__vidsAudio.push({t:performance.now(),url:params.get('missing')==='1'?'/missing.wav':'/cue.wav',gain:0.5,pan:0,rate:1});
}
start.addEventListener('click',event=>action('start',event));cue.addEventListener('click',event=>action('cue',event));
game=new Phaser.Game({type:Phaser.CANVAS,width:384,height:216,pixelArt:true,banner:false,audio:{noAudio:true},backgroundColor:'#102030',scene:{create(){scene=this;block=this.add.rectangle(24,90,8,8,0xffcc00).setOrigin(0);this.add.rectangle(8,8,1,1,0xffffff).setOrigin(0);this.ready=true;model.ready=true;if(localStorage.getItem('capture-skip-title')==='1')model.gate=false;},update(){if(!model.running)return;model.ticks++;block.x=24+Math.floor(model.ticks/6)%300;}}});
window.__game=game;
const debug=installDebug(game);
window.captureFixture={
  snapshot(){return {...model,actions:model.actions.map(x=>({...x})),audio:window.__vidsAudio.map(x=>({...x})),mode,clock:performance.now(),browser:navigator.userAgent,renderer:game.renderer.constructor.name,version:Phaser.VERSION,canvas:{width:game.canvas.width,height:game.canvas.height,css:JSON.parse(JSON.stringify(game.canvas.getBoundingClientRect())),dpr:devicePixelRatio},loopRunning:game.loop.running};},
  configure(){if(mode!=='external')debug.manual(true);},
  handFrames(){debug.frames(60);},
  async receipt(label){await fetch('/receipt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label,...this.snapshot()})});},
  dispose(){game.destroy(true);game.runDestroy();return {canvasRemoved:!document.querySelector('canvas'),rendererReleased:game.renderer.gameCanvas===null&&game.renderer.gameContext===null};}
};
