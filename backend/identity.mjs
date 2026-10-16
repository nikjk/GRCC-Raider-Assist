// These headers MUST be stripped and re-injected only by a separately authenticated,
// trusted gateway (e.g., mTLS device certificates + IdP user assertion).
// This file deliberately does NOT authenticate a device by hostname or serial.
export function resolveIdentity(req,env=process.env){
 if(env.RAIDER_MODE!=='production')return null;
 if(env.IDENTITY_INTEGRATION!=='trusted-proxy'||env.TRUSTED_PROXY_ENABLED!=='true')throw Error('Managed-device identity integration is not configured');
 const uid=req.headers['x-grcc-authenticated-tdx-uid'];
 const sub=req.headers['x-grcc-authenticated-subject'];
 if(typeof uid!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(uid)||typeof sub!=='string'||sub.length>256||!sub.trim())return null;
 return {tdxUid:uid,subject:sub};
}
