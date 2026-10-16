const required=(e,k)=>{if(!e[k])throw Error(`Server configuration missing: ${k}`);return e[k]};
function id(e,k){const n=Number(required(e,k));if(!Number.isInteger(n)||n<=0)throw Error(`Invalid numeric server configuration: ${k}`);return n}
export class TeamDynamix {
 constructor(env=process.env){this.env=env;this.base=required(env,'TDX_BASE_URL').replace(/\/$/,'');this.ticketApp=id(env,'TDX_TICKET_APP_ID');this.assetApp=id(env,'TDX_ASSET_APP_ID');this.token='';this.exp=0;}
 async auth(){if(this.token&&Date.now()<this.exp)return this.token;
  const res=await fetch(`${this.base}/api/auth/loginadmin`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({BEID:required(this.env,'TDX_BEID'),WebServicesKey:required(this.env,'TDX_WS_KEY')}),signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw Error(`TeamDynamix authentication failed (${res.status})`);
  this.token=(await res.text()).replace(/^"|"$/g,'').trim();this.exp=Date.now()+20*60*1000;return this.token;}
 async request(path,method='GET',body){const token=await this.auth();const res=await fetch(`${this.base}${path}`,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const content=await res.text();if(!res.ok){if(res.status===401){this.token='';this.exp=0;}throw Error(`TeamDynamix ${method} ${path} failed (${res.status}): ${content.slice(0,220)}`)}if(!content)return null;try{return JSON.parse(content)}catch{return content}}
 async findAsset(serial){if(!serial)return null;
  // Results MUST be verified against the exact serial to prevent accidental asset linking.
  const candidates=await this.request(`/api/${this.assetApp}/assets/search`,'POST',{SerialNumber:serial,MaxResults:25});
  const list=Array.isArray(candidates)?candidates:[];const normalized=serial.trim().toLowerCase();const exact=list.filter(x=>String(x.SerialNumber||'').trim().toLowerCase()===normalized);
  return exact.length===1?exact[0]:null;}
 async createTicket(payload,identity){const e=this.env;const description=[payload.description,`Reported device type: ${payload.kind}`,payload.location?`Location: ${payload.location}`:'',payload.peripheralSerial?`Affected peripheral serial: ${payload.peripheralSerial}`:'',payload.includeDiagnostics?'--- Computer diagnostics ---':'',payload.includeDiagnostics?`Computer: ${payload.device.hostname}
Serial: ${payload.device.serial||'Unavailable'}
Manufacturer: ${payload.device.manufacturer||'Unknown'}
Model: ${payload.device.model||'Unknown'}
OS: ${payload.device.os} ${payload.device.osVersion}
CPU: ${payload.device.cpu}
Memory (GB): ${payload.device.memoryGB}`:''].filter(Boolean).join('\n\n');
 const ticket={Title:payload.title,Description:description,RequestorUid:identity.tdxUid,TypeID:id(e,'TDX_TYPE_ID'),StatusID:id(e,'TDX_STATUS_ID'),PriorityID:id(e,'TDX_PRIORITY_ID'),FormID:id(e,'TDX_FORM_ID')};if(e.TDX_ACCOUNT_ID)ticket.AccountID=id(e,'TDX_ACCOUNT_ID');
 // These are minimal mapping fields; GRCC's actual ticket form may require additional fields.
 const created=await this.request(`/api/${this.ticketApp}/tickets`,'POST',ticket);const ticketId=Number(created?.ID||created?.TicketID||created?.TicketId);if(!Number.isSafeInteger(ticketId)||ticketId<=0)throw Error('TeamDynamix response did not contain a valid ticket ID');
 let assetLinked=false,assetWarning='';const serial=payload.kind==='computer'?payload.device.serial:payload.peripheralSerial;
 if(serial){try{const asset=await this.findAsset(serial);if(asset){const assetId=Number(asset.ID||asset.AssetID);if(Number.isSafeInteger(assetId)&&assetId>0){await this.request(`/api/${this.ticketApp}/tickets/${ticketId}/assets/${assetId}`,'POST');assetLinked=true;}else assetWarning='Asset match lacked an ID; the ticket was created without an asset link.';}else assetWarning='No unique exact serial-number match; ticket created without an asset link.';}catch(err){assetWarning='Ticket created, but automatic asset linking failed. IT can link the asset manually.';}}
 const urlBase=e.TDX_TICKET_URL_BASE||'';return {ticketId,assetLinked,assetWarning,url:urlBase&&urlBase.startsWith('https://supportdesk.grcc.edu/')?urlBase+ticketId:undefined};}
}
