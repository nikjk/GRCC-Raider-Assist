import http from 'node:http';import {resolveIdentity} from './identity.mjs';import {TeamDynamix} from './tdx.mjs';
const env=process.env;
const mode=env.RAIDER_MODE||'demo';
const production=mode==='production';
const sandboxTest=mode==='sandbox-test';
const locationReadEnabled=production||sandboxTest||mode==='sandbox-readonly';
if(!['demo','sandbox-readonly','sandbox-test','production'].includes(mode))throw Error('RAIDER_MODE must be demo, sandbox-readonly, or production');
if(sandboxTest){
 if(!/^https:\/\/supportdesk\.grcc\.edu\/SBTDWebAPI\/?$/i.test(env.TDX_BASE_URL||''))throw Error('Sandbox test requires GRCC SBTDWebAPI URL');
 if(env.RAIDER_SANDBOX_WRITE_ENABLED!=='YES')throw Error('Explicit sandbox write opt-in required');
 if(!/^[0-9a-f-]{36}$/i.test(env.RAIDER_SANDBOX_FALLBACK_REQUESTOR_UID||env.RAIDER_SANDBOX_TEST_REQUESTOR_UID||''))throw Error('Valid Sandbox fallback requestor UID required');
 if(!env.RAIDER_SANDBOX_TEST_TOKEN||env.RAIDER_SANDBOX_TEST_TOKEN.length<32)throw Error('RAIDER_SANDBOX_TEST_TOKEN must contain at least 32 characters');
}
if(production){if(env.IDENTITY_INTEGRATION!=='trusted-proxy'||env.TRUSTED_PROXY_ENABLED!=='true')throw Error('Trusted gateway is required in production');if(env.RAIDER_BIND_HOST&&env.RAIDER_BIND_HOST!=='127.0.0.1')throw Error('Production listener must bind to loopback only');}
// Sandbox read-only mode deliberately uses TDX credentials ONLY for locations/rooms.
// Tickets remain in demo validation mode until the trusted identity gateway is ready.
const tdx=locationReadEnabled?new TeamDynamix(env):null;
function reply(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}
function valid(x){return x&&typeof x==='object'&&!Array.isArray(x)&&['computer','monitor','dock','keyboard','mouse','other'].includes(x.kind)&&typeof x.requestorUsername==='string'&&x.requestorUsername.length<=80&&/^[a-zA-Z0-9._-]*$/.test(x.requestorUsername)&&['staff','student'].includes(x.requestorType)&&typeof x.title==='string'&&x.title.trim().length>=3&&x.title.length<=160&&typeof x.description==='string'&&x.description.trim().length>=5&&x.description.length<=4000&&(x.locationId===null||(Number.isSafeInteger(x.locationId)&&x.locationId>0))&&(x.roomId===null||(Number.isSafeInteger(x.roomId)&&x.roomId>0))&&(x.roomId===null||x.locationId!==null)&&typeof x.peripheralSerial==='string'&&x.peripheralSerial.length<=120&&typeof x.includeDiagnostics==='boolean'&&x.device&&typeof x.device==='object'&&typeof x.device.hostname==='string'&&x.device.hostname.length<=255&&(!x.device.serial||typeof x.device.serial==='string'&&x.device.serial.length<=120);}
const server=http.createServer(async(req,res)=>{try{
 if(req.url==='/health'&&req.method==='GET')return reply(res,200,{mode,identityStatus:production?'trusted gateway required':sandboxTest?'fixed sandbox test requestor':'not authenticated',locationsSource:locationReadEnabled?'teamdynamix':'none',ticketSubmissionEnabled:production||sandboxTest});
 if(req.method==='GET'&&req.url==='/api/locations'){
  if(!locationReadEnabled)return reply(res,200,[]);
  if(production&&!resolveIdentity(req,env))return reply(res,401,{error:'Managed-device identity not verified'});
  return reply(res,200,await tdx.getLocations());
 }
 const roomsMatch=req.method==='GET'&&/^\/api\/locations\/([1-9]\d*)\/rooms$/.exec(req.url||'');
 if(roomsMatch){if(!locationReadEnabled)return reply(res,200,[]);if(production&&!resolveIdentity(req,env))return reply(res,401,{error:'Managed-device identity not verified'});return reply(res,200,await tdx.getRooms(Number(roomsMatch[1])));}
 if(req.url!=='/api/tickets'||req.method!=='POST')return reply(res,404,{error:'Not found'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(res,415,{error:'JSON required'});
 const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>30000)return reply(res,413,{error:'Request too large'});chunks.push(chunk)}
 let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reply(res,400,{error:'Invalid JSON'})}
 if(!valid(data))return reply(res,400,{error:'Complete the required form fields and try again'});
 if(!production&&!sandboxTest)return reply(res,200,{demo:true,message:'Request validated locally. No ticket was created.'});
 if(sandboxTest){
  const {timingSafeEqual}=await import('node:crypto');
  const provided=String(req.headers['x-raider-sandbox-test-token']||'');
  const expected=env.RAIDER_SANDBOX_TEST_TOKEN;
  const a=Buffer.from(provided),b=Buffer.from(expected);
  if(a.length!==b.length||!timingSafeEqual(a,b))return reply(res,403,{error:'Sandbox test authorization required'});
  if(req.headers['x-raider-confirm-sandbox-write']!=='create-test-ticket')return reply(res,400,{error:'Explicit test ticket confirmation required'});
  const suffix=data.requestorType==='student'?'@email.grcc.edu':'@grcc.edu';
  const entered=data.requestorUsername.trim();
  const email=entered?`${entered.toLowerCase()}${suffix}`:'(no username entered)';
  const fallback=env.RAIDER_SANDBOX_FALLBACK_REQUESTOR_UID||env.RAIDER_SANDBOX_TEST_REQUESTOR_UID;
  let uid=fallback;let resolution='fallback';let reason='No username entered';
  if(entered){try{
   const result=await tdx.resolveRequestor(entered,data.requestorType);
   if(result.uid){uid=result.uid;resolution='matched';reason='Exact primary email match';}
   else reason=result.reason;
  }catch(err){console.warn('Raider Assist requestor lookup failed:',String(err?.message||err));reason='Lookup unavailable';}}
  const note=`--- Requestor information (unverified, entered on desktop) ---\nEntered account: ${email}\nAccount type: ${data.requestorType}\nTDX requestor resolution: ${resolution} (${reason})${resolution==='fallback'?'\nFallback account used; IT should verify the actual requestor.':''}`;
  const output=await tdx.createTicket(data,{tdxUid:uid,requestorNote:note,requestorResolution:resolution});return reply(res,201,output);
 }
 const identity=resolveIdentity(req,env);if(!identity)return reply(res,401,{error:'Your managed device identity was not verified. Please contact IT.'});
 const output=await tdx.createTicket(data,identity);return reply(res,201,output);
 }catch(err){console.error('Raider Assist backend error:',String(err?.message||err));return reply(res,502,{error:'Unable to complete this request. Contact IT if it persists.'})}});
const host=env.RAIDER_BIND_HOST||'127.0.0.1';
if((mode==='sandbox-readonly'||sandboxTest)&&host!=='127.0.0.1')throw Error('Sandbox read-only mode must bind to 127.0.0.1');server.listen(Number(env.PORT||8789),host,()=>console.log(`Raider Assist ${mode} backend at http://${host}:${env.PORT||8789}`));
