// Small example model/action boundary. Neither projection owns application rules.
export function createAccessibilityBridge({owner, controls, onAction}) {
  if(typeof owner!=='string'||!owner||typeof onAction!=='function'||!Array.isArray(controls))throw new TypeError('owner, controls and onAction required');
  const entries=new Map();
  for(const control of controls){
    if(!control.id||entries.has(control.id)||typeof control.label!=='string'||!['button','textbox'].includes(control.role))throw new TypeError('invalid or duplicate control');
    entries.set(control.id,{enabled:true,selected:false,value:'',group:'background',...control});
  }
  const listeners=new Set(),events=[];let disposed=false,focus=null,modal=false;
  const snapshot=()=>({owner,disposed,focus,modal,controls:[...entries.values()].map(c=>({...c})),events:events.map(e=>({...e})),subscribers:listeners.size});
  const publish=()=>{for(const listener of [...listeners])listener(snapshot());};
  const eligible=id=>{const c=entries.get(id);return !disposed&&!!c&&c.enabled&&(modal?c.group==='modal':c.group!=='modal');};
  return {
    snapshot,
    subscribe(listener){if(disposed)return ()=>{};listeners.add(listener);listener(snapshot());return ()=>listeners.delete(listener);},
    set(id,patch){if(disposed)return false;const c=entries.get(id);if(!c)throw new Error('unknown control');for(const key of Object.keys(patch))if(!['label','enabled','selected','value'].includes(key))throw new Error('unsupported state field');Object.assign(c,patch);publish();return true;},
    focus(id){if(!eligible(id))return false;focus=id;publish();return true;},
    blur(id){if(disposed||focus!==id)return false;focus=null;publish();return true;},
    modal(value){if(disposed)return false;modal=!!value;focus=null;publish();return true;},
    dispatch(id,route,value){
      if(!['canvas','semantic','field'].includes(route))throw new TypeError('unknown route');
      if(!eligible(id))return false;
      const c=entries.get(id);if(c.role==='textbox'){if(route!=='field'||typeof value!=='string')throw new TypeError('native field requires a string');c.value=value;}
      const event={sequence:events.length+1,owner,id,route,value:c.value};events.push(event);
      onAction({...event});publish();return true;
    },
    dispose(){if(disposed)return;disposed=true;focus=null;listeners.clear();}
  };
}
