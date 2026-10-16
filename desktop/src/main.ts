import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type Device = { hostname:string; serial:string|null; manufacturer:string|null; model:string|null; os:string; osVersion:string; architecture:string; cpu:string; memoryGB:number; diskFreeGB:number|null; platform:string };
type Choice = 'computer'|'monitor'|'dock'|'keyboard'|'mouse'|'other';
type SubmitResult = { ticketId?:number; demo?:boolean; assetLinked?:boolean; assetWarning?:string; url?:string; message?:string };
interface Bridge { getDevice():Promise<Device>; submitTicket(payload:unknown):Promise<SubmitResult>; getBackendStatus():Promise<{mode:string;identityStatus:string}>; openExternal(url:string):Promise<void> }
declare global { interface Window { raider?:Bridge } }
@Component({selector:'app-root', standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./app.html'})
export class AppComponent implements OnInit {
 choices:{id:Choice;label:string;symbol:string}[]=[{id:'computer',label:'Computer',symbol:'▣'},{id:'monitor',label:'Monitor',symbol:'▤'},{id:'dock',label:'Docking station',symbol:'▥'},{id:'keyboard',label:'Keyboard',symbol:'⌨'},{id:'mouse',label:'Mouse',symbol:'◉'},{id:'other',label:'Other',symbol:'⋯'}];
 kind:Choice='computer'; title=''; details=''; location=''; peripheralSerial=''; includeDiagnostics=true;
 busy=signal(false); device=signal<Device|null>(null); error=signal(''); success=signal<SubmitResult|null>(null); mode=signal('Checking backend…');
 async ngOnInit(){try{this.device.set(await this.bridge().getDevice());const status=await this.bridge().getBackendStatus();this.mode.set(status.mode==='demo'?'Local demo mode':'Trusted backend • '+status.identityStatus);}catch(e){this.error.set(String(e));this.mode.set('Unavailable')}}
 bridge():Bridge { if(!window.raider) throw new Error('Open this application in Electron; browser preview has no device bridge.'); return window.raider; }
 select(kind:Choice){this.kind=kind;this.success.set(null);this.error.set('')}
 async submit(){if(this.busy()||!this.title.trim()||!this.details.trim())return;this.error.set('');this.success.set(null);this.busy.set(true);
  try{const result=await this.bridge().submitTicket({kind:this.kind,title:this.title.trim(),description:this.details.trim(),location:this.location.trim(),peripheralSerial:this.peripheralSerial.trim(),includeDiagnostics:this.includeDiagnostics});this.success.set(result);if(result.ticketId){this.title='';this.details='';this.peripheralSerial='';}}
  catch(e){this.error.set(e instanceof Error?e.message:String(e));}finally{this.busy.set(false)} }
 async openTicket(){const u=this.success()?.url;if(u)await this.bridge().openExternal(u)}
}
bootstrapApplication(AppComponent).catch(console.error);
