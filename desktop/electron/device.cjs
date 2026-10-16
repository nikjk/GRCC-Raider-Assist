const os=require('node:os');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const exec=promisify(execFile);
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
 const cpus=os.cpus();return {loggedInUsername:(()=>{try{return os.userInfo().username}catch{return ''}})(),hostname:os.hostname(),serial:serial||null,manufacturer:manufacturer||null,model:model||null,os:platform==='darwin'?'macOS':platform==='win32'?'Windows':os.type(),osVersion:os.release(),architecture:os.arch(),cpu:cpus[0]?.model||'Unknown',memoryGB:Math.round(os.totalmem()/1073741824*10)/10,diskFreeGB,platform};}
module.exports={getDevice};
