import http from 'node:http';import {resolveIdentity} from './identity.mjs';import {TeamDynamix} from './tdx.mjs';
const env=process.env;const production=env.RAIDER_MODE==='production';if(!['demo','production'].includes(env.RAIDER_MODE||'demo'))throw Error('RAIDER_MODE must be demo or production');
if(production){if(env.IDENTITY_INTEGRATION!=='trusted-proxy'||env.TRUSTED_PROXY_ENABLED!=='true')throw Error('Trusted gateway is required in production');if(env.RAIDER_BIND_HOST&&env.RAIDER_BIND_HOST!=='127.0.0.1')throw Error('Production listener must bind to loopback only');}
const tdx=production?new TeamDynamix(env):null;
function reply(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}
function valid(x){return x&&typeof x==='object'&&!Array.isArray(x)&&['computer','monitor','dock','keyboard','mouse','other'].includes(x.kind)&&typeof x.title==='string'&&x.title.trim().length>=3&&x.title.length<=160&&typeof x.description==='string'&&x.description.trim().length>=5&&x.description.length<=4000&&typeof x.location==='string'&&x.location.length<=120&&typeof x.peripheralSerial==='string'&&x.peripheralSerial.length<=120&&typeof x.includeDiagnostics==='boolean'&&x.device&&typeof x.device==='object'&&typeof x.device.hostname==='string'&&x.device.hostname.length<=255&&(!x.device.serial||typeof x.device.serial==='string'&&x.device.serial.length<=120);}
const server=http.createServer(async(req,res)=>{try{
 if(req.url==='/health'&&req.method==='GET')return reply(res,200,{mode:production?'production':'demo',identityStatus:production?'trusted gateway required':'not authenticated'});
 if(req.url!=='/api/tickets'||req.method!=='POST')return reply(res,404,{error:'Not found'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(res,415,{error:'JSON required'});
 const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>30000)return reply(res,413,{error:'Request too large'});chunks.push(chunk)}
 let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reply(res,400,{error:'Invalid JSON'})}
 if(!valid(data))return reply(res,400,{error:'Complete the required form fields and try again'});
 if(!production)return reply(res,200,{demo:true,message:'Request validated locally. No ticket was created.'});
 const identity=resolveIdentity(req,env);if(!identity)return reply(res,401,{error:'Your managed device identity was not verified. Please contact IT.'});
 const output=await tdx.createTicket(data,identity);return reply(res,201,output);
 }catch(err){console.error('Raider Assist backend error:',String(err?.message||err));return reply(res,502,{error:'Unable to complete this request. Contact IT if it persists.'})}});
const host=env.RAIDER_BIND_HOST||'127.0.0.1';server.listen(Number(env.PORT||8789),host,()=>console.log(`Raider Assist ${production?'production':'demo'} backend at http://${host}:${env.PORT||8789}`));
