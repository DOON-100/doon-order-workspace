import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DeliveryWriteService} from '../dist/delivery-write.js';
import {store,session,temporary} from './helpers.mjs';

test('service CLI preserves omitted and blank fields instead of manufacturing zero',async()=>{
 for(const kind of ['followup','shipment','receivable']){
  const state=await store();await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
  let saved,posted;
  const transport=async(url,init)=>{
   if(init.method==='POST'){
    posted=JSON.parse(init.body);
    saved={...posted,id:'synthetic-optional',version:1,title:'Synthetic generated title',status:'open',details:kind==='receivable'?{invoiceNo:'',currency:'USD',amount:'',terms:''}:{},...(kind==='receivable'?{receivedCents:0,balanceCents:null}:{})};
    return Response.json({ok:true,record:saved});
   }
   return Response.json({records:saved?[saved]:[],attachments:[],orders:[],writeContract:'service-save-version-token-v1',saveToken:true,sourceOrderVersion:true});
  };
  const service=new DeliveryWriteService(state,transport,kind),file=path.join(await temporary(),'input.json');
  await fs.writeFile(file,JSON.stringify({customerId:'synthetic-customer'}));
  const result=await service.save(file,'0',randomUUID());assert.equal(posted.title,undefined);assert.deepEqual(posted.details,{});
  assert.equal(result.record.title,'Synthetic generated title');
  if(kind==='receivable'){assert.equal(result.record.balanceCents,null);assert(!Object.hasOwn(result.record.details,'amountCents'));}
  assert.equal(service.schema().fields.title.required,undefined);
 }
});
