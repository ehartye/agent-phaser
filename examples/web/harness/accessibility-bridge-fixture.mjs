import {createAccessibilityBridge} from './accessibility-bridge.mjs';
let generation=0;
export async function createAccessibilityBridgeFixture(){
  const owner=`bridge-${++generation}`,receipts=[],nativeEvents=[],listeners=[],elements=new Map(),views=new Map();let game,scene,disposed=false,duplicate=false;
  const controls=[{id:'toggle',label:'Music',role:'button'},{id:'disabled',label:'Unavailable',role:'button',enabled:false},{id:'open',label:'Open settings',role:'button'},{id:'name',label:'Player name',role:'textbox'},{id:'apply',label:'Apply settings',role:'button',group:'modal'},{id:'close',label:'Close settings',role:'button',group:'modal'}];
  const root=document.createElement('section');root.dataset.bridge=owner;
  const style=document.createElement('style');style.textContent='.bridge-concealed{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}';root.append(style);
  const background=document.createElement('div'),dialog=document.createElement('div');background.className=dialog.className='bridge-concealed';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Settings');dialog.setAttribute('aria-modal','true');dialog.hidden=true;root.append(background,dialog);document.body.append(root);
  const listen=(target,type,callback)=>{target.addEventListener(type,callback);listeners.push(()=>target.removeEventListener(type,callback));};
  const bridge=createAccessibilityBridge({owner,controls,onAction(event){
    receipts.push({...event,handlerOwner:owner});
    if(event.id==='toggle')bridge.set('toggle',{selected:!bridge.snapshot().controls.find(c=>c.id==='toggle').selected});
    if(event.id==='open'){bridge.modal(true);elements.get('apply').focus();}
    if(event.id==='close'){bridge.modal(false);elements.get('open').focus();}
  }});
  for(const c of controls){
    const element=document.createElement(c.role==='textbox'?'input':'button');element.id=owner+'-'+c.id;element.dataset.control=c.id;
    if(c.role==='textbox'){element.type='text';element.setAttribute('aria-label',c.label);}else{element.type='button';element.textContent=c.label;}
    (c.group==='modal'?dialog:background).append(element);elements.set(c.id,element);
    listen(element,'focus',()=>bridge.focus(c.id));
    listen(element,'blur',()=>bridge.blur(c.id));
    listen(element,c.role==='textbox'?'input':'click',event=>{nativeEvents.push({id:c.id,type:event.type,trusted:event.isTrusted});bridge.dispatch(c.id,c.role==='textbox'?'field':'semantic',element.value);if(duplicate&&c.id==='toggle')bridge.dispatch(c.id,'semantic');});
  }
  listen(document,'keydown',event=>{
    if(!bridge.snapshot().modal)return;
    if(event.key==='Escape'){event.preventDefault();nativeEvents.push({id:'close',type:'keydown',trusted:event.isTrusted});bridge.dispatch('close','semantic');}
    if(event.key==='Tab'){event.preventDefault();const ids=['apply','close'],index=ids.findIndex(id=>elements.get(id)===document.activeElement);elements.get(ids[(index+(event.shiftKey?-1:1)+ids.length)%ids.length]).focus();}
  });
  // Excluded controls are negative AX examples, never substitutes for required controls.
  for(const mode of ['display-none','hidden','aria-hidden']){const b=document.createElement('button');b.textContent='Excluded '+mode;if(mode==='display-none')b.style.display='none';else if(mode==='hidden')b.hidden=true;else{b.setAttribute('aria-hidden','true');b.tabIndex=-1;b.className='bridge-concealed';}root.append(b);}
  let timer;
  try{await Promise.race([new Promise(done=>{game=new Phaser.Game({type:Phaser.CANVAS,width:400,height:320,parent:root,backgroundColor:'#182030',audio:{noAudio:true},banner:false,scene:{create(){scene=this;done();}}});}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture boot timed out')),5000);})]);}finally{clearTimeout(timer);}
  game.canvas.setAttribute('aria-hidden','true');
  for(const [index,c] of controls.entries()){
    const y=30+index*44,box=scene.add.rectangle(180,y,300,34,0x304050).setInteractive();const label=scene.add.text(38,y-10,c.label,{fontSize:'16px',color:'#ffffff'});
    box.on('pointerup',()=>{nativeEvents.push({id:c.id,type:'pointerup',trusted:null});if(c.role==='textbox'){elements.get(c.id).focus();}else if(bridge.focus(c.id)){elements.get(c.id).focus();bridge.dispatch(c.id,'canvas');}});
    views.set(c.id,{box,label});
  }
  const unsubscribe=bridge.subscribe(state=>{
    background.inert=state.modal;dialog.hidden=!state.modal;
    for(const c of state.controls){const e=elements.get(c.id),v=views.get(c.id);e.disabled=!c.enabled;if(c.role==='textbox'){if(e.value!==c.value)e.value=c.value;}else{e.textContent=c.label;if(c.id==='toggle')e.setAttribute('aria-pressed',String(c.selected));}
      if(v){v.box.setVisible((c.group==='modal')===state.modal).setStrokeStyle(2,state.focus===c.id?0xffff00:0x304050);v.label.setVisible(v.box.visible).setText(c.role==='textbox'?`${c.label}: ${c.value}`:`${c.label}${c.selected?' [on]':''}`);}
    }
  });
  const snapshot=()=>({...bridge.snapshot(),receipts:receipts.map(e=>({...e})),nativeEvents:nativeEvents.map(e=>({...e})),active:document.activeElement?.dataset.control??null,backgroundInert:background.inert,renderer:game.renderer?.constructor.name,visual:[...views].map(([id,{box,label}])=>({id,visible:box.visible,focused:box.strokeColor===0xffff00,text:label.text})),listeners:listeners.length,rootConnected:root.isConnected,canvasConnected:!!game.canvas?.isConnected});
  return {
    snapshot,
    mutate(mode){if(mode==='aria-hidden')elements.get('toggle').setAttribute('aria-hidden','true');else if(mode==='duplicate-action')duplicate=true;else throw Error('unknown mutation');},
    dispose(){if(disposed)return snapshot();disposed=true;unsubscribe();for(const remove of listeners.splice(0))remove();bridge.dispose();game.destroy(true);game.runDestroy();root.remove();return snapshot();}
  };
}
