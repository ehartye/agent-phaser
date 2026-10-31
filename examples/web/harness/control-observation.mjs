// Example convention, not a shared game runtime. Native references stay inside read callbacks.
const receivers=new Set(['phaser-pointer','dom-field','phaser-local-pager']);
function rect(value){
  if(!value || !['x','y','width','height'].every(key=>Number.isFinite(value[key])) || value.width<=0 || value.height<=0)return null;
  return Object.fromEntries(['x','y','width','height'].map(key=>[key,value[key]]));
}
export function createControlObserver({owner}){
  if(typeof owner!=='string' || !owner)throw new TypeError('owner must be an opaque string');
  const registrations=new Map();let generation=1,disposed=false;
  const revision=()=>`${owner}:${generation}`;
  return {
    get revision(){return revision();},
    register(id,{role,label,receiver,receiverId,read}){
      if(disposed || registrations.has(id) || typeof id!=='string' || typeof read!=='function')throw new Error('Invalid control registration');
      for(const value of [role,label,receiver,receiverId])if(typeof value!=='string')throw new TypeError('Control metadata must be strings');
      const record={role,label,receiver,receiverId,read};registrations.set(id,record);generation++;
      return ()=>{if(registrations.get(id)===record){registrations.delete(id);generation++;}};
    },
    revise(){generation++;return revision();},
    observe(id,expected={}){
      const base={id:String(id),owner,revision:revision(),eligible:false};
      if(disposed || expected.owner!==undefined && expected.owner!==owner)return {...base,reason:'stale-owner'};
      if(expected.revision!==undefined && expected.revision!==revision())return {...base,reason:'stale-revision'};
      const record=registrations.get(id);if(!record)return {...base,reason:'absent'};
      const facts=record.read(),bounds=rect(facts.bounds),clip=rect(facts.clip),allocation=rect(facts.allocation);
      const out={...base,role:record.role,label:record.label,receiver:record.receiver,receiverId:record.receiverId,ready:facts.ready===true,enabled:facts.enabled===true,bounds,clip,allocation,sourcePixelPhysicalSize:Number.isFinite(facts.sourcePixelPhysicalSize)?facts.sourcePixelPhysicalSize:null};
      if(facts.published!==true)return {...out,reason:'unpublished'};
      if(!out.ready)return {...out,reason:'not-ready'};
      if(!out.enabled)return {...out,reason:'disabled'};
      if(!receivers.has(record.receiver) || !bounds || !clip || facts.occluded!==true && facts.occluded!==false || facts.supported===false)return {...out,reason:'unsupported'};
      if(bounds.x<clip.x || bounds.y<clip.y || bounds.x+bounds.width>clip.x+clip.width || bounds.y+bounds.height>clip.y+clip.height)return {...out,reason:'clipped'};
      if(facts.occluded)return {...out,reason:'occluded'};
      return {...out,eligible:true,reason:'eligible'};
    },
    dispose(){if(!disposed){disposed=true;registrations.clear();generation++;}}
  };
}
