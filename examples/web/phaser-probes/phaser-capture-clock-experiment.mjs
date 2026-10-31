// Manual lane: node phaser-capture-clock-experiment.mjs <host> --vids <run-managed.js> [--output <unique-directory>]
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {setup} from '../capture-ready/probe-support.mjs';
const p=await setup(process.argv.slice(2));let failure;
try{
  p.report.cases=[];
  for(const mode of ['external','manual','manual-frames']){
    const fixture=await p.storyboard('clock-'+mode,{mode,seconds:2}),start=p.report.receipts.length;
    await p.run(mode+'-validate',['validate',fixture.file]);
    const result=await p.run(mode+'-capture',['verify-determinism',fixture.file,'--runs','2','--tolerate','0','--seed','7','--keep'],null);
    const receipts=p.report.receipts.slice(start),runs=[];
    for(let k=1;k<=2;k++)runs.push(await p.frames(join(fixture.out,'determinism','run-'+k,'scene-0')));
    const pairs=[0,1].map(i=>{const before=receipts[i*2],after=receipts[i*2+1];assert.equal(before?.label,'before');assert.equal(after?.label,'after');return {before,after,deltaTicks:after.ticks-before.ticks,deltaClock:after.clock-before.clock};});
    const row={mode,exit:result.exit,runs,pairs,distinctFrames:new Set(runs[0].map(f=>f.sha256)).size};p.report.cases.push(row);await writeFile(join(p.evidence,mode+'-frames.json'),JSON.stringify(runs,null,2));
    assert.equal(result.exit,0);assert(runs[0].length>0);assert.deepEqual(runs[0],runs[1]);assert(pairs.every(x=>x.deltaClock>=2000));
  }
  const [external,manual,hand]=p.report.cases;
  const reproduced=external.distinctFrames>1&&manual.distinctFrames===1&&hand.distinctFrames>1&&external.pairs.every(x=>x.deltaTicks>0&&x.after.loopRunning)&&manual.pairs.every(x=>x.deltaTicks===0&&!x.after.loopRunning)&&hand.pairs.every(x=>x.deltaTicks===60&&!x.after.loopRunning);
  p.report.verdict=reproduced?'validated':'invalidated';
  p.report.finding=reproduced?'The external clock advances a live Phaser loop; manual(true) sleeps that loop; only the separate explicit frames(60) call advances the sleeping loop.':'All cases were observed, but the hypothesized loop interference was not reproduced.';
  p.report.passed=true;
}catch(error){failure=error;p.report.verdict=p.report.cases?.length?'partial':'unverified';}
finally{await p.finish(failure);}
