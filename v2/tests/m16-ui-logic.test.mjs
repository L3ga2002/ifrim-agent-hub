import test from "node:test";
import assert from "node:assert/strict";
import { roCount, roList, bucharestParts } from "../web/src/lib/roText.js";
import { VIEWS, VIEW_OF_QUERY, indicatorText, idleFigures, freshness, recapStep, keyAction, newDecisionNotice, chapterVoice } from "../web/src/lib/commandModel.js";
import { sanitizeState, acceptMessage, openCommandChannel } from "../web/src/lib/commandSync.js";
import { radialLayout, carousel, departmentDetail, relationsOf } from "../web/src/lib/companyGraph.js";
const now = Date.parse("2026-10-25T01:14:00Z");
const ind = (id, value) => ({ id, label: "Decizii", value, display: String(value), state: value ? "value" : "zero", source: "Deciziile mele", readAt: new Date(now).toISOString(), applies: "now", provenance: "real" });
const snapshot = (value, extra = {}) => ({ id: "rcp_test", bootId: "boot", generatedAt: new Date(now - 10000).toISOString(), lastSeq: 10, chapters: [{ indicators: [ind("waiting.decisions", value), ind("waiting.blocked", 5)] }, { indicators: [ind("work.active", 7)] }], ...extra });
for (const [n, result] of [[0,"0 devize pregătite"],[1,"1 deviz pregătit"],[2,"2 devize pregătite"],[19,"19 devize pregătite"],[20,"20 de devize pregătite"],[100,"100 de devize pregătite"],[101,"101 devize pregătite"],[102,"102 devize pregătite"],[120,"120 de devize pregătite"]]) test(`roCount ${n}`, () => assert.equal(roCount(n, { one: "deviz pregătit", many: "devize pregătite" }), result));
test("Romanian articles, zero and lists", () => { assert.equal(roCount(1,{one:"decizie",many:"decizii",gender:"f",article:true}),"o decizie"); assert.equal(roCount(1,{one:"deviz",gender:"m",article:true}),"un deviz"); assert.equal(roCount(0,{none:"niciun deviz"}),"niciun deviz"); assert.equal(roList([]),""); assert.equal(roList(["a"]),"a"); assert.equal(roList(["a","b","c"]),"a, b și c"); });
for (const [date, time] of [["2026-10-25T00:30:00Z","03:30"],["2026-10-25T01:30:00Z","03:30"],["2026-03-29T00:30:00Z","02:30"],["2026-03-29T01:30:00Z","04:30"],["2026-07-01T12:00:00Z","15:00"],["2026-01-01T12:00:00Z","14:00"]]) test(`Bucharest ${date}`,()=>assert.equal(bucharestParts(date).time,time));
test("Bucharest date in Romanian",()=>{ const p = bucharestParts("2026-10-24T22:14:00Z"); assert.equal(p.weekday,"duminică"); assert.equal(p.date,"25 octombrie 2026"); assert.equal(p.dateShort,"25 oct."); });
test("Indicators preserve source, explicit states and synthetic provenance; conceal both value and display", () => { const i = ind("a",3); assert.equal(indicatorText(i).text,"3"); assert.match(indicatorText(i).source,/acum \(03:14\)/); const hidden = indicatorText({...i,display:"1 real + 2 sintetice",provenance:"mixed"},{hideNumbers:true}); assert.equal(hidden.text,"•••"); assert.equal(hidden.srText,"cifră ascunsă"); for(const [state,display] of [["disabled","dezactivată"],["unknown","necunoscut"],["unavailable","indisponibil"]]) assert.equal(indicatorText({...i,state,display,value:null},{hideNumbers:true}).text,display); assert.equal(indicatorText({...i,provenance:"synthetic"}).text,"3"); assert.equal(indicatorText({...i,applies:"interval"}).source,"Deciziile mele · în perioada aleasă"); });
test("Idle cards pass server objects through unchanged",()=>{const s=snapshot(3),f=idleFigures(s);assert.equal(f.decisions,s.chapters[0].indicators[0]); assert.equal(f.works.value,7); assert.equal(f.blockers.value,5);});
test("Freshness never marks old or disconnected data LIVE",()=>{const s=snapshot(3);assert.equal(freshness({snapshot:s,connection:"live",now}).live,true);const stale=freshness({snapshot:{...s,generatedAt:new Date(now-16000).toISOString()},connection:"live",lastHubSeq:11,now});assert.equal(stale.stale,true);assert.equal(stale.live,false);for(const connection of ["reconnecting","offline","connecting"]) { const f=freshness({snapshot:s,connection,now});assert.equal(f.live,false);assert.match(f.label,/Legătura cu Hub-ul s-a pierdut/); } assert.equal(freshness({snapshot:{...s,generatedAt:new Date(now-120001).toISOString()},connection:"live",now}).live,false);});
test("Recap controls clamp and preserve snapshot",()=>{let s={snapshotId:"rcp_a",index:0,stopped:false};assert.equal(recapStep(s,"back").index,0);assert.equal(recapStep({...s,index:5},"next").index,5);assert.equal(recapStep({...s,index:5},"next").atEnd,true);assert.equal(recapStep(s,"stop").stopped,true);assert.equal(recapStep(s,"repeat").snapshotId,s.snapshotId);assert.equal(recapStep(s,"open").index,0);});
test("Plain keys only, outside editing and dialogs",()=>{ const context={view:"recap"};for(const [key,action] of [["ArrowRight","next"],["ArrowLeft","prev"],["Enter","open"],["Escape","exit"],["1","view:idle"],["7","view:system"]])assert.equal(keyAction({key},context),action); for(const key of ["ctrlKey","altKey","metaKey","shiftKey","isComposing","repeat"]) assert.equal(keyAction({key:"ArrowRight",[key]:true},context),null);for(const tagName of ["INPUT","TEXTAREA","SELECT"]) assert.equal(keyAction({key:"1",target:{tagName}},context),null); assert.equal(keyAction({key:"1",target:{isContentEditable:true}},context),null);assert.equal(keyAction({key:"1"},{dialogOpen:true}),null);assert.equal(keyAction({key:"Enter"},{view:"idle"}),null); });
test("Decision notice only increases within one known boot",()=>{assert.equal(newDecisionNotice(snapshot(1),snapshot(2)),true);assert.equal(newDecisionNotice(snapshot(2),snapshot(1)),false);assert.equal(newDecisionNotice(snapshot(1),snapshot(2,{bootId:"other"})),false);assert.equal(newDecisionNotice(null,snapshot(2)),false);});
test("Voice handoff is not speech evidence",()=>{assert.doesNotMatch(chapterVoice({handedOff:true}),/Rostit/);assert.doesNotMatch(chapterVoice({playback:true}),/Rostit/);assert.match(chapterVoice({handedOff:true}),/Predat/);assert.match(chapterVoice({heard:{match:.83}}),/Rostit.*83%/);assert.match(chapterVoice({playback:true}),/Redare detectată/);assert.match(chapterVoice({reason:"other_session"}),/other_session/);assert.match(chapterVoice({reason:"voice_off"}),/vocea e oprită/);});
test("Sync whitelist drops authority and invalid ids at every level",()=>{const s=sanitizeState(JSON.parse('{"view":"recap","recap":{"snapshotId":"rcp_a","index":2,"stopped":false,"token":"secret"},"token":"secret","cookie":"secret","legaSessionId":"secret","authority":true,"__proto__":{"token":"secret"},"unknown":2,"departmentKey":"sales","sheetId":"flow:offer","missionId":"m_1","hideNumbers":true,"variant":"B","decor":false}'));assert.deepEqual(Object.keys(s).sort(),["decor","departmentKey","hideNumbers","missionId","recap","sheetId","variant","view"].sort());assert.deepEqual(s.recap,{snapshotId:"rcp_a",index:2,stopped:false});assert.doesNotMatch(JSON.stringify(s),/secret|token|cookie|authority|__proto__/);assert.deepEqual(sanitizeState({view:"evil",recap:{snapshotId:"../x",index:6},departmentKey:"Sales",sheetId:"flow:../bad",missionId:"a/b",variant:"D"}),{});});
const local={from:"tv1",role:"tv",bootId:"boot",lastRev:{},now};const message=(extra={})=>({v:1,kind:"state",from:"main1",role:"main",rev:1,at:now,bootId:"boot",state:{view:"company"},...extra});
test("Sync refuses own, wrong version/kind, old, future, other boot and tv senders",()=>{for(const [extra,reason] of [[{from:"tv1"},"own"],[{v:2},"invalid"],[{kind:"bad"},"invalid"],[{at:now-300001},"old"],[{at:now+300001},"old"],[{bootId:"other"},"other_boot"],[{role:"tv"},"non_main"]])assert.equal(acceptMessage(local,message(extra)).reason,reason);});
test("Sync revisions and newest-main leadership; only leader bye closes",()=>{const first=acceptMessage(local,message());assert.equal(first.accept,true);assert.equal(first.next.leader,"main1");assert.equal(acceptMessage(first.next,message()).reason,"stale");assert.equal(acceptMessage(first.next,message({rev:0})).reason,"stale");const second=acceptMessage(first.next,message({from:"main2",at:now+1}));assert.equal(second.next.leader,"main2");assert.equal(acceptMessage(second.next,message({kind:"bye",rev:2})).next.mainClosed,false);const closed=acceptMessage(second.next,message({from:"main2",kind:"bye",rev:2,at:now+2}));assert.equal(closed.next.mainClosed,true);assert.equal(acceptMessage(closed.next,message({from:"main1",rev:3,at:now+3})).next.mainClosed,false);});
test("Radial order is independent of counts and carousel wraps",()=>{const depts=[{key:"a",counts:{works:1}},{key:"b"},{key:"c"}];const layout=radialLayout(depts,{cx:0,cy:0,r:10});assert.equal(layout[0].angle,-90);assert.equal(layout[0].y,-10);assert.equal(radialLayout(depts.map(d=>({...d,counts:{works:999}})))[1].angle,layout[1].angle);assert.equal(carousel(depts,"a","prev"),"c");assert.equal(carousel(depts,"c","next"),"a");});
test("Department detail follows graph edges only and preserves records/provenance",()=>{const role={id:"r",name:"Role"},skill={id:"s",name:"skill"},tool={id:"t"},work={missionId:"m"};const edges=[{from:"dept:a",to:"role:r",kind:"dept_role",provenance:{source:"roles.json department",ref:"r"}},{from:"role:r",to:"skill:skill",kind:"role_skill"},{from:"skill:skill",to:"tool:t",kind:"skill_tool"},{from:"work:m",to:"dept:a",kind:"work_dept"}];const g={departments:[{key:"a"}],roles:[role,{id:"unlinked",department:"a"}],skills:[skill],tools:[tool,{id:"x"}],works:[work],edges};const d=departmentDetail(g,"a");assert.deepEqual(d.roles,[role]);assert.deepEqual(d.skills,[skill]);assert.deepEqual(d.tools,[tool]);assert.deepEqual(d.works,[work]);assert.equal(d.edges[0],edges[0]);assert.equal(relationsOf(g,"dept:a").length,2);});
test("View vocabulary covers all nine views",()=>{assert.equal(VIEWS.length,9);assert.equal(VIEW_OF_QUERY.fisa,"sheet");});

test("Sync ignores inherited properties and bad nested indices",()=>{assert.deepEqual(sanitizeState(Object.create({view:"company",hideNumbers:true})),{});for(const index of [-1,6,1.5,"1"])assert.deepEqual(sanitizeState({recap:{snapshotId:"rcp_a",index,stopped:false}}),{});});
test("Concealed corner text and source carry no digits",()=>{const i=indicatorText({...ind("waiting.decisions",20),display:"20 de decizii",note:"2 sintetice"},{hideNumbers:true});assert.doesNotMatch([i.text,i.srText,i.source,i.note].join(" "),/\d/);});
test("Channel handshake, state sanitization and leader close",()=>{
  const original=globalThis.BroadcastChannel,peers=new Set(),received=[],presence=[];
  class FakeChannel { constructor(){peers.add(this);} postMessage(msg){for(const p of [...peers])if(p!==this)p.onmessage?.({data:structuredClone(msg)});} close(){peers.delete(this);} }
  globalThis.BroadcastChannel=FakeChannel;
  let main,tv;
  try { main=openCommandChannel({role:"main"});main.setBootId("boot");main.publish({view:"recap",token:"never",recap:{snapshotId:"rcp_test",index:1,stopped:false}});tv=openCommandChannel({role:"tv",onState:s=>received.push(s),onPeer:p=>presence.push(p)});tv.setBootId("boot");tv.hello();assert.equal(received.at(-1).recap.index,1);assert.equal(Object.hasOwn(received.at(-1),"token"),false);main.publish({view:"department",departmentKey:"sales"});assert.equal(received.at(-1).departmentKey,"sales");main.close();main=null;assert.equal(presence.at(-1).mainClosed,true); }
  finally {main?.close();tv?.close();globalThis.BroadcastChannel=original;}
});
test("Channel absence or constructor refusal leaves independent reads possible",()=>{const original=globalThis.BroadcastChannel;try {globalThis.BroadcastChannel=undefined;const missing=openCommandChannel({role:"tv"});missing.hello();missing.close();globalThis.BroadcastChannel=class{constructor(){throw new Error("unavailable");}};const refused=openCommandChannel({role:"main"});refused.publish({view:"idle"});refused.close();}finally{globalThis.BroadcastChannel=original;}});

import { clampThreshold, orderedStages, conversionLabel } from "../web/src/lib/funnelLogic.js";
import { durationText, stepDuration, traceLayout, defaultMission } from "../web/src/lib/factoryTrace.js";
import { searchNodes, freshnessWords, yesNo } from "../web/src/lib/systemMap.js";
import { buildMorphTargets } from "../web/src/lib/faceGeometry.js";
test("Funnel threshold is a bounded integer and invalid input uses the default",()=>{for(const [input,expected] of [[0,1],[900,365],[21.6,22],["",21],["bad",21],[NaN,21],["14",14]])assert.equal(clampThreshold(input),expected);});
test("Funnel order and conversion labels preserve insufficient data",()=>{assert.deepEqual(orderedStages([{status:"WON"},{status:"IDENTIFIED"}]).map(s=>s.status),["IDENTIFIED","WON"]);assert.equal(conversionLabel({state:"insufficient",rate:1}),"Date insuficiente");assert.equal(conversionLabel({state:"ok",rate:.26}),"26%");assert.equal(conversionLabel({state:"ok",rate:null}),"Date insuficiente");});
test("Trace durations use recorded windows; absent and future time are unknown",()=>{assert.equal(durationText(252000),"4 min 12 s");assert.equal(durationText(null),"necunoscut");assert.equal(durationText(-1),"necunoscut");assert.equal(stepDuration({at:"2026-01-01T00:00:00Z",leftAt:null},Date.parse("2026-01-01T00:03:00Z")),"în curs de 3 min 0 s");assert.equal(stepDuration({leftAt:"x",durationMs:2000}),"2 s");});
test("Trace layout keeps ordered nodes and returns repair paths and labelled markers",()=>{const l=traceLayout([{stage:"CHECKING"},{stage:"REVIEWING"},{stage:"REPAIRING"},{stage:"CHECKING"},{stage:"PAUSED"}],[{from:1,to:2,kind:"repair_loop"},{from:3,to:4,kind:"pause"}]);assert.equal(l.nodes.length,5);assert.ok(l.nodes[1].x>l.nodes[0].x);assert.match(l.edges[0].path,/ Q /);assert.equal(l.edges[1].kind,"pause");assert.equal(traceLayout([],[]).width,240);assert.equal(defaultMission([{id:"a",stage:"CANCELLED",updatedAt:"2026-01-02"},{id:"b",stage:"IMPLEMENTING",updatedAt:"2026-01-01"}]).id,"b");});
test("System search matches names and facts without accent sensitivity",()=>{const nodes=[{id:"pc",label:"Mașină",facts:[{label:"Memorie",value:128}]},{id:"hub",label:"Hub",facts:[]}];assert.equal(searchNodes(nodes,"masina")[0].id,"pc");assert.equal(searchNodes(nodes,"128").length,1);assert.equal(searchNodes(nodes,"absent").length,0);assert.equal(searchNodes(nodes,"").length,2);});
test("System unknown booleans and stale checks stay explicit",()=>{assert.equal(yesNo(null),"necunoscut");assert.equal(yesNo(false),"nu");assert.equal(yesNo(true),"da");assert.equal(freshnessWords(null),"niciodată");assert.match(freshnessWords("2026-01-01",Date.parse("2026-01-03")),/vechi/);assert.doesNotMatch(freshnessWords("2026-01-01",Date.parse("2026-01-01T00:05Z")),/vechi/);});
test("The complete 2200 particle figure is finite without nodes and graph equals core",()=>{const t=buildMorphTargets(2200,{nodes:[]});for(const key of ["core","face","graph"])assert.ok(t[key].every(Number.isFinite),key);assert.deepEqual(t.graph,t.core);});
test("Graph nodes still gather particles with the coordinator count fix",()=>{const t=buildMorphTargets(2200,{nodes:[{x:.5,y:.2,z:0,kind:"core"}]});for(const key of ["core","face","graph"])assert.ok(t[key].every(Number.isFinite),key);assert.notDeepEqual(t.graph,t.core);assert.ok(t.graph[0]>.3);});
test("Missing boot IDs never announce a new decision",()=>{assert.equal(newDecisionNotice({},{}),false);assert.equal(newDecisionNotice(null,{}),false);assert.equal(newDecisionNotice({chapters:[]},{bootId:"a",chapters:[]}),false);});

test("Selected screenshot and cooling threshold sync as bounded presentation values only",()=>{assert.deepEqual(sanitizeState({resultShotIndex:2,coolingDays:21}),{resultShotIndex:2,coolingDays:21});assert.deepEqual(sanitizeState({resultShotIndex:-1,coolingDays:366}),{});assert.deepEqual(sanitizeState({resultShotIndex:1.5,coolingDays:"21"}),{});});
test("One repair cycle draws one arc even when the server supplies both adjacent repair edges",()=>{const steps=[{stage:"CHECKING"},{stage:"REVIEWING"},{stage:"REPAIRING"},{stage:"CHECKING"}];const l=traceLayout(steps,[{from:1,to:2,kind:"repair_loop"},{from:2,to:3,kind:"repair_loop"}]);assert.equal(l.edges.length,1);assert.match(l.edges[0].path,/Q/);});
test("No boot evidence means no notice even when a successful read increases decisions",()=>{const snapshot=n=>({chapters:[{indicators:[ind("waiting.decisions",n)]}]});assert.equal(newDecisionNotice(snapshot(1),snapshot(2)),false);assert.equal(newDecisionNotice({...snapshot(1),bootId:"known"},snapshot(2)),false);assert.equal(newDecisionNotice(snapshot(1),{...snapshot(2),bootId:"known"}),false);});

import { visibleRecapContext, recapPlayback, lastSentence } from "../web/src/lib/commandModel.js";
import { traceStepState, isCurrentStep, evidenceText } from "../web/src/lib/factoryTrace.js";
import { systemFields } from "../web/src/lib/systemMap.js";
test("Recap context belongs only to the currently visible recap surface", () => {
 const recap={snapshotId:"rcp_visible",index:2,stopped:false};
 for(const surface of ["command","lega"]) {
  const command={view:"recap",recap,recapShownOn:surface}, hash=surface==="command"?"#/comanda":"#/lega";
  assert.deepEqual(visibleRecapContext(command,hash),{snapshotId:recap.snapshotId,index:2});
  assert.equal(visibleRecapContext({...command,recap:{...recap,stopped:true}},hash),undefined);
  assert.equal(visibleRecapContext({...command,recapShownOn:null},hash),undefined);
  assert.equal(visibleRecapContext(command,"#/sales"),undefined);
 }
 assert.equal(visibleRecapContext({view:"company",recap,recapShownOn:"command"},"#/comanda"),undefined);
 assert.equal(visibleRecapContext({view:"recap",recap,recapShownOn:"lega"},"#/comanda"),undefined);
 assert.equal(visibleRecapContext({view:"recap",recap,recapShownOn:"command"},"#/lega"),undefined);
});
test("Playback requires the selected chapter's live handedOff event and resets across chapters and stop", () => {
 const r={snapshotId:"rcp_a",index:0,stopped:false};
 let s=recapPlayback(undefined,{type:"select",recap:r});
 const level={type:"level",active:true,level:.4};
 assert.equal(recapPlayback(s,level).playback,false);
 assert.equal(recapPlayback(s,{type:"handoff",key:"rcp_other:0",handedOff:true}),s);
 s=recapPlayback(s,{type:"handoff",key:"rcp_a:0",handedOff:false});assert.equal(recapPlayback(s,level).playback,false);
 s=recapPlayback(s,{type:"handoff",key:"rcp_a:0",handedOff:true});
 assert.equal(recapPlayback(s,{...level,active:false}).playback,false);
 assert.equal(recapPlayback(s,{...level,level:.02}).playback,false);
 s=recapPlayback(s,level);assert.equal(s.playback,true);
 s=recapPlayback(s,{type:"select",recap:{...r,index:1}});assert.equal(s.playback,false);assert.equal(s.armed,false);
 assert.equal(recapPlayback(s,{type:"handoff",key:"rcp_a:0",handedOff:true}),s);
 assert.equal(recapPlayback(s,level).playback,false);
 s=recapPlayback(s,{type:"handoff",key:"rcp_a:1",handedOff:true});assert.equal(recapPlayback(s,level).playback,true);
 s=recapPlayback(s,{type:"reset",recap:{...r,index:1}});assert.equal(recapPlayback(s,level).playback,false);
 s=recapPlayback(s,{type:"stop"});assert.equal(s.key,null);assert.equal(s.armed,false);assert.equal(s.playback,false);
});
test("Last sentence has no quotation marks until the owner actually said something",()=>{
 assert.equal(lastSentence(),"Ultima ta frază: —");assert.equal(lastSentence(""),"Ultima ta frază: —");assert.equal(lastSentence("Salut"),"Ultima ta frază: „Salut”");
});
test("Historical factory steps are closed even when their stage name is a live state",()=>{
 const past={stage:"CHECKING",leftAt:"2026-01-01",durationMs:333};
 assert.equal(traceStepState(past,0,3),"closed");assert.equal(stepDuration(past),"sub 1 s");
 assert.equal(traceStepState({...past,stage:"PAUSED"},1,3),"closed");
 const current={stage:"IMPLEMENTING",leftAt:null,at:"2026-01-01"};
 assert.equal(isCurrentStep(current,2,3),true);assert.equal(traceStepState(current,2,3),"run");
 assert.equal(traceStepState(current,0,3),"closed");assert.equal(isCurrentStep({...current,leftAt:undefined},2,3),false);
 assert.equal(durationText(0),"sub 1 s");assert.equal(durationText(999),"sub 1 s");assert.equal(durationText(1000),"1 s");
 assert.equal(evidenceText(0),"fără dovezi");assert.equal(evidenceText(2),"2 dovezi");
});
test("System fields preserve omitted versus explicitly unknown data and relative verification words",()=>{
 assert.deepEqual(systemFields({}),[]);
 assert.deepEqual(systemFields({installed:null,running:true}).map(f=>[f.key,f.value]),[["installed","necunoscut"],["running","da"]]);
 assert.match(systemFields({available:null})[0].label,/verificat niciodată/);
 const at=Date.parse("2026-01-02T12:00:00Z");
 assert.equal(freshnessWords(new Date(at-180000).toISOString(),at),"acum 3 min");
 assert.equal(freshnessWords(new Date(at-7200000).toISOString(),at),"acum 2 h");
 assert.equal(freshnessWords(new Date(at-86400000).toISOString(),at),"acum 24 h · vechi");
});

import { recapExit } from "../web/src/lib/commandModel.js";
test("Leaving a recap stops that snapshot once and never stops a newer snapshot",()=>{
 const recap={snapshotId:"rcp_exit",index:2,stopped:false};
 const stopped=recapExit({recap},recap);assert.deepEqual(stopped,{...recap,stopped:true});
 assert.equal(recapExit({recap:stopped},recap),null);
 assert.equal(recapExit({recap:{...recap,snapshotId:"rcp_new"}},recap),null);
 assert.equal(recapExit({},recap),null);
});

// Round 5 regressions.
import { scheduleCommandRead, commandTransition, sheetReturn, intentSheetPatch, playbackSampling } from "../web/src/lib/commandModel.js";
import { DEPARTMENT_COLORS } from "../web/src/lib/companyGraph.js";
import { systemFact } from "../web/src/lib/systemMap.js";
import fs from "node:fs";
test("R5 freshness uses the current view readAt, even if a different snapshot is fresh", () => {
 const old = new Date(now-180000).toISOString(), fresh = new Date(now-1000).toISOString();
 assert.equal(freshness({snapshot:{generatedAt:fresh,readAt:old},connection:"live",now}).live,false);
 assert.equal(freshness({snapshot:{readAt:fresh},connection:"live",now}).live,true);
 for(const connection of ["offline","connecting","reconnecting"]) assert.doesNotMatch(freshness({snapshot:{readAt:fresh},connection,now}).label,/LIVE/);
 assert.match(freshness({snapshot:{readAt:old},connection:"live",now}).label,/Ultima citire/);
});
test("R5 every Command read debounces events, polls at 60 s, sleeps hidden and reads once on return", () => {
 let count=0,event,visibility,id=0;const jobs=new Map();
 const timers={setInterval:(fn,ms)=>{jobs.set(++id,{fn,ms,interval:true});return id;},clearInterval:id=>jobs.delete(id),setTimeout:(fn,ms)=>{jobs.set(++id,{fn,ms});return id;},clearTimeout:id=>jobs.delete(id)};
 const doc={hidden:false,addEventListener:(_,fn)=>visibility=fn,removeEventListener:()=>visibility=null};
 let unsubscribed=false;const stop=scheduleCommandRead(()=>count++,{doc,timers,subscribe:fn=>{event=fn;return()=>unsubscribed=true;}});
 assert.equal(count,1);assert.equal([...jobs.values()].find(j=>j.interval).ms,60000);
 for(const type of ["factory.stage","sales.changed","delivery.ready","backup.verified"])event({type});
 assert.equal([...jobs.values()].filter(j=>!j.interval).length,1);
 const pending=[...jobs.entries()].find(([,j])=>!j.interval);jobs.delete(pending[0]);pending[1].fn();assert.equal(count,2);
 [...jobs.values()].find(j=>j.interval).fn();assert.equal(count,3);
 doc.hidden=true;visibility();event({type:"factory.stage"});assert.equal(jobs.size,0);assert.equal(count,3);
 doc.hidden=false;visibility();assert.equal(count,4);assert.equal(jobs.size,1);stop();assert.equal(jobs.size,0);assert.equal(unsubscribed,true);
});
test("R5 terminal traces never run a timer; waiting traces say how long they wait", () => {
 const step={stage:"IMPLEMENTING",leftAt:null,at:new Date(now-180000).toISOString()};
 for(const stage of ["CLOSED","ACCEPTED","REJECTED","CANCELLED","OWNER_ACCEPTED"]) {
  assert.equal(isCurrentStep(step,2,3,stage),false);
  assert.equal(traceStepState(step,2,3,stage),"closed");
  assert.equal(stepDuration(step,now,false,stage),"Încheiat · final");
 }
 for(const stage of ["PAUSED","BLOCKED","WAITING_OWNER_DECISION","NEEDS_OWNER_DECISION","SPEC_DRAFT","DELIVERY_READY"]) assert.equal(stepDuration({...step,stage},now,true,stage),"așteaptă de 3 min 0 s");
 assert.equal(stepDuration(step,now,true,"IMPLEMENTING"),"în curs de 3 min 0 s");
});
test("R5 sheet belongs to latest result, explicitly remembers origin, and clears on exit", () => {
 const prev={view:"funnel",from:"department",sheetId:"old"};
 const sheet=commandTransition(prev,{view:"sheet",sheetId:"flow:offer"});assert.equal(sheet.from,"funnel");assert.equal(sheetReturn(sheet),"funnel");
 assert.equal(sheetReturn({from:"department"}),"company");assert.equal(sheetReturn({from:"department",departmentKey:"sales"}),"department");
 for(const view of ["idle","company","department","funnel","trace","result","system","recap"]) {const next=commandTransition(sheet,{view});assert.equal(next.sheetId,null);assert.equal(next.from,null);}
 assert.deepEqual(intentSheetPatch({processSheet:{id:"flow:offer"}},123),{sheetId:"flow:offer",sheetShownAt:123});
 assert.deepEqual(intentSheetPatch({message:"Alt răspuns"},124),{sheetShownAt:null});
});
test("R5 playback sampler is limited to a visible armed chapter", () => {
 assert.equal(playbackSampling({armed:true},false),true);
 for(const [state,hidden] of [[{},false],[{armed:true},true],[{armed:true,playback:true},false]]) assert.equal(playbackSampling(state,hidden),false);
});
test("R5 nine trace nodes wrap at five with edges anchored to their actual endpoints", () => {
 for(const columns of [2,3,5]) {const l=traceLayout(Array.from({length:9},()=>({stage:"CHECKING"})),[{from:3,to:5,kind:"repair_loop"},{from:7,to:8,kind:"resume"}],columns);
 assert.equal(l.nodes.length,9);assert.ok(l.nodes[columns].y>l.nodes[0].y);assert.ok(l.nodes.every(n=>n.x>0&&n.x<l.width&&n.y>0&&n.y<l.height));
 for(const e of l.edges) {assert.ok(e.path.includes(`${l.nodes[e.from].x} ${l.nodes[e.from].y}`));assert.ok(e.path.endsWith(`${l.nodes[e.to].x} ${l.nodes[e.to].y}`));}}
});
test("R5 system ISO facts show Bucharest date/time and preserve other facts", () => {
 assert.equal(systemFact("2026-10-24T23:40:22.084Z"),"25 oct., 02:40");assert.equal(systemFact(12),12);assert.equal(systemFact("10.0.26300"),"10.0.26300");
});
const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const linear = n => n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
const luminance = h => rgb(h).map(linear).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
const lab = h => {const [r,g,b]=rgb(h).map(linear),f=t=>t>216/24389?Math.cbrt(t):t*841/108+4/29;const x=f((r*.4124564+g*.3575761+b*.1804375)/.95047),y=f(r*.2126729+g*.7151522+b*.072175),z=f((r*.0193339+g*.119192+b* .9503041)/1.08883);return [116*y-16,500*(x-y),200*(y-z)];};
const delta = (a,b) => Math.hypot(...lab(a).map((v,i)=>v-lab(b)[i]));
test("R5 twelve department colours satisfy CIE76 distances and all variant contrasts", () => {
 assert.equal(DEPARTMENT_COLORS.length,12);
 for(const [i,c] of DEPARTMENT_COLORS.entries()) {
  for(const other of DEPARTMENT_COLORS.slice(i+1))assert.ok(delta(c,other)>=15,`${c}/${other}`);
  for(const state of ["#E9B56D","#FF8F85","#86DCBB","#65D9FF"])assert.ok(delta(c,state)>=25,`${c}/${state}`);
  for(const bg of ["#0b1622","#05080c","#0a1a3a","#040a1a","#06080b","#0b1520"])assert.ok((luminance(c)+.05)/(luminance(bg)+.05)>=3,`${c}/${bg}`);
 }
});
test("R5 System retains telemetry as first tab, note is beneath form, embedded trace skips mission list", () => {
 const source = name => fs.readFileSync(new URL(`../web/src/${name}`,import.meta.url),"utf8");
 const tabs=source("screens/System.jsx").split("const TABS = [")[1].split("];",1)[0];assert.ok(tabs.indexOf('id: "runs"')<tabs.indexOf('id: "map"'));assert.match(tabs.trim(),/id: "map"[^\n]+,$/);
 assert.match(source("screens/sales/Opportunity.jsx"),/Schimbă starea<\/button>\s*<\/form><p className="muted">/);
 assert.match(source("screens/command/Trace.jsx"),/useRead\(missionId && !onMission \? null : "\/api\/factory"\)/);
});

test("R5 palette CSS is generated from the exported list, not a divergent copy", () => {
 const css=fs.readFileSync(new URL("../web/src/styles/m16.css",import.meta.url),"utf8");assert.doesNotMatch(css,/--dept-\d+\s*:/);
});
