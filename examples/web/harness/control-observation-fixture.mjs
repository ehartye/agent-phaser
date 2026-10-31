import {createControlObserver} from './control-observation.mjs';
let ownerSequence=0;

// Every observation reads the objects registered by these constructors. No parallel layout model.
export async function createControlObservationFixture({Phaser=globalThis.Phaser,parent=document.body,layout='wide'}={}){
  if(Phaser.VERSION!=='4.2.1')throw new Error('Fixture requires phaser@4.2.1');
  if(!['wide','stacked'].includes(layout))throw new Error('Unknown fixture layout');
  const owner=`fixture-${layout}-${++ownerSequence}`,observer=createControlObserver({owner}),records=new Map(),events=[];
  let game,scene,rowScene,rendererIdentity,ready=false,disposed=false,serial=0,pending=null;
  const root=document.createElement('div');root.style.cssText='position:relative;width:460px;height:360px';parent.append(root);
  const cover=document.createElement('div');cover.style.cssText='position:absolute;display:none;background:#e64848;z-index:5;pointer-events:auto';root.append(cover);
  const recordEvent=(type,id,receiver,value=null)=>{events.push({type,id,receiver,value,revision:observer.revision,sequence:++serial});if(events.length>128)events.shift();};
  const cancel=()=>{if(pending){recordEvent('cancel',pending.id,pending.receiver);pending=null;}};
  const revise=()=>{cancel();return observer.revise();};
  const cssRect=(native,camera)=>{
    const b=native.getBounds(),c=game.canvas.getBoundingClientRect(),sx=c.width/game.scale.width,sy=c.height/game.scale.height;
    return {x:c.x+(camera.x+(b.x-camera.scrollX)*camera.zoom)*sx,y:c.y+(camera.y+(b.y-camera.scrollY)*camera.zoom)*sy,width:b.width*camera.zoom*sx,height:b.height*camera.zoom*sy};
  };
  const viewport=camera=>{const c=game.canvas.getBoundingClientRect();return {x:c.x+camera.x*c.width/game.scale.width,y:c.y+camera.y*c.height/game.scale.height,width:camera.width*c.width/game.scale.width,height:camera.height*c.height/game.scale.height};};
  const nativeId=target=>target.name;
  function bind(native,id,callback){
    native.on('pointerdown',()=>{if(records.get(id)?.enabled!==false)pending={id,receiver:nativeId(native)};});
    native.on('pointerup',()=>{
      const record=records.get(id);if(!pending || pending.id!==id)return;
      const press=pending;pending=null;
      if(record?.enabled!==false){recordEvent('activate',id,nativeId(native));callback?.();}
      if(press.receiver!==nativeId(native))recordEvent('receiver-changed',id,nativeId(native));
    });
  }
  function register(id,native,camera,{receiver='phaser-pointer',role='button',density=1}={}){
    const state={native,camera,receiver,role,density,enabled:true,published:true,supported:true,occlusionKnown:true};records.set(id,state);
    const receiverId=native instanceof HTMLElement?native.id:native.name;
    observer.register(id,{role,label:id,receiver,receiverId,read:()=>{
      const bounds=native instanceof HTMLElement?(()=>{const b=native.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};})():cssRect(native,camera);
      const clip=native instanceof HTMLElement?(()=>{const b=root.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};})():viewport(camera);
      const top=document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
      return {bounds,clip,allocation:bounds,ready:ready&&!disposed,published:state.published,enabled:state.enabled,supported:state.supported,occluded:state.occlusionKnown?top!==game.canvas && top!==native:null,sourcePixelPhysicalSize:state.density*(native.scaleX??1)*devicePixelRatio};
    }});return state;
  }
  class Controls extends Phaser.Scene{
    create(){
      scene=this;const x=layout==='wide'?240:24;
      const button=(id,bx,by,w=140,h=32,options={})=>{
        const native=this.add.rectangle(bx,by,w,h,0x376b88).setOrigin(0).setName(`native:${id}`).setInteractive();
        register(id,native,this.cameras.main,options);bind(native,id,id==='disclosure'?()=>{root.dataset.expanded=root.dataset.expanded==='true'?'false':'true';}:id==='pager'?()=>{root.dataset.page=String(Number(root.dataset.page||0)+1);}:undefined);return native;
      };
      button('chrome',20,12,160,32);button('disclosure',x,layout==='wide'?60:190);button('pager',x,layout==='wide'?120:236,140,32,{receiver:'phaser-local-pager'});
      const art=this.textures.createCanvas('density-grid',32,12),ctx=art.getContext();ctx.fillStyle='#346699';ctx.fillRect(0,0,32,12);ctx.fillStyle='#9ddbaa';ctx.fillRect(1,1,1,1);art.refresh();
      const density=this.add.image(240,layout==='wide'?240:290,'density-grid').setOrigin(0).setScale(3).setName('native:density').setInteractive();register('density',density,this.cameras.main);bind(density,'density');
      const field=document.createElement('input');field.id='native:field';field.setAttribute('aria-label','field');field.style.cssText=`position:absolute;left:${x}px;top:${layout==='wide'?175:280}px;width:130px;height:26px;z-index:2;box-sizing:border-box`;root.append(field);
      for(const name of ['mousedown','mouseup','touchstart','touchend'])field.addEventListener(name,event=>event.stopPropagation());
      field.addEventListener('input',event=>recordEvent('change','field',event.target.id,event.target.value));register('field',field,null,{receiver:'dom-field',role:'textbox'});
      this.input.on('pointerup',pointer=>{if(pointer.wasCanceled)cancel();});this.input.on('gameout',cancel);
      this.scene.launch('Rows');
    }
  }
  class Rows extends Phaser.Scene{
    constructor(){super('Rows');}
    create(){rowScene=this;this.cameras.main.setViewport(20,70,190,90);const native=this.add.rectangle(10,15,150,32,0x9b6644).setOrigin(0).setName('native:row').setInteractive();register('row',native,this.cameras.main);bind(native,'row');ready=true;}
  }
  game=new Phaser.Game({type:Phaser.CANVAS,parent:root,width:460,height:360,audio:{noAudio:true},scene:[Controls,Rows],banner:false});
  await new Promise((resolve,reject)=>{const start=performance.now();const poll=()=>{if(ready)resolve();else if(performance.now()-start>10000)reject(new Error('Fixture boot timed out'));else setTimeout(poll,10);};poll();});
  rendererIdentity=game.renderer.constructor.name;
  root.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
  const api={
    observe:(id,expected)=>observer.observe(id,expected),
    snapshot:()=>({owner,revision:observer.revision,layout,ready:ready&&!disposed,disposed,renderer:rendererIdentity,events:events.map(event=>({...event})),page:Number(root.dataset.page||0),expanded:root.dataset.expanded==='true',controls:[...records.keys()].map(id=>observer.observe(id))}),
    revise,
    scroll(y){revise();rowScene.cameras.main.setScroll(0,y);},
    resize(width=520,height=390){revise();root.style.width=`${width}px`;root.style.height=`${height}px`;game.scale.resize(width,height);const n=records.get('density').native;n.setPosition(width-120,height-70);game.scale.updateBounds();},
    setEnabled(id,value){revise();const r=records.get(id);r.enabled=value;if(r.native instanceof HTMLElement)r.native.disabled=!value;else r.native.input.enabled=value;},
    setPublished(id,value){revise();records.get(id).published=value;},
    setUnsupported(id,value=true){revise();records.get(id).supported=!value;},
    setOcclusionKnown(id,value){revise();records.get(id).occlusionKnown=value;},
    setOccluded(id,value){revise();cover.style.display=value?'block':'none';if(value){const b=observer.observe(id).bounds,r=root.getBoundingClientRect();Object.assign(cover.style,{left:`${b.x-r.x}px`,top:`${b.y-r.y}px`,width:`${b.width}px`,height:`${b.height}px`});}},
    async mutateReceiver(id){
      const r=records.get(id);if(r.native instanceof HTMLElement){r.native.id='replacement:'+id;return;}
      const b=r.native.getBounds();
      // Retire the actual old receiver, leaving its published descriptor deliberately stale.
      r.native.disableInteractive();
      const replacement=r.native.scene.add.rectangle(b.x,b.y,b.width,b.height,0xbb3355).setOrigin(0).setName('replacement:'+id).setDepth(100).setInteractive();bind(replacement,id);
      // Input registration and display sorting are processed by the next native frame.
      await new Promise(resolve=>game.events.once(Phaser.Core.Events.POST_RENDER,resolve));
    },
    dispose(){if(disposed)return;cancel();disposed=true;ready=false;observer.dispose();window.removeEventListener('blur',cancel);root.removeEventListener('pointercancel',cancel);game.destroy(true);root.remove();recordEvent('dispose',owner,owner);}
  };return api;
}
