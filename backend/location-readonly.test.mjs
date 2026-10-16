import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const backendFile=path.join(path.dirname(fileURLToPath(import.meta.url)),'server.mjs');
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
const close=server=>new Promise(resolve=>server.close(resolve));

test('sandbox-readonly retrieves TDX location and rooms but never creates tickets',async()=>{
 let ticketCalls=0;
 const fake=http.createServer((req,res)=>{
   res.setHeader('content-type','application/json');
   if(req.url==='/api/auth/loginadmin'&&req.method==='POST')return res.end(JSON.stringify('example-token'));
   if(req.headers.authorization!=='Bearer example-token'){res.statusCode=401;return res.end('{}');}
   if(req.url==='/api/locations')return res.end(JSON.stringify([{ID:2,Name:'South Campus'},{ID:1,Name:'Main Campus'}]));
   if(req.url==='/api/locations/1')return res.end(JSON.stringify({ID:1,Name:'Main Campus',Rooms:[{ID:22,Name:'202'},{ID:21,Name:'101'}]}));
   if(req.url.includes('/tickets'))ticketCalls++;
   res.statusCode=404;res.end('{}');
 });
 let proc;
 try{
  const fakePort=await listen(fake);
  const portServer=http.createServer();const targetPort=await listen(portServer);await close(portServer);
  proc=spawn(process.execPath,[backendFile],{env:{...process.env,PORT:String(targetPort),RAIDER_MODE:'sandbox-readonly',RAIDER_BIND_HOST:'127.0.0.1',TDX_BASE_URL:`http://127.0.0.1:${fakePort}`,TDX_BEID:'test',TDX_WS_KEY:'test'},stdio:['ignore','pipe','pipe']});
  await Promise.race([once(proc.stdout,'data'),once(proc,'exit').then(()=>{throw Error('backend exited')})]);
  const base=`http://127.0.0.1:${targetPort}`;
  const status=await (await fetch(`${base}/health`)).json();assert.equal(status.mode,'sandbox-readonly');assert.equal(status.ticketSubmissionEnabled,false);
  assert.deepEqual(await (await fetch(`${base}/api/locations`)).json(),[{id:1,name:'Main Campus'},{id:2,name:'South Campus'}]);
  assert.deepEqual(await (await fetch(`${base}/api/locations/1/rooms`)).json(),[{id:21,name:'101'},{id:22,name:'202'}]);
  const result=await fetch(`${base}/api/tickets`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'computer',title:'Test ticket',description:'Testing only',locationId:1,roomId:21,peripheralSerial:'',includeDiagnostics:true,device:{hostname:'test-device',serial:'ABC123'}})});
  assert.equal(result.status,200);assert.equal((await result.json()).demo,true);assert.equal(ticketCalls,0);
 }finally{proc?.kill();await close(fake);}
});
