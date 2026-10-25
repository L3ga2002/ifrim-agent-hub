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
 if(view==="company" && width>=1100) { const hits=await page.locator(".radial-map").evaluate(map=>{const m=map.getBoundingClientRect(),core=map.querySelector(".radial-core").getBoundingClientRect(),cards=[...map.querySelectorAll(".department-node")].map(e=>({name:e.querySelector("strong")?.textContent,r:e.getBoundingClientRect()})),cross=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1,out=[];cards.forEach((a,i)=>{if(a.r.left<m.left-1||a.r.right>m.right+1||a.r.top<m.top-1||a.r.bottom>m.bottom+1)out.push(`${a.name} outside the map`);if(cross(a.r,core))out.push(`${a.name} over L3ga`);for(const b of cards.slice(i+1))if(cross(a.r,b.r))out.push(`${a.name} x ${b.name}`);});return out;});assert.deepEqual(hits,[],`company ${width}x${height}: department cards must not overlap`); }
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
    // AC-15: only the owner's variant A (Carbon și cyan) ships; there is no aspect selector.
    assert.equal(await page.locator(".command").getAttribute("data-variant"),"A");assert.equal(await page.getByLabel("Aspect",{exact:true}).count(),0);
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
        shots.push({name:`A-${view}-${width}x${height}.png`,data:await page.screenshot({fullPage:true})});
      }
    }
    // 4:3, 5:4 and tall windows (a second monitor): the department cards shrink with the map and still never overlap.
    for(const [width,height] of [[1100,1080],[1280,1024],[1600,1200]]) { await page.setViewportSize({width,height});await page.evaluate(hash=>{location.hash=hash;},"#/comanda?vedere=company");await page.locator(".department-node").first().waitFor();await commandChecks(page,"company",width,height);shots.push({name:`A-company-${width}x${height}.png`,data:await page.screenshot()}); }
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
