import test from 'node:test';
import assert from 'node:assert/strict';
import {TeamDynamix} from './tdx.mjs';
const api=()=>new TeamDynamix({TDX_BASE_URL:'https://supportdesk.grcc.edu/SBTDWebAPI'});
test('staff matches exact primary email and returns UID',async()=>{
 const t=api();t.request=async(path,method,body)=>{assert.equal(path,'/api/people/search');assert.equal(method,'POST');assert.equal(body.SearchText,'jdoe@grcc.edu');return [{UID:'uid-wrong',PrimaryEmail:'jdoe2@grcc.edu'},{UID:'uid-right',PrimaryEmail:'JDOE@GRCC.EDU'}]};
 const r=await t.resolveRequestor('jdoe','staff');assert.equal(r.uid,'uid-right');
});
test('student builds @email.grcc.edu and ambiguous users are not selected',async()=>{
 const t=api();t.request=async(_path,_method,body)=>{assert.equal(body.SearchText,'abc@email.grcc.edu');return [{UID:'uid-1',PrimaryEmail:'abc@email.grcc.edu'},{UID:'uid-2',PrimaryEmail:'abc@email.grcc.edu'}]};
 const r=await t.resolveRequestor('abc','student');assert.equal(r.uid,null);assert.match(r.reason,/Multiple/);
});
test('no exact email returns fallback signal',async()=>{
 const t=api();t.request=async()=>[{UID:'uid-1',PrimaryEmail:'not@grcc.edu'}];
 const r=await t.resolveRequestor('jdoe','staff');assert.equal(r.uid,null);assert.match(r.reason,/No exact/);
});
