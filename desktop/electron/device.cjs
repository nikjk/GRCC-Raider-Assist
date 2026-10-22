const os=require('node:os');const fs=require('node:fs/promises');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const exec=promisify(execFile);
async function command(program,args){try{const {stdout}=await exec(program,args,{timeout:3500,windowsHide:true,maxBuffer:1024*1024});return stdout.trim()}catch{return ''}}
function clean(value){const x=String(value||'').trim();return /^(to be filled by o\.e\.m\.|none|unknown|default string|not applicable)$/i.test(x)?'':x}
async function getDevice(){const platform=process.platform;let serial='',manufacturer='',model='',diskFreeGB=null;
 if(platform==='win32'){
  const ps='Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber; Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json -Compress';
  const lines=(await command('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps])).split(/\r?\n/).filter(Boolean);serial=clean(lines[0]);try{const o=JSON.parse(lines.slice(1).join(''));manufacturer=clean(o.Manufacturer);model=clean(o.Model)}catch{}
 }else if(platform==='darwin'){
  const out=await command('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice']);serial=clean(out.match(/"IOPlatformSerialNumber"\s*=\s*"([^"]+)"/)?.[1]);
  const hw=await command('/usr/sbin/system_profiler',['SPHardwareDataType']);model=clean(hw.match(/Model Name:\s*(.+)/)?.[1]);manufacturer='Apple';
 }else{serial=clean(await command('cat',['/sys/class/dmi/id/product_serial']));model=clean(await command('cat',['/sys/class/dmi/id/product_name']));manufacturer=clean(await command('cat',['/sys/class/dmi/id/sys_vendor']))}
 let diskTotalGB=null;
 try{const stat=await fs.statfs(os.homedir());const block=Number(stat.bsize);if(block>0){diskFreeGB=Math.round(Number(stat.bavail)*block/1073741824*10)/10;diskTotalGB=Math.round(Number(stat.blocks)*block/1073741824*10)/10}}catch{}
 const osBuild=platform==='darwin'?await command('/usr/bin/sw_vers',['-buildVersion']):platform==='win32'?await command('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Environment]::OSVersion.Version.Build.ToString()']):os.release();
 // Only record connection type, not address, SSID, gateway or browsing history.
 let networkType='Unknown',networkAdapter=null;
 const activeInterfaces=Object.entries(os.networkInterfaces()).filter(([iface,addrs])=>!iface.toLowerCase().startsWith('lo')&&Array.isArray(addrs)&&addrs.some(addr=>addr.family==='IPv4'&&!addr.internal));
 if(platform==='darwin'){
  const ports=await command('/usr/sbin/networksetup',['-listallhardwareports']);
  // The default-route interface is the actual connection in use. Wi-Fi can
  // have an IP address while macOS routes traffic through a USB dock.
  const route=await command('/sbin/route',['-n','get','default']);
  const defaultInterface=route.match(/^\s*interface:\s*([a-z0-9]+)\s*$/im)?.[1]||null;
  const port=defaultInterface?hardwarePortForDevice(ports,defaultInterface):null;
  networkType=!defaultInterface?'Disconnected':/wi-?fi|airport/i.test(port||'')?'Wi-Fi':/ethernet|\blan\b/i.test(port||'')?'Ethernet':'Other network';
  networkAdapter=port;
 }else if(platform==='win32'){
  const info=await command('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-NetAdapter | Where-Object Status -eq Up | Select-Object -ExpandProperty PhysicalMediaType | ConvertTo-Json -Compress']);
  networkType=/802\.11|wireless|wi-?fi/i.test(info)?'Wi-Fi':activeInterfaces.length?'Ethernet or other network':'Disconnected';
 }else{networkType=activeInterfaces.length?'Connected (type unknown)':'Disconnected'}
 // RAIDER_MAC_MEMORY_PRESSURE_SWAP_V1
 let macMemoryPressureAvailablePercent=null;
 let macSwapUsedGB=null,macSwapTotalGB=null,macMemoryPressureLevel=null;
 if(platform==='darwin'){
  const pressure=await command('/usr/bin/memory_pressure',['-Q']);
  const available=pressure.match(/System-wide memory free percentage:\s*([\d.]+)\s*%/i);
  if(available){const n=Number(available[1]);if(Number.isFinite(n)&&n>=0&&n<=100)macMemoryPressureAvailablePercent=Math.round(n*10)/10;}
  const pressureLevel=(await command('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level'])).trim();
  macMemoryPressureLevel=({'1':'Normal','2':'Warning','4':'Critical'})[pressureLevel]||null;
  const swap=await command('/usr/sbin/sysctl',['-n','vm.swapusage']);
  const convertGB=(label)=>{
   const m=swap.match(new RegExp('\\b'+label+'\\s*=\\s*([\\d.]+)\\s*([KMGTP]?)','i'));
   if(!m)return null;
   const value=Number(m[1]);if(!Number.isFinite(value))return null;
   const unit=(m[2]||'').toUpperCase();
   const factor={K:1/1048576,M:1/1024,G:1,T:1024,P:1048576,'':1/1073741824}[unit];
   return factor===undefined?null:Math.round(value*factor*100)/100;
  };
  macSwapUsedGB=convertGB('used');macSwapTotalGB=convertGB('total');
 }
 const networkCounters=platform==='darwin'?await macNetworkCounters():null;
 const uptimeHours=Math.round(os.uptime()/3600*10)/10;
 const cpus=os.cpus();return {loggedInUsername:(()=>{try{return os.userInfo().username}catch{return ''}})(),hostname:os.hostname(),serial:serial||null,manufacturer:manufacturer||null,model:model||null,os:platform==='darwin'?'macOS':platform==='win32'?'Windows':os.type(),osVersion:os.release(),architecture:os.arch(),cpu:cpus[0]?.model||'Unknown',memoryGB:Math.round(os.totalmem()/1073741824*10)/10,diskFreeGB,diskTotalGB,osBuild,uptimeHours,networkType,networkAdapter,networkInterface:networkCounters?.interfaceName||null,networkReceiveErrors:networkCounters?.receiveErrors??null,networkSendErrors:networkCounters?.sendErrors??null,macMemoryPressureAvailablePercent,macMemoryPressureLevel,macSwapUsedGB,macSwapTotalGB,platform};}


// Parse individual Hardware Port blocks so a Wi-Fi entry cannot match a later
// Ethernet Device line. The port label is an adapter type, not an address.
function hardwarePortForDevice(list,interfaceName){
 for(const block of list.split(/\r?\n\s*\r?\n/)){
  const device=block.match(/^Device:\s*(\S+)/m)?.[1];
  if(device===interfaceName)return block.match(/^Hardware Port:\s*(.+)$/m)?.[1]?.trim()||null;
 }
 return null;
}

// Local-only network counters. No SSIDs, addresses, or browsing data are recorded.
async function macNetworkCounters(){
 const route=await command('/sbin/route',['-n','get','default']);
 const iface=route.match(/^\s*interface:\s*([a-z0-9]+)\s*$/im)?.[1];
 if(!iface)return null;
 const output=await command('/usr/sbin/netstat',['-ibn','-I',iface]);
 const lines=output.split(/\r?\n/).filter(Boolean);
 const headerIndex=lines.findIndex(line=>/\bIbytes\b/.test(line)&&/\bObytes\b/.test(line));
 if(headerIndex<0)return {interfaceName:iface};
 const keys=lines[headerIndex].trim().split(/\s+/);
 const getIndex=(name)=>keys.indexOf(name);
 const indices=['Ibytes','Obytes','Ierrs','Oerrs'].map(getIndex);
 if(indices.slice(0,2).some(n=>n<0))return {interfaceName:iface};
 const rows=lines.slice(headerIndex+1).map(line=>line.trim().split(/\s+/)).filter(cols=>cols[0]===iface && cols.length>=keys.length);
 // IPv4 and IPv6 may both appear; select the row with the highest byte counters.
 const results=rows.map(cols=>({receiveBytes:Number(cols[indices[0]]),sendBytes:Number(cols[indices[1]]),receiveErrors:indices[2]<0?null:Number(cols[indices[2]]),sendErrors:indices[3]<0?null:Number(cols[indices[3]])})).filter(x=>Number.isFinite(x.receiveBytes)&&Number.isFinite(x.sendBytes));
 if(!results.length)return {interfaceName:iface};
 results.sort((a,b)=>(b.receiveBytes+b.sendBytes)-(a.receiveBytes+a.sendBytes));
 return {interfaceName:iface,...results[0]};
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function cpuTicks(){return os.cpus().map(cpu=>({...cpu.times}))}
function cpuPercent(before,after){
 let busy=0,total=0;
 for(let i=0;i<Math.min(before.length,after.length);i++){
  const a=before[i],b=after[i];
  const idle=Math.max(0,b.idle-a.idle);
  const duration=['user','nice','sys','idle','irq'].reduce((n,k)=>n+Math.max(0,b[k]-a[k]),0);
  busy+=Math.max(0,duration-idle);total+=duration;
 }
 return total>0?Math.round(busy/total*1000)/10:null;
}
async function performanceSnapshot(){
 const first=cpuTicks();
 const beforeNetwork=process.platform==='darwin'?await macNetworkCounters():null;
 const started=Date.now();
 await sleep(1000);
 const afterNetwork=process.platform==='darwin'?await macNetworkCounters():null;
 const cpuUsagePercent=cpuPercent(first,cpuTicks());
 const elapsed=Math.max((Date.now()-started)/1000,0.001);
 const networkRates={
  networkInterface:afterNetwork?.interfaceName||beforeNetwork?.interfaceName||null,
  networkReceiveMbps:null,networkSendMbps:null,networkReceiveKbps:null,networkSendKbps:null,
  networkReceiveErrors:afterNetwork?.receiveErrors??null,
  networkSendErrors:afterNetwork?.sendErrors??null
 };
 if(beforeNetwork && afterNetwork && beforeNetwork.interfaceName===afterNetwork.interfaceName){
  for(const [out,key] of [['networkReceiveMbps','receiveBytes'],['networkSendMbps','sendBytes']]){
   const delta=afterNetwork[key]-beforeNetwork[key];
   if(Number.isFinite(delta)&&delta>=0){
    const kbps=delta*8/1000/elapsed;
    networkRates[out]=Math.round(kbps/1000*10000)/10000;
    networkRates[out==='networkReceiveMbps'?'networkReceiveKbps':'networkSendKbps']=Math.round(kbps*10)/10;
   }
  }
 }
 const total=os.totalmem(),free=os.freemem();
 const gb=n=>Math.round(n/1073741824*10)/10;
 return {
  cpuUsagePercent,
  ...networkRates,
  memoryUsedGB:gb(Math.max(0,total-free)),
  memoryAvailableGB:gb(free),
  memoryTotalGB:gb(total),
  memoryUsagePercent:total>0?Math.round((total-free)/total*1000)/10:null,
  // load averages are meaningful on macOS/Linux, not on Windows.
  cpuLoadAverage:process.platform==='win32'?null:os.loadavg().map(n=>Math.round(n*100)/100),
  performanceSampledAt:new Date().toISOString()
 };
}

module.exports={getDevice,performanceSnapshot};
