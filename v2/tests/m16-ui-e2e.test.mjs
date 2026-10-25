// M16 browser acceptance: fresh synthetic Hub, fake providers, the project's Playwright Chromium (browserLaunchOptions, the same isolation as
// every browser suite of the gate); needs the fresh UI build (HUB_V2_WEB_DIST or v2/web/dist).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { acceptanceHub, seedReady, settle } from "./accept-helpers.mjs";
import { seedSalesReview } from "./sales-helpers.mjs";
import { demoSpec } from "../server/factory/fixtures.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";
import { HUB_ROOT, WEB_DIST, tempDir } from "./helpers.mjs";
import { idleFigures } from "../web/src/lib/commandModel.js";
import { departmentDetail } from "../web/src/lib/companyGraph.js";
import { browserLaunchOptions, browserStatus } from "../server/tools/browser.mjs";
let pw;
try { pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright"); } catch { /* explicit skip below */ }
const skip = !pw || !browserStatus({ hubRoot: HUB_ROOT }).installed || !fs.existsSync(path.join(WEB_DIST,"index.html")) ? "Playwright (cached Chromium) or the built UI is missing" : false;
const titles = ["Ce te așteaptă","Lucrări","Livrări și rezultate","Vânzări","Birou intern","Sistemul"];
const read = async (page, url) => page.evaluate(async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }, url);
const until = async (fn, message) => { for (let i=0;i<200;i++) { if (await fn()) return; await new Promise(r=>setTimeout(r,50)); } assert.fail(message); };
const fingerprint = (hub) => Object.fromEntries(["agent_runs","mission_envelopes","ops_plans","approvals"].map(table=>[table,hub.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
const typed = async (page, text) => { const input=page.getByRole("textbox",{name:"Mesaj pentru Lega"}); await input.fill(text); await input.press("Enter"); };

const forbidden = /accept|aprob|confirm|pornește misiunea|trimite|publică|regenerează|randează/i;
async function commandChecks(page, view, width, height) {
 assert.equal(await page.locator(".command").getByRole("button",{name:forbidden}).count(),0,`${view}: no business action`);
 const stop=page.getByRole("button",{name:/Stop All/});assert.equal(await stop.isVisible(),true);if(width>=1100) assert.equal(await stop.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth;}),true,"Stop All reachable");
 if(view==="recap" && [1920,1440,1280].includes(width)) assert.equal(await page.locator(".command-recap .command-controls").evaluate(e=>e.getBoundingClientRect().bottom<=e.closest(".command-stage").getBoundingClientRect().bottom),true,`recap controls fit ${width}x${height}`);
 if(view==="system") assert.doesNotMatch(await page.locator(".system-nodes").innerText(),/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
 if(view==="department" && width>=1100) assert.equal(await page.locator(".command-department").evaluate(e=>{const stage=e.closest(".command-stage").getBoundingClientRect();return [...e.querySelectorAll(".sheet-sections > section")].every(x=>x.getBoundingClientRect().bottom<=stage.bottom);}),true,"department summaries fit without scrolling");
 if(view==="company" && width>=1100) assert.equal(await page.locator(".radial-map").evaluate(e=>{const stage=e.closest(".command-stage").getBoundingClientRect();return [...e.querySelectorAll(".department-label,.command-source")].every(x=>x.getBoundingClientRect().bottom<=stage.bottom);}),true,"map captions fit");
 if(view==="trace" && width===1920) assert.equal(await page.locator(".trace-nodes > li").evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect(),stage=e.closest(".command-stage").getBoundingClientRect();return r.left>=stage.left&&r.right<=stage.right+1&&r.top>=stage.top&&r.bottom<=stage.bottom;})),true,"all nine trace steps inside visible stage");
}
test("M16 round 3: Command, recap, configured graph, sheets and GET-only TV", { skip, timeout:300000 }, async (c) => {
  const profile={enabled:true,version:1,id:"dev_m16_ui",...machineIdentity()};
  const t=await acceptanceHub({devProfile:()=>profile,fakeProviders:{codex:"ok",claude:"ok"}});
  let browser; const shots=[]; const errors=[]; let tv;
  try {
    await seedReady(t);
    const prepared=(await t.hub.commands.dispatch({type:"factory.prepare",channel:"test",actor:"test",payload:{projectId:t.project.id,...demoSpec("bug-demo"),limits:{writerModel:"gpt-fake-sol",reviewerModel:"sonnet"}}})).result;
    t.hub.db.prepare("UPDATE factory_missions SET stage='IMPLEMENTING' WHERE mission_id=?").run(prepared.mission.id);
    const sales=await seedSalesReview(t);
    const history=["BASELINE","IMPLEMENTING","CHECKING","REVIEWING","REPAIRING","CHECKING","REVIEWING","PAUSED","IMPLEMENTING"];
    for (const [index,stage] of history.entries()) t.hub.bus.append({type:"factory.stage",scopeType:"mission",scopeId:prepared.mission.id,source:"test",payload:{stage,reason:stage==="REPAIRING"?"Ciclul 1/2":"Test M16"}});

    const at=new Date().toISOString();
    t.hub.db.prepare("INSERT INTO desk_records (id,kind,department,internal_no,title,status,root_plan_id,root_plan_hash,synthetic,created_by,created_at,updated_at) VALUES ('dsk_m16','support_case','customer-success','SUP-M16','Cerere sintetică','PLANNED','m16_seed','hash',1,'test',?,?)").run(at,at);
    await settle();
    const before=fingerprint(t.hub),origin=`http://localhost:${t.config.port}`;
    browser=await pw.chromium.launch({...browserLaunchOptions(origin)});
    const context=await browser.newContext({viewport:{width:1920,height:1080},locale:"ro-RO"});
    const page=await context.newPage();page.setDefaultTimeout(20000);page.on("pageerror",e=>errors.push(e.message));
    await page.goto(`${origin}/#/lega`);
    await page.locator(".lega-one").waitFor();
    await until(async()=>Boolean((await read(page,"/api/owner/status")).session),"development owner session opens");
    await page.locator(".lega-more > summary").click();
    await page.getByRole("button",{name:"Mod Comandă (Alt+C)",exact:true}).click();
    await page.locator(".command-clock").waitFor();
    assert.equal(await page.locator(".command-corners .command-indicator").count(),3);
    const now=await read(page,"/api/recap?period=now");
    for(const i of Object.values(idleFigures(now))) {
      const card=page.locator(`[data-indicator="${i.id}"]`);
      assert.equal(await card.locator(".indicator-value").innerText(),i.display);
      assert.deepEqual(await card.locator(".command-badge").allTextContents(), i.provenance==="synthetic"?["SINTETIC"]:i.provenance==="mixed"?["REAL + SINTETIC"]:[]);
    }
    assert.match(await page.locator(".command-date").innerText(),/\d{4}/);
    await page.keyboard.press("Escape");await until(()=>page.url().endsWith("#/lega"),"Esc returns to Lega");
    await page.locator(".lega-one .face-controls").waitFor();
    for(const label of ["Nucleu","Față","Hartă","Discret","Ascunde","Ecran complet"])assert.ok(await page.getByRole("button",{name:label,exact:true}).count(),label);
    await page.keyboard.press("Alt+c");await page.locator(".command").waitFor();
    await page.keyboard.press("Alt+c");await page.locator(".lega-one").waitFor();
    await typed(page,"L3ga, mod comandă");await page.locator(".command").waitFor();
    tv=await context.newPage();const requests=[];
    tv.on("request",r=>requests.push({method:r.method(),url:r.url()}));tv.on("pageerror",e=>errors.push(e.message));
    await tv.addInitScript(()=>{window.__m16MicCalls=0; if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=async()=>{window.__m16MicCalls++;throw new Error("TV must not request media");};});
    await tv.goto(`${origin}/#/comanda?ecran=tv`);await tv.locator(".command").waitFor();
    await page.getByRole("button",{name:"Ascunde cifrele",exact:true}).click();
    for(const window of [page,tv]) { await until(async()=>await window.locator('.command').getAttribute('data-hide-numbers')==="true","hide numbers synced"); assert.doesNotMatch(await window.locator(".command-corners").innerText(),/\d/); }
    await page.getByRole("button",{name:"Arată cifrele",exact:true}).click();
    await page.keyboard.press("Escape");await page.locator(".lega-one").waitFor();
    let recapResponse;
    const received=page.waitForResponse(r=>r.url().includes("/api/owner/intent")&&r.request().method()==="POST");
    await typed(page,"Ce s-a întâmplat azi?");recapResponse=await (await received).json();
    const snap=recapResponse.results.find(r=>r.recap)?.recap.snapshot;
    assert.ok(snap,"intent returns a stored recap");assert.deepEqual(snap.chapters.map(c=>c.title),titles);
    await page.locator(".recap-card").getByRole("heading",{name:/Capitolul 1 din 6/}).waitFor();
    for(const i of snap.chapters[0].indicators) assert.ok((await page.locator(".recap-card").innerText()).includes(i.display),i.id);
    await typed(page,"următorul");await page.locator(".recap-card").getByRole("heading",{name:/Capitolul 2 din 6/}).waitFor();
    await page.locator(".recap-card").getByRole("button",{name:"Mod Comandă",exact:true}).click();
    // Leaving the Lega route ends its recap; Command starts a fresh visible recap.
    await page.getByRole("heading",{name:/Capitolul 1 din 6/}).waitFor();
    await tv.getByRole("heading",{name:/Capitolul 1 din 6/}).waitFor();
    await page.keyboard.press("ArrowRight");await page.getByRole("heading",{name:/Capitolul 2 din 6/}).waitFor();
    await page.keyboard.press("ArrowLeft");await page.getByRole("heading",{name:/Capitolul 1 din 6/}).waitFor();
    const graph=await read(page,"/api/company/graph");assert.equal(graph.departments.length,12);
    await page.keyboard.press("3");await page.locator(".radial-map").waitFor();
    assert.deepEqual(await page.locator(".department-node strong").allTextContents(),graph.departments.map(d=>({executive:"EX",product:"PR",engineering:"EN","qa-security":"QA",devops:"DO",sales:"VZ",marketing:"MK","customer-success":"CS","project-management":"PM",operations:"OP",research:"CE","finance-admin":"FA"})[d.key]));
    for(const d of graph.departments.filter(d=>d.status==="planned"))assert.match(await page.locator(".department-node").nth(graph.departments.indexOf(d)).innerText(),/planificat/);
    await page.getByRole("button",{name:"Decor: pornit",exact:true}).click();assert.equal(await page.locator(".decor").count(),0);
    const first=page.locator(".department-node").first();await first.focus();await first.press("Enter");await page.locator(".command-department").waitFor();await tv.locator(".command-department").waitFor();
    const detail=departmentDetail(graph,graph.departments[0].key),panel=await page.locator(".command-department").innerText();
    for(const x of [...detail.roles.slice(0,2),...detail.skills.slice(0,3),...detail.tools.slice(0,3)])assert.ok(panel.includes(x.name),x.name);
    await page.keyboard.press("ArrowLeft");await page.locator(".command-department h2").getByText(graph.departments.at(-1).labelRo,{exact:true}).waitFor();
    await page.keyboard.press("ArrowRight");await page.locator(".command-department h2").getByText(graph.departments[0].labelRo,{exact:true}).waitFor();
    // Find a configured skill by its graph edges, never fabricate membership from department strings.
    const skillDept=graph.departments.find(d=>departmentDetail(graph,d.key).skills.length);
    assert.ok(skillDept,"seed contains a configured skill");
    await page.locator(".command-departments .department-row").nth(graph.departments.indexOf(skillDept)).click();
    const skill=departmentDetail(graph,skillDept.key).skills[0];await page.locator(".command-department").getByRole("button",{name:skill.name,exact:true}).click();await page.locator(".command-sheet").waitFor();
    assert.match(await page.locator(".command-sheet").innerText(),/nicio autoritate acordată/);
    await page.keyboard.press("Escape");await page.locator(".command-department").waitFor();
    await page.keyboard.press("Escape");await page.locator(".command-company").waitFor();
    await page.keyboard.press("Escape");await page.locator(".command-clock").waitFor();
    await page.keyboard.press("Escape");await page.locator(".lega-one").waitFor();
    await typed(page,"Arată fișa ofertei");await page.locator(".sheet-card, .command-sheet").first().waitFor();
    if (!page.url().includes("#/comanda")) {
      await page.getByRole("button",{name:"Închide fișa",exact:true}).click();assert.equal(await page.locator(".sheet-card").count(),0);
      await page.keyboard.press("Alt+c");
    }await page.locator(".command").waitFor();
    await page.keyboard.press("4");await page.locator(".command-funnel").waitFor();
    const funnel=await read(page,"/api/sales/funnel?threshold=21");
    for(const stage of [...funnel.stages,...funnel.side])assert.equal(await page.locator(`[data-stage="${stage.status}"] .funnel-circle`).innerText(),String(stage.count));
    assert.equal(await page.locator(".funnel-conversion").filter({hasText:"Date insuficiente"}).count(),funnel.conversions.length);
    await page.keyboard.press("5");await page.locator(".command-trace").waitFor();
    await page.getByLabel("Lucrare",{exact:true}).selectOption(prepared.mission.id);
    await page.locator('[data-edge="pause"]').waitFor({state:"attached"});
    assert.equal(await page.locator('[data-edge="repair_loop"]').count(),1);
    await page.getByLabel("Lucrare",{exact:true}).blur();
    await page.keyboard.press("6");await page.locator(".command-result").getByText(/Captura lipsește/).waitFor();
    assert.equal(await page.locator(".command-result").getByRole("button",{name:/accept|aprob|pornește/i}).count(),0);
    await page.keyboard.press("7");await page.locator(".system-node").first().waitFor();
    assert.equal(await page.locator(".system-node").count(),9);
    const mapRequestCount=[];page.on("request",r=>{if(r.url().endsWith("/api/system/map"))mapRequestCount.push(r.url());});
    await page.getByLabel("Caută în sistem",{exact:true}).fill("Codex");assert.equal(await page.locator(".system-node").count(),1);
    assert.equal(mapRequestCount.length,0);await page.getByLabel("Caută în sistem",{exact:true}).fill("");
    // Editing keeps digits and does not switch the selected view.
    await page.getByRole("button",{name:"Scrie",exact:true}).click();await page.getByLabel("Mesaj pentru Lega").fill("1234567");
    assert.equal(await page.locator(".command-system").count(),1);await page.getByLabel("Mesaj pentru Lega").press("Escape");assert.equal(await page.getByLabel("Mesaj pentru Lega").count(),0);assert.equal(await page.locator(".command-system").count(),1);
    // Direct recap route builds a snapshot in a fresh context with no previous recap.
    const fresh=await context.newPage();await fresh.goto(`${origin}/#/comanda?vedere=rezumat`);await fresh.locator(".recap-title").waitFor();await fresh.close();
    await page.goto(`${origin}/#/sales?tab=opp&id=${sales.oppId}`);
    await page.getByText("Aici doar se înregistrează; nu se trimite nimic.",{exact:true}).first().waitFor();
    await page.goto(`${origin}/#/comanda`);await page.locator(".command").waitFor();
    const sizes=[[1920,1080],[1440,900],[1280,800],[3840,2160],[390,844]];
    const views=["idle","recap","company","department","sheet","funnel","trace","result","system"];
    for(const variant of ["A","B","C"]) {
      await page.locator(".command-bar details summary").click();await page.getByLabel("Aspect",{exact:true}).selectOption(variant);await page.locator(".command-bar details summary").click();
    for(const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      for(const view of views) {
        // Real navigation through the public route; department/sheet use ids actually returned by the graph/sheets routes.
        const params=new URLSearchParams({vedere:view,departmentKey:skillDept.key,sheetId:"flow:offer"});
        await page.evaluate(hash=>{location.hash=hash;},`#/comanda?${params}`);
        await page.locator(`.command-stage[aria-label]`).waitFor();
        await until(async()=>await page.locator(".command-stage").getAttribute("aria-label")===( {idle:"Repaus",recap:"Rezumat",company:"Companie",department:"Departament",sheet:"Fișă de proces",funnel:"Vânzări",trace:"Traseul lucrării",result:"Rezultat",system:"Sistem"})[view],`view ${view}`);
        if(view==="funnel") await page.locator(".funnel-circle").first().waitFor();
        if(view==="system") await page.locator(".system-node").first().waitFor();
        if(view==="trace") await page.locator(".trace-drawing").waitFor();
        if(view==="result") await page.locator(".result-shot").waitFor();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${view} ${width}: horizontal overflow`);
        if(width===1920 || width===3840) {
          const small=await page.evaluate(()=>{const root=document.querySelector(".command"),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),out=[];let n;while((n=walker.nextNode())){const e=n.parentElement;if(!n.textContent.trim()||e.closest(".sr-only")||!e.getClientRects().length)continue;const style=getComputedStyle(e);if(style.visibility==="hidden"||style.display==="none")continue;if(parseFloat(style.fontSize)<21.99)out.push({text:n.textContent,size:style.fontSize});}return out;});
          assert.deepEqual(small,[],`${view}: text is at least 22 px`);
        }
        await commandChecks(page,view,width,height);
        shots.push({name:`${variant}-${view}-${width}x${height}.png`,data:await page.screenshot({fullPage:true})});
      }
    }
    }
    for(const variant of ["A","B","C"]) { await page.locator(".command-bar details summary").click();await page.getByLabel("Aspect",{exact:true}).selectOption(variant);await page.locator(".command-bar details summary").click();shots.push({name:`variant-${variant}.png`,data:await page.screenshot({fullPage:true})}); }
    await page.setViewportSize({width:1920,height:1080});
    await page.goto(`${origin}/#/comanda?vedere=trace`);await page.getByLabel("Lucrare",{exact:true}).selectOption(prepared.mission.id);
    t.hub.db.prepare("UPDATE factory_missions SET stage='CLOSED' WHERE mission_id=?").run(prepared.mission.id);
    t.hub.bus.emit({type:"factory.stage",scopeType:"mission",scopeId:prepared.mission.id,source:"test",payload:{stage:"CLOSED"}}); // emit = append + publish (the page refreshes on the streamed event)
    await page.locator(".trace-nodes > li").last().getByText("Încheiat · final",{exact:true}).waitFor();
    const disconnected=await context.newPage();await disconnected.route("**/api/stream**",r=>r.abort());await disconnected.goto(`${origin}/#/comanda?vedere=system`);await disconnected.locator(".system-node").first().waitFor();assert.doesNotMatch(await disconnected.locator(".command-status").innerText(),/LIVE/);await disconnected.close();
    assert.deepEqual(fingerprint(t.hub),before,"view/recap operations create no business work");
    assert.deepEqual(requests.filter(r=>r.method!=="GET"),[],"TV sends only GET, including bootstrap and navigation");
    assert.equal(await tv.evaluate(()=>window.__m16MicCalls),0);
    await page.close();await tv.getByText(/Fereastra principală s-a închis:/).waitFor();
    assert.deepEqual(errors,[]);t.assertPaths();
  } finally {
    try { await browser?.close(); } finally { await t.cleanup(); }
    // The acceptance helper's write fence has now been released; evidence is copied outside the disposable Hub.
    const dir=process.env.M16_EVIDENCE_DIR || tempDir("m16-ui-e2e");fs.mkdirSync(dir,{recursive:true});for(const shot of shots)fs.writeFileSync(path.join(dir,shot.name),shot.data);
  }
});

// Supplemental visual probe: mocked HTTP data, never substitutes for the isolated-Hub acceptance above.
// Opt in on restricted hosts where acceptanceHub cannot resolve the host's ancestors.
import http from "node:http";
import { funnelOf } from "../server/sales/funnel.mjs";
import { traceOf } from "../server/factory/trace.mjs";
test("M16 presentation fixture: layout and read-only P1 views (MOCKED API)", {skip:skip||!process.env.M16_LAYOUT_FIXTURE,timeout:300000}, async()=>{
 const now=new Date().toISOString(),dir=tempDir("m16-layout-r5");fs.mkdirSync(dir,{recursive:true});
 const depts=[['executive','Conducere','EX'],['product','Produs și strategie','PR'],['engineering','Engineering','EN'],['qa-security','Calitate și securitate','QA'],['devops','DevOps și infrastructură','DO'],['sales','Vânzări','VZ'],['marketing','Marketing și growth','MK'],['customer-success','Relația cu clienții','CS'],['project-management','Managementul proiectelor','PM'],['operations','Operațiuni','OP'],['research','Cercetare','CE'],['finance-admin','Financiar și administrativ','FA']];
 const graph={readAt:now,company:{name:"Hub sintetic · probă vizuală"},departments:depts.map(([key,labelRo],i)=>({key,labelRo,name:labelRo,purpose:"Structură configurată",status:[0,2,5].includes(i)?"active":"planned",color:i+1,counts:{roles:0,works:i===2?2:0,blocked:0,waiting:i===2?1:0,runningNow:0}})),roles:[],skills:[],tools:[],works:[],edges:[]};
 // Overflow fixture: summaries must account for omitted configured items.
 for(let i=0;i<6;i++) {
   graph.roles.push({id:`role_${i}`,name:`Rol de vânzări ${i}`,authority:"READ_ONLY",reportsTo:"owner",runningNow:0,responsibilities:["Cercetare cu dovezi","Verificarea domeniului","Ciorne","Fără trimitere"]});
   graph.edges.push({from:"dept:sales",to:`role:role_${i}`,kind:"dept_role"});
   graph.tools.push({id:`tool_${i}`,name:`Unealtă ${i}`,status:"unregistered"});
   graph.edges.push({from:`role:role_${i}`,to:`tool:tool_${i}`,kind:"role_tool"});
 }
 const indicator=(id,label,value)=>({id,label,value,display:String(value),state:value?"value":"zero",applies:"now",source:"Hub sintetic",sourceKey:"fixture",readAt:now,provenance:"none"});
 const snapshot={id:"rcp_layout",generatedAt:now,lastSeq:1,period:{kind:"today",label:"Azi, de la 00:00 la 03:00 — compania"},chapters:titles.map((title,i)=>({key:["waiting","work","results","sales","desk","system"][i],title,index:i,indicators:i===0?[{...indicator("waiting.decisions","Decizii",3),provenance:"synthetic",split:{real:0,synthetic:3}},indicator("waiting.blocked","Blocaje",0)]:i===1?[{...indicator("work.active","În lucru acum",3),display:"1 real + 2 sintetice",provenance:"mixed",split:{real:1,synthetic:2}}]:[],sentences:[i===1?"Date de test: 1 lucrare e în lucru acum. Azi: nicio lucrare nu a ajuns gata de livrare, niciun model nu a rulat.":"Te așteaptă trei decizii."],open:{view:null,path:"/lega"}}))};
 const funnel=funnelOf({opportunities:[{id:"opp_layout",title:"Ofertă sintetică",orgName:"Firmă de test",status:"READY_FOR_OWNER_REVIEW",synthetic:1,updated_at:now}],now:new Date(now)});
 const stages=["BASELINE","IMPLEMENTING","CHECKING","REVIEWING","REPAIRING","CHECKING","REVIEWING","PAUSED","IMPLEMENTING"];
 const trace=traceOf({mission:{missionId:"m_layout",title:"Lucrare sintetică",stage:"IMPLEMENTING",repairCycles:1,limits:{maxRepairCycles:2}},events:stages.map((stage,i)=>({seq:i,type:"factory.stage",created_at:new Date(Date.now()-(9-i)*60000).toISOString(),source:"test",payload:{stage,reason:stage==="REPAIRING"?"Ciclul 1/2":""}}))});
 const system={readAt:now,nodes:["pc","hub","db","backups","schedules","runner","codex","claude","voice"].map(id=>({id,label:id==="codex"?"Codex":id,state:"unknown",stateText:"Necunoscut",installed:null,configured:null,available:null,running:null,facts:[{label:"Observație",value:"Nicio verificare"}],source:"fixture",checkedAt:null})),edges:[{from:"pc",to:"hub"},...["db","backups","schedules","runner","codex","claude","voice"].map(to=>({from:"hub",to}))]};
 delete system.nodes[0].installed;delete system.nodes[0].configured;system.nodes[0].running=true;system.nodes[1].checkedAt=new Date(Date.now()-7200000).toISOString();
 const sheets={readAt:now,autonomy:{levels:[{level:"OBSERVE",label:"Observ"},{level:"ASSISTED",label:"Asistat"},{level:"TRUSTED",label:"De încredere"},{level:"HIGH_AUTONOMY_BOUNDED",label:"Autonomie mare, delimitată"}],project:null,defaultRule:"Fără proiect selectat"},alwaysOff:[{effect:"deploy",label:"Deploy",rule:"mereu oprit"}],sheets:[{id:"flow:offer",title:"Ofertă comercială",kind:"flow",what:"Pregătește oferta din brief.",takesOff:"Structurarea ofertei.",ownerRole:"proprietar",who:[{roleId:"sales",name:"Sales Assistant"}],steps:[{title:"Confirmi brief-ul",ref:"fixture"}],tools:[],autonomy:{max:{level:"HIGH_AUTONOMY_BOUNDED"}},result:{label:"Dosarul local",path:"/sales"},refs:[]}]};
 const delivery={delivery:{id:"d_layout",title:"Rezultat sintetic",projectId:"p_layout",projectName:"Proiect de test"},preview:{shots:[]},software:{spec:{version:1},bundle:{shaPrefix:"abcdef123456"},criteria:[{id:"AC-01"}]},summary:{sections:[{text:"Rezultat păstrat în Hub."}],warnings:["Verificare sintetică"]},observations:[],clip:{}};
 const server=http.createServer((req,res)=>{const requested=path.resolve(WEB_DIST,decodeURIComponent(req.url.split("?")[0]).replace(/^\//,""));const file=requested.startsWith(WEB_DIST)&&fs.existsSync(requested)&&fs.statSync(requested).isFile()?requested:path.join(WEB_DIST,"index.html");res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
 try {
 browser=await pw.chromium.launch({...browserLaunchOptions(origin)});const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/**",async route=>{const u=new URL(route.request().url()),p=u.pathname;let value={};
 if(p==="/api/state")value={lastSeq:1,activeRuns:[],settings:{},projects:[]};else if(p==="/api/session")value={token:"fixture",bootId:"layout",contract:21};else if(p==="/api/owner/status")value={devProfile:{enabled:true},session:{authority:"local_dev_profile"},policy:{active:false}};else if(p==="/api/company/graph")value=graph;else if(p==="/api/process-sheets")value=sheets;else if(p.startsWith("/api/recap"))value=p.endsWith("/present")?{voice:{requested:false,handedOff:false,reason:"voice_off"}}:snapshot;else if(p==="/api/sales/funnel")value=funnel;else if(p==="/api/factory")value={missions:[{id:"m_layout",title:"Lucrare sintetică",stage:"IMPLEMENTING",updatedAt:now}]};else if(p.endsWith("/trace"))value=trace;else if(p==="/api/system/map")value=system;else if(p==="/api/deliveries")value={deliveries:[{id:"d_layout",status:"READY",updatedAt:now}]};else if(p==="/api/deliveries/d_layout")value=delivery;else if(p==="/api/projects")value={projects:[{id:"p_layout",name:"Proiect de test",source:"hub-test"}]};
 await route.fulfill({status:200,contentType:"application/json",headers:{"x-hub-contract":"21","x-hub-boot-id":"layout"},body:JSON.stringify(value)});});
 await page.goto(`${origin}/#/comanda`);await page.locator(".command-clock").waitFor();
 assert.equal(await page.locator(".command").evaluate(e=>getComputedStyle(e).fontSize),"22px");
 await page.locator(".dev-profile-badge").waitFor();
 assert.equal(await page.locator(".dev-profile-badge").evaluate(e=>getComputedStyle(e).top),"8px");
 assert.equal(await page.locator(".dev-profile-badge").evaluate(e=>e.getBoundingClientRect().height<40),true,"inline bottom no longer stretches the badge over the bar");
 assert.equal(await page.locator(".department-row").count(),12);
 assert.equal(await page.locator(".command-departments").evaluate(e=>e.scrollHeight<=e.clientHeight),true);
 for(const variant of ["A","B","C"]) {
 await page.locator(".command-bar details summary").click();await page.getByLabel("Aspect",{exact:true}).selectOption(variant);await page.locator(".command-bar details summary").click();
 for(const [width,height] of [[1920,1080],[1440,900],[1280,800],[3840,2160],[390,844]]) {
 await page.setViewportSize({width,height});
 for(const view of ["idle","recap","company","department","sheet","funnel","trace","result","system"]){
 await page.evaluate(view=>{location.hash=`#/comanda?vedere=${view}&departmentKey=sales&sheetId=flow:offer`;},view);
 const selector={idle:".command-clock",recap:".recap-title",company:".radial-map",department:".command-department",sheet:".command-sheet",funnel:".funnel-circle",trace:".trace-drawing",result:".result-shot",system:".system-node"}[view];await page.locator(selector).first().waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${variant}/${view}/${width}: no horizontal page scroll`);
 assert.equal(await page.locator(".command").evaluate(e=>e.scrollWidth<=e.clientWidth),true,`${variant}/${view}/${width}: no command horizontal overflow`);
 if(width===1920 || width===3840) {
  const small=await page.locator(".command").evaluate(root=>{const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),out=[];let n;while(n=w.nextNode()){const e=n.parentElement;if(!n.textContent.trim()||e.closest(".sr-only")||!e.getClientRects().length)continue;const c=getComputedStyle(e);if(c.display!=="none"&&c.visibility!=="hidden"&&parseFloat(c.fontSize)<21.99)out.push([n.textContent,c.fontSize]);}return out;});assert.deepEqual(small,[],`${variant}/${view}/${width}: 22px minimum`);
  assert.equal(await page.locator(".department-row").last().evaluate(e=>e.getBoundingClientRect().bottom<=e.parentElement.getBoundingClientRect().bottom),true,`${variant}/${view}: last department fits`);
  assert.equal(await page.locator(".department-code").evaluateAll(es=>es.every(e=>getComputedStyle(e).whiteSpace==="nowrap"&&e.getBoundingClientRect().height<parseFloat(getComputedStyle(e).fontSize)*1.6)),true);
 }
 if(view==="idle") {
  assert.equal(await page.locator('[data-indicator="waiting.decisions"] .indicator-value').innerText(),"3");
  assert.equal(await page.locator('[data-indicator="waiting.decisions"] .command-badge').innerText(),"SINTETIC");
  assert.equal(await page.locator('[data-indicator="waiting.decisions"] .indicator-split').count(),0);
  assert.equal(await page.locator('[data-indicator="work.active"] .indicator-value').innerText(),"1 real + 2 sintetice");
  assert.equal(await page.locator('[data-indicator="work.active"] .command-badge').innerText(),"REAL + SINTETIC");
  assert.match(await page.locator('.command-bar').innerText(),/Ultima ta frază: —/);
 }
 if(view==="company") {
  const en=page.locator('.department-node').filter({hasText:"Engineering"});
  assert.equal(await en.locator('.department-orb > strong').innerText(),"EN");
  assert.equal(await en.locator('.dept-counts > span').count(),2);
  assert.equal(await en.locator('.department-orb').evaluate(orb=>{const a=orb.getBoundingClientRect(),b=orb.querySelector('strong').getBoundingClientRect(),badge=orb.querySelector('.dept-counts').getBoundingClientRect();return b.top>=a.top&&b.bottom<=a.bottom&&badge.right>a.right;}),true);
  const offsets=await page.locator('.department-node.planned').evaluateAll(es=>es.map(e=>e.querySelector('.command-source').getBoundingClientRect().top-e.querySelector('.department-label').getBoundingClientRect().bottom));
  assert.ok(Math.max(...offsets)-Math.min(...offsets)<1,"planned status uses a consistent gap");
 }
 if(view==="trace") {
  assert.equal(await page.locator('.trace-nodes > li').count(),9);
  assert.equal(await page.locator('.trace-nodes .st-closed').count(),8);
  assert.equal(await page.locator('.trace-nodes > li').last().locator('.st-run').count(),1);
  assert.match(await page.locator('.trace-nodes > li').first().innerText(),/Încheiat/);
  assert.match(await page.locator('.trace-nodes > li').first().innerText(),/fără dovezi/);
  assert.ok(await page.locator('.trace-marker.pause').count());assert.ok(await page.locator('[data-edge="resume"]').count());

 }
 if(view==="department") assert.ok(await page.locator(".department-more").count(),"overflow is counted explicitly");
 if(view==="funnel") assert.equal(await page.getByText("Nicio oportunitate în această listă.",{exact:true}).count(),2);
 if(view==="system") {
  assert.equal(await page.locator('.system-nodes svg').count(),0);
  assert.equal(await page.locator('.system-diagram .system-chip').count(),9);
  assert.equal(await page.locator('[data-node="pc"] [data-field="installed"]').count(),0);
  assert.equal(await page.locator('[data-node="pc"] [data-field="configured"]').count(),0);
  assert.equal(await page.locator('[data-node="pc"] [data-field="available"] dd').innerText(),"necunoscut");
  assert.match(await page.locator('[data-node="hub"] .command-source').innerText(),/verificat acum 2 h/);
 }
 await commandChecks(page,view,width,height);
 await page.screenshot({path:path.join(dir,`${variant}-${view}-${width}x${height}.png`)});
 }
 }
 }

 assert.equal(await page.locator(".system-node").count(),9);await page.getByLabel("Caută în sistem").fill("Codex");assert.equal(await page.locator(".system-node").count(),1);await page.getByLabel("Caută în sistem").fill("");
 for(const variant of ["A","B","C"]){await page.goto(`${origin}/#/comanda`);await page.locator(".command-bar details summary").click();await page.getByLabel("Aspect",{exact:true}).selectOption(variant);await page.locator(".command-bar details summary").click();await page.screenshot({path:path.join(dir,`variant-${variant}.png`)});}

 await page.setViewportSize({width:1920,height:1080});
 await page.goto(`${origin}/#/comanda?vedere=company`);await page.locator(".radial-map").waitFor();
 assert.equal(await page.locator('.department-node[tabindex="0"]').count(),1);
 await page.locator('.department-node[tabindex="0"]').focus();await page.keyboard.press("ArrowRight");
 assert.equal(await page.locator('.department-node[tabindex="0"]:focus').count(),1);await page.keyboard.press("Enter");await page.locator(".command-department").waitFor();
 await page.getByRole("button",{name:"Scrie",exact:true}).click();await page.getByLabel("Mesaj pentru Lega").fill("123");await page.keyboard.press("Escape");assert.equal(await page.getByLabel("Mesaj pentru Lega").count(),0);assert.equal(await page.locator(".command-department").count(),1);
 trace.current.stage="CLOSED";
 await page.goto(`${origin}/#/comanda?vedere=trace`);await page.locator(".trace-nodes > li").last().getByText("Încheiat · final",{exact:true}).waitFor();assert.equal(await page.locator(".trace-nodes .st-run").count(),0);
 delivery.preview.shots=[{src:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><rect width='400' height='300' fill='navy'/></svg>",viewportLabel:"Desktop",criterion:"AC-01"}];
 await page.goto(`${origin}/#/comanda?vedere=result`);const zoom=page.getByRole("button",{name:"Mărește captura Desktop"});await zoom.click();
 const dialog=page.getByRole("dialog",{name:"Captură mărită"});assert.equal(await dialog.getAttribute("aria-modal"),"true");assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true);
 await page.keyboard.press("Tab");assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true);await page.keyboard.press("Shift+Tab");assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true);await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);assert.equal(await zoom.evaluate(e=>e===document.activeElement),true);
 await page.route("**/api/stream**",r=>r.abort());await page.reload();await page.locator(".command-status").waitFor();assert.doesNotMatch(await page.locator(".command-status").innerText(),/LIVE/);
 console.log(`M16 supplemental fixture evidence: ${dir}`);
 assert.deepEqual(errors,[]);
 } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
