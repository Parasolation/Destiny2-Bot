import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, queryCard } from '../src/commands.js';
import { mergeHistory, activityRow, statTiles, recordState, collectibleState, buildReportCatalog } from '../src/report-data.js';
import { GuardianReports } from '../src/guardian-reports.js';
import { reportHtml } from '../src/report-cards.js';
import { CachedRequests, UserError } from '../src/http.js';
import { DestinyService } from '../src/destiny.js';
const values = o => Object.fromEntries(Object.entries(o).map(([k,v])=>[k,{basic:{value:v}}]));

test('personal report commands preserve optional Bungie names and pagination',()=>{
  assert.deepEqual(parseCommand('<@123> PVP战绩 测试玩家#1234 第2页'),{type:'combat',mode:'pvp',keyword:'测试玩家#1234',page:2});
  for(const cmd of ['PVE','突袭','地牢','试炼','铁旗','智谋','日落','战绩'])assert.equal(parseCommand(cmd).type,'combat');
  assert.deepEqual(parseCommand('称号 第2页'),{type:'records',kind:'titles',keyword:'',page:2});
  assert.equal(parseCommand('周报').type,'weekly');assert.equal(parseCommand('配装').type,'loadout');
});
test('bound report routes use the current user binding and never mutate it',async()=>{
  const binding={membershipId:'123',membershipType:3,displayName:'测试#1234'};let got;
  const services={bindings:{get:async key=>{assert.equal(key,'current');return binding;}},destiny:{reports:{combat:async(...args)=>{got=args;return{title:'ok'};}}}};
  await queryCard(parseCommand('PVP'),services,{userKey:'current'});assert.deepEqual(got,[binding,'pvp',1]);
  services.bindings.get=async()=>null;await assert.rejects(queryCard(parseCommand('PVP'),services,{userKey:'current'}),UserError);
});
test('cross-character history is sorted, deduplicated by string instance ID and not summed',()=>{
  const activity=(id,period,time)=>({activityDetails:{instanceId:id},period,values:values({timePlayedSeconds:time,kills:10})});
  const rows=mergeHistory([{character:{classType:0},activities:[activity('9223372036854775806','2026-10-21T03:00:00Z',20)]},{character:{classType:1},activities:[activity('9223372036854775806','2026-10-21T03:00:00Z',80),activity('9223372036854775807','2026-10-22T03:00:00Z',20)]}]);
  assert.equal(rows.length,2);assert.equal(rows[0].activityDetails.instanceId,'9223372036854775807');assert.equal(rows[1].character.classType,1);assert.equal(rows[1].values.kills.basic.value,10);
});
test('missing stats remain unknown and activity completion is not confused with PvP victory',()=>{
  assert.ok(statTiles(undefined,true).every(x=>x.value==='—'));
  const catalog={activities:{1:{name:'地图'}}};
  const base={activityDetails:{referenceId:1,instanceId:'1',modes:[5]},values:values({completed:1,kills:0})};
  assert.equal(activityRow(base,catalog).badge,'结果未返回');base.values.standing={basic:{value:1}};assert.equal(activityRow(base,catalog).badge,'失败');
  base.activityDetails.modes=[7];assert.equal(activityRow(base,catalog).badge,'已完成');
});
test('record and collectible flags distinguish unknown, concealed, incomplete and complete',()=>{
  const def={hash:'1',scope:0};const profile={profileRecords:{privacy:2,data:{records:{1:{state:4,objectives:[{objectiveHash:2,progress:3,completionValue:5}]}}}}};
  assert.equal(recordState(def,profile,{objectives:{}}).progress[0].value,'3 / 5');
  assert.equal(recordState({hash:'2',scope:0},profile,{objectives:{}}).known,false);
  profile.profileRecords.data.records[1].state=16;assert.equal(recordState(def,profile,{objectives:{}}).hidden,true);
  profile.profileRecords.data.records[1].state=64;assert.equal(recordState(def,profile,{objectives:{}}).status,'可装备称号');
  assert.equal(collectibleState('1',{}).status,'进度未公开');
  assert.equal(collectibleState('1',{profileCollectibles:{data:{collectibles:{1:{state:0}}}}}).acquired,true);
  assert.equal(collectibleState('1',{profileCollectibles:{data:{collectibles:{1:{state:4}}}}}).hidden,true);
});
test('partial history failures are disclosed; all failures are actionable errors',async()=>{
  const destiny={validateMembership(){},cache:new CachedRequests(),api:async path=>{if(path.includes('/bad/'))throw new Error();return {activities:[]};}};
  const service=new GuardianReports(destiny);const player={membershipType:3,membershipId:'1'};
  assert.equal((await service.history(player,[{characterId:'ok'},{characterId:'bad'}])).partial,true);
  await assert.rejects(service.history(player,[{characterId:'bad'}]),UserError);
  await assert.rejects(service.combat(player,'pvp',6),UserError);
});
test('report HTML escapes API text, rejects injected images and includes a demo watermark',()=>{
  const html=reportHtml({title:'<script>evil</script>',demo:true,sections:[{title:'安全',rows:[{title:'<img>',background:'bad',chips:[{text:'<script>',icon:'bad'}]}]}]},new Map([['bad',"data:image/png;base64,x' onerror='evil"]]));
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('onerror='));assert.ok(html.includes('演示数据'));assert.ok(html.includes("default-src 'none'"));
});
test('catalog supplies portable activity and equipment definitions and skips redacted entries',()=>{
  const c=buildReportCatalog({DestinyActivityDefinition:{1:{hash:1,displayProperties:{name:'地牢'},pgcrImage:'/img/destiny_content/pgcr/test.jpg',activityModeTypes:[7,82]}},DestinyInventoryItemDefinition:{2:{hash:2,displayProperties:{name:'机密'},redacted:true}}});
  assert.equal(c.reportCatalog.activities['1'].name,'地牢');assert.deepEqual(c.reportCatalog.items,{});
});
test('PGCR uses HTTPS stats host without enabling arbitrary redirects',async()=>{
  let called;const d=new DestinyService({apiKey:'fixture'},{request:async url=>{called=url;return{ErrorCode:1,Response:{}};}});
  await d.api('/Destiny2/Stats/PostGameCarnageReport/123/');assert.equal(called,'https://stats.bungie.net/Platform/Destiny2/Stats/PostGameCarnageReport/123/');
  await d.api('/Destiny2/Milestones/');assert.ok(called.startsWith('https://www.bungie.net/'));
});
test('populated PvP reports use aggregate stats, actual standings and stable 20-row paging',async()=>{
  const calls=[];const player={membershipId:'1',membershipType:3,displayName:'测试#1234'};
  const catalog={activities:{2:{name:'测试地图'}}};
  const destiny={load:async()=>({reportVersion:1,reportCatalog:catalog}),player:async()=>({player,characters:[{characterId:'9',classType:1}]}),validateMembership(){},cache:new CachedRequests(),api:async path=>{
    calls.push(path);
    if(path.includes('/Activities/'))return {activities:Array.from({length:41},(_,i)=>({period:new Date(Date.UTC(2026,9,24)-i*600000).toISOString(),activityDetails:{instanceId:String(i+1),referenceId:2,modes:[5]},values:values({kills:12,deaths:4,assists:5,standing:i%2,completed:1})}))};
    return {mergedAllCharacters:{results:{allPvP:{allTime:values({activitiesEntered:40,activitiesWon:25,kills:480,deaths:160,assists:200,killsDeathsRatio:3,efficiency:4.25})}}}};
  }};
  const report=await new GuardianReports(destiny).combat(player,'pvp',2);
  assert.equal(report.layout,'pvp-stat-report');assert.equal(report.totals[0].value,'40');assert.equal(report.headline[4].value,'62.50%');
  const rows=report.matches;assert.equal(rows.length,20);assert.equal(rows[0].id,'21');assert.equal(rows[0].result,'胜');assert.equal(rows[1].result,'负');
  assert.ok(calls.some(x=>x.endsWith('?count=41&mode=5&page=0')));
});
