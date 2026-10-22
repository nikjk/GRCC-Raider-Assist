import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type Device = { loggedInUsername?:string; hostname:string; serial:string|null; manufacturer:string|null; model:string|null; os:string; osVersion:string; architecture:string; cpu:string; memoryGB:number; diskFreeGB:number|null; diskTotalGB?:number|null; osBuild?:string; uptimeHours?:number; networkType?:string; platform:string };
type LocationOption={id:number;name:string};
type RoomOption={id:number;name:string};
type Choice = 'computer'|'monitor'|'dock'|'keyboard'|'mouse'|'other';
type SubmitResult = { ticketId?:number; demo?:boolean; assetLinked?:boolean; assetWarning?:string; url?:string; message?:string };
interface Bridge { getDevice():Promise<Device>; submitTicket(payload:unknown):Promise<SubmitResult>; getBackendStatus():Promise<{mode:string;identityStatus:string}>; getLocations():Promise<LocationOption[]>; getRooms(locationId:number):Promise<RoomOption[]>; openExternal(url:string):Promise<void> }
declare global { interface Window { raider?:Bridge } }
@Component({selector:'app-root', standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./app.html'})
export class AppComponent implements OnInit {
 choices:{id:Choice;label:string;symbol:string}[]=[{id:'computer',label:'Computer',symbol:'▣'},{id:'monitor',label:'Monitor',symbol:'▤'},{id:'dock',label:'Docking station',symbol:'▥'},{id:'keyboard',label:'Keyboard',symbol:'⌨'},{id:'mouse',label:'Mouse',symbol:'◉'},{id:'other',label:'Other',symbol:'⋯'}];
 requestorUsername=''; requestorType:'staff'|'student'='staff'; kind:Choice='computer'; title=''; details=''; locationId:number|null=null; roomId:number|null=null; buildingText=''; roomText=''; pickerOpen:'building'|'room'|null=null; pickerIndex=0; peripheralSerial=''; includeDiagnostics=true;
 locations=signal<LocationOption[]>([]); rooms=signal<RoomOption[]>([]); locationsLoading=signal(false); roomsLoading=signal(false); locationsError=signal(''); roomsError=signal('');
 busy=signal(false); device=signal<Device|null>(null); error=signal(''); success=signal<SubmitResult|null>(null); mode=signal('Checking backend…');
 async ngOnInit(){try{this.device.set(await this.bridge().getDevice());this.requestorUsername=(this.device()?.loggedInUsername||'').replace(/@.*$/,'');const status=await this.bridge().getBackendStatus();this.mode.set(status.mode==='demo'?'Local demo mode':status.mode==='sandbox-readonly'?'Sandbox locations • ticket demo mode':status.mode==='sandbox-test'?'SANDBOX TEST • creates real test tickets':'Trusted backend • '+status.identityStatus);await this.loadLocations();}catch(e){this.error.set(String(e));this.mode.set('Unavailable')}}
 bridge():Bridge { if(!window.raider) throw new Error('Open this application in Electron; browser preview has no device bridge.'); return window.raider; }
 async loadLocations(){this.locationsLoading.set(true);this.locationsError.set('');try{this.locations.set(await this.bridge().getLocations());}catch(e){this.locationsError.set(e instanceof Error?e.message:String(e));}finally{this.locationsLoading.set(false)}}
 async buildingChanged(){this.roomId=null;this.roomText='';this.rooms.set([]);this.roomsError.set('');const selected=this.locationId;if(selected===null)return;this.roomsLoading.set(true);try{const rooms=await this.bridge().getRooms(selected);if(this.locationId===selected)this.rooms.set(rooms);}catch(e){if(this.locationId===selected)this.roomsError.set(e instanceof Error?e.message:String(e));}finally{if(this.locationId===selected)this.roomsLoading.set(false)}}
 async buildingInputChanged(text:string){
  this.pickerIndex=0;
  const selected=this.locations().find(x=>x.name.toLocaleLowerCase()===text.trim().toLocaleLowerCase());
  const next=selected?.id??null;
  if(next!==this.locationId){this.locationId=next;await this.buildingChanged();}
 }
 roomInputChanged(text:string){
  this.roomId=this.rooms().find(x=>x.name.toLocaleLowerCase()===text.trim().toLocaleLowerCase())?.id??null;
  this.pickerIndex=0;
 }
 filteredBuildings(){const q=this.buildingText.trim().toLocaleLowerCase();return this.locations().filter(x=>x.name.toLocaleLowerCase().includes(q));}
 filteredRooms(){const q=this.roomText.trim().toLocaleLowerCase();return this.rooms().filter(x=>x.name.toLocaleLowerCase().includes(q));}
 openPicker(which:'building'|'room'){this.pickerOpen=which;this.pickerIndex=0;}
 closePicker(which:'building'|'room'){if(this.pickerOpen===which)this.pickerOpen=null;}
 async chooseBuilding(location:LocationOption){
  this.buildingText=location.name;
  this.pickerOpen=null;
  if(this.locationId!==location.id){this.locationId=location.id;await this.buildingChanged();}
 }
 chooseRoom(room:RoomOption){this.roomText=room.name;this.roomId=room.id;this.pickerOpen=null;}
 clearBuildingSelection(){
  this.buildingText='';this.locationId=null;
  this.roomText='';this.roomId=null;this.rooms.set([]);this.roomsError.set('');
  this.pickerOpen=null;this.pickerIndex=0;
 }
 clearRoomSelection(){
  this.roomText='';this.roomId=null;
  this.pickerOpen=null;this.pickerIndex=0;
 }
 pickerKeydown(event:KeyboardEvent,which:'building'|'room'){
  if(event.key==='Escape'){this.pickerOpen=null;return;}
  const options=which==='building'?this.filteredBuildings():this.filteredRooms();
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   event.preventDefault();
   if(this.pickerOpen!==which){this.openPicker(which);return;}
   if(options.length)this.pickerIndex=(this.pickerIndex+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
   return;
  }
  if((event.key==='Enter'||event.key==='Tab')&&this.pickerOpen===which&&options[this.pickerIndex]){
   if(event.key==='Enter')event.preventDefault();
   if(which==='building')void this.chooseBuilding(options[this.pickerIndex] as LocationOption);
   else this.chooseRoom(options[this.pickerIndex] as RoomOption);
  }
 }

 select(kind:Choice){this.kind=kind;this.success.set(null);this.error.set('')}
 async submit(){if(this.busy()||!this.title.trim()||!this.details.trim())return;
  if(this.buildingText.trim() && this.locationId===null){this.error.set('Select a building from the suggestions.');return;}
  if(this.roomText.trim() && this.roomId===null){this.error.set('Select a room from the suggestions.');return;}this.error.set('');this.success.set(null);this.busy.set(true);
  try{const result=await this.bridge().submitTicket({kind:this.kind,requestorUsername:this.requestorUsername.trim(),requestorType:this.requestorType,title:this.title.trim(),description:this.details.trim(),locationId:this.locationId,roomId:this.roomId,peripheralSerial:this.peripheralSerial.trim(),includeDiagnostics:this.includeDiagnostics});this.success.set(result);if(result.ticketId){this.title='';this.details='';this.peripheralSerial='';}}
  catch(e){this.error.set(e instanceof Error?e.message:String(e));}finally{this.busy.set(false)} }
 async openTicket(){const u=this.success()?.url;if(u)await this.bridge().openExternal(u)}
}
bootstrapApplication(AppComponent).catch(console.error);
