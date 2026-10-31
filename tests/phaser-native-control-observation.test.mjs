import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createControlObserver} from '../examples/web/harness/control-observation.mjs';
const bounds={x:10.25,y:12.5,width:20,height:10},clip={x:0,y:0,width:100,height:100};
function fixture(receiver='phaser-pointer'){
  const observer=createControlObserver({owner:'owner-token'}),facts={bounds,clip,allocation:bounds,published:true,ready:true,enabled:true,occluded:false,sourcePixelPhysicalSize:3};
  const unregister=observer.register('control',{role:'button',label:'Next',receiver,receiverId:'native-token',read:()=>({...facts,privateGraph:{callback(){}}})});
  return {observer,facts,unregister};
}
test('public descriptors serialize only plain facts, preserving continuous geometry and independent density',()=>{
  const {observer}=fixture(),descriptor=observer.observe('control');assert.equal(descriptor.eligible,true);assert.deepEqual(JSON.parse(JSON.stringify(descriptor)),descriptor);assert.equal(descriptor.bounds.x,10.25);assert.equal(descriptor.sourcePixelPhysicalSize,3);assert.equal('privateGraph' in descriptor,false);descriptor.bounds.x=99;assert.equal(observer.observe('control').bounds.x,10.25);
});
test('publication, supported mappings and eligibility refusals remain distinct',()=>{
  const {observer,facts}=fixture();assert.equal(observer.observe('missing').reason,'absent');
  for(const [key,value,reason] of [['published',false,'unpublished'],['ready',false,'not-ready'],['enabled',false,'disabled'],['occluded',true,'occluded'],['occluded',null,'unsupported'],['supported',false,'unsupported'],['clip',{x:0,y:0,width:15,height:15},'clipped']]){
    const previous=facts[key];facts[key]=value;const result=observer.observe('control');assert.equal(result.eligible,false);assert.equal(result.reason,reason);facts[key]=previous;
  }
  assert.equal(fixture('unknown-receiver').observer.observe('control').reason,'unsupported');
});
test('revision changes, unregister and disposal retire earlier observations',()=>{
  const {observer,unregister}=fixture(),before=observer.observe('control');observer.revise();assert.equal(observer.observe('control',before).reason,'stale-revision');assert.equal(observer.observe('control',{owner:'retired'}).reason,'stale-owner');unregister();assert.equal(observer.observe('control').reason,'absent');observer.dispose();observer.dispose();assert.equal(observer.observe('control').reason,'stale-owner');assert.throws(()=>observer.register('new',{read(){}}),/Invalid/);
});
