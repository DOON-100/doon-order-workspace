// Actual PDF.js canvas rendering with synthetic documents; browser visibility is verified separately.
import assert from 'node:assert/strict';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
globalThis.pdfjsWorker=await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
function syntheticPdf(){
 const stream='0 0 0 RG 4 w 20 20 160 100 re S\n20 20 m 180 120 l S\n';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << >> /Contents 6 0 R >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];
 let pdf='%PDF-1.7\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Uint8Array.from(Buffer.from(pdf));
}
const loading=getDocument({data:syntheticPdf(),useSystemFonts:true,useWorkerFetch:false,useWasm:false});
try{
 const pdf=await loading.promise;assert.equal(pdf.numPages,2);
 for(const number of [1,2]){const page=await pdf.getPage(number),viewport=page.getViewport({scale:number}),canvas=createCanvas(viewport.width,viewport.height);await page.render({canvas,viewport,background:'#fff'}).promise;const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<100&&pixels[i+1]<100&&pixels[i+2]<100)ink++;assert(ink>1000,'The synthetic vector drawing must produce visible pixels.');}
 const page=await pdf.getPage(1),viewport=page.getViewport({scale:2}),canvas=createCanvas(viewport.width,viewport.height),render=page.render({canvas,viewport});render.cancel();await assert.rejects(render.promise,/cancel/i);
}finally{await loading.destroy();}
assert.equal(loading.destroyed,true);
const invalid=getDocument({data:Uint8Array.from(Buffer.from('not a valid PDF'))});try{await assert.rejects(invalid.promise);}finally{await invalid.destroy();}
await fs.mkdir('test-output',{recursive:true});
const bundled=await build({entryPoints:['app/pdf-original-preview.tsx'],bundle:true,platform:'browser',format:'esm',write:false,loader:{'.css':'empty'}});assert(bundled.outputFiles[0].text.includes('WorkerMessageHandler'));
console.log('PASS synthetic two-page PDFs render visible canvas pixels at both scales; cancellation, disposal, invalid-file rejection and browser bundling pass');
