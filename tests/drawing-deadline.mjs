import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['lib/drawing-deadline.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {drawingDeadline}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
for(const [type,requestedDate,expected] of [
 ['新款画图','2026-11-10','2026-11-18'],
 ['改图','2026-11-10','2026-11-13'],
 ['印字资料','2026-11-12','2026-11-16'],
 ['配件图','2026-11-14','2026-11-18'],
 ['3D图','2026-11-15','2026-11-18'],
 ['新款画图','2026-12-31','2027-01-08'],
 ['改图','2028-02-28','2028-03-02'],
 ['新款画图','2026-09-30','2026-10-08'],
 ['','2026-11-10','2026-11-13'],
])assert.equal(drawingDeadline(type,requestedDate),expected,`${type} ${requestedDate}`);
for(const requestedDate of ['invalid','2026-11-10T04:00:00Z','2026-02-30',''])assert.throws(()=>drawingDeadline('新款画图',requestedDate),requestedDate);
console.log('PASS drawing deadlines: day after the written request date, Monday–Saturday, 7/3 days, Sunday skip, year/leap boundaries and holidays counted');
