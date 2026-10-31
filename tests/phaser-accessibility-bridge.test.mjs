import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccessibilityBridge} from '../examples/web/harness/accessibility-bridge.mjs';
const make=()=>{const receipts=[];const bridge=createAccessibilityBridge({owner:'original',controls:[{id:'toggle',role:'button',label:'Toggle'},{id:'name',role:'textbox',label:'Name'},{id:'close',role:'button',label:'Close',group:'modal'}],onAction:e=>receipts.push(e)});return {bridge,receipts};};
test('both projections invoke one original action owner and native fields update the model',()=>{
  const {bridge,receipts}=make();bridge.dispatch('toggle','canvas');bridge.dispatch('toggle','semantic');bridge.dispatch('name','field','Ada');
  assert.deepEqual(receipts.map(e=>[e.owner,e.id,e.route]),[['original','toggle','canvas'],['original','toggle','semantic'],['original','name','field']]);
  assert.equal(bridge.snapshot().controls[1].value,'Ada');
  const copy=bridge.snapshot();copy.controls[0].label='wrong';assert.equal(bridge.snapshot().controls[0].label,'Toggle');
  bridge.focus('toggle');assert.equal(bridge.blur('name'),false);assert.equal(bridge.snapshot().focus,'toggle');assert.equal(bridge.blur('toggle'),true);assert.equal(bridge.snapshot().focus,null);
});
test('disabled, modal and disposed routes refuse before the original handler',()=>{
  const {bridge,receipts}=make();bridge.set('toggle',{enabled:false});assert.equal(bridge.dispatch('toggle','canvas'),false);assert.equal(bridge.dispatch('toggle','semantic'),false);
  bridge.set('toggle',{enabled:true});assert.equal(bridge.dispatch('close','semantic'),false);bridge.modal(true);assert.equal(bridge.dispatch('toggle','canvas'),false);assert.equal(bridge.dispatch('toggle','semantic'),false);assert.equal(bridge.focus('toggle'),false);assert.equal(bridge.dispatch('close','semantic'),true);
  let notifications=0;const unsubscribe=bridge.subscribe(()=>notifications++);bridge.focus('close');assert.equal(notifications,2);unsubscribe();unsubscribe();assert.equal(bridge.snapshot().subscribers,0);
  bridge.dispose();bridge.dispose();assert.equal(bridge.dispatch('close','semantic'),false);assert.equal(bridge.set('toggle',{enabled:true}),false);assert.equal(receipts.length,1);
});
test('invalid definitions and unsupported action inputs are rejected',()=>{
  assert.throws(()=>createAccessibilityBridge({}),TypeError);const {bridge}=make();assert.throws(()=>bridge.dispatch('name','field',3),TypeError);assert.throws(()=>bridge.dispatch('toggle','fallback'),TypeError);assert.throws(()=>bridge.set('toggle',{id:'other'}));assert.equal(bridge.dispatch('absent','semantic'),false);
});
