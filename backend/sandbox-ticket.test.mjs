import test from 'node:test';
import assert from 'node:assert/strict';
import {TeamDynamix} from './tdx.mjs';

test('creates sandbox ticket with location and uniquely matched asset',async()=>{
 const calls=[];
 const api=new TeamDynamix({TDX_BASE_URL:'https://supportdesk.grcc.edu/SBTDWebAPI',TDX_TICKET_APP_ID:'28',TDX_ASSET_APP_ID:'40',TDX_TYPE_ID:'213',TDX_STATUS_ID:'77',TDX_PRIORITY_ID:'19',TDX_FORM_ID:'5',RAIDER_MODE:'sandbox-test'});
 api.request=async(path,method='GET',body)=>{
  calls.push({path,method,body});
  if(path==='/api/locations')return [{ID:24,Name:'SNE'}];
  if(path==='/api/locations/24')return {Rooms:[{ID:12,Name:'130'}]};
  if(path==='/api/28/tickets'&&method==='POST')return {ID:9001};
  if(path==='/api/40/assets/search')return [{ID:775,SerialNumber:'MAC-123'}];
  if(path==='/api/28/tickets/9001/assets/775')return null;
  throw Error('Unexpected mock call '+path);
 };
 const response=await api.createTicket({kind:'computer',title:'Screen flicker',description:'Screen flickers after sleep',locationId:24,roomId:12,peripheralSerial:'',includeDiagnostics:true,device:{hostname:'GRCC-MAC',serial:'MAC-123',os:'macOS',osVersion:'27',cpu:'M-series',memoryGB:16}}, {tdxUid:'11111111-1111-4111-8111-111111111111'});
 assert.equal(response.ticketId,9001);assert.equal(response.assetLinked,true);
 const ticket=calls.find(x=>x.path==='/api/28/tickets').body;
 assert.equal(ticket.LocationID,24);assert.equal(ticket.LocationRoomID,12);
 assert.equal(ticket.RequestorUid,'11111111-1111-4111-8111-111111111111');
 assert.match(ticket.Title,/RAIDER TEST/);
 assert.ok(calls.some(x=>x.path==='/api/28/tickets/9001/assets/775'));
});
test('rejects room not belonging to building before creating ticket',async()=>{
 const api=new TeamDynamix({TDX_BASE_URL:'https://supportdesk.grcc.edu/SBTDWebAPI'});
 const paths=[];api.request=async(path)=>{paths.push(path);if(path==='/api/locations')return [{ID:24,Name:'SNE'}];if(path==='/api/locations/24')return {Rooms:[{ID:12,Name:'130'}]};throw Error('Unexpected request')};
 await assert.rejects(()=>api.createTicket({kind:'computer',title:'Problem',description:'description',locationId:24,roomId:100,peripheralSerial:'',includeDiagnostics:false,device:{}},{tdxUid:'test'}),/does not belong/);
 assert.ok(!paths.includes('/api/28/tickets'));
});
