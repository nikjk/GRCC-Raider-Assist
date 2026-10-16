const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('raider',Object.freeze({getDevice:()=>ipcRenderer.invoke('device:get'),getBackendStatus:()=>ipcRenderer.invoke('backend:status'),submitTicket:(payload)=>ipcRenderer.invoke('ticket:submit',payload),openExternal:(url)=>ipcRenderer.invoke('url:open',url)}));
