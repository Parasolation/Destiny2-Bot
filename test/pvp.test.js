import test from 'node:test';
import assert from 'node:assert/strict';
import { pvpOverview, pvpWeaponTypes, pvpRecentSummary, pvpRecentWeapons, pvpMatchRow } from '../src/pvp-data.js';
import { pvpHtml, pvpImagePaths } from '../src/pvp-card.js';
import { GuardianReports } from '../src/guardian-reports.js';
import { CachedRequests } from '../src/http.js';
const values=o=>Object.fromEntries(Object.entries(o).map(([k,n])=>[k,{basic:{value:n}}]));

test('PvP KDA, efficiency and precision rate remain separate and use explicit denominators',()=>{
  const overview=pvpOverview(values({kills:100,deaths:20,assists:40,precisionKills:60,activitiesEntered:10,activitiesWon:7,secondsPlayed:1200,score:1000}));
  assert.deepEqual(overview.headline.map(x=>x.value),['5.00','6.00','7.00','60.00%','70.00%']);
  assert.equal(overview.totals.find(x=>x.label==='场均击杀').value,'10.00');
  assert.equal(overview.totals.find(x=>x.label==='每分钟击杀').value,'5.00');
  assert.ok(pvpOverview(undefined).headline.every(x=>x.value==='—'));
  assert.equal(pvpOverview(values({kills:3,deaths:0,assists:2})).headline[1].value,'4.00');
  assert.equal(pvpOverview(values({kills:0,precisionKills:0})).headline[3].value,'—');
});
test('weapon precision is divided by weapon kills, while share uses total kills',()=>{
  const rows=pvpWeaponTypes(values({kills:100,weaponKillsHandCannon:40,weaponPrecisionKillsHandCannon:30,weaponKillsSniper:20,weaponKillsPrecisionKillsSniper:0.9}));
  assert.equal(rows[0].headshots,'75.00%');assert.equal(rows[0].share,'40.00%');
  assert.equal(rows[1].headshots,'90.00%');assert.equal(rows[1].precision,null);
});
test('recent ratios use summed counts, and missing battle reports do not dilute headshot rate',()=>{
  const rows=[{values:values({kills:20,deaths:10,assists:4,standing:0}),precision:10},{values:values({kills:5,deaths:1,assists:2,standing:1}),precision:5},{values:values({kills:100,deaths:1,assists:0}),precision:null}];
  const summary=pvpRecentSummary(rows);assert.equal(summary.tiles[2].value,'10.42');assert.equal(summary.tiles[5].value,'60.00%');assert.equal(summary.precisionCount,2);assert.deepEqual(summary.sequence,['W','L','?']);
  assert.notEqual(summary.tiles[2].value,((2+5+100)/3).toFixed(2));
});
test('PGCR enrichment matches both membership and character, never fills another player precision',async()=>{
  let calls=0;const destiny={cache:new CachedRequests(),api:async()=>{calls++;return {entries:[
    {characterId:'9',player:{destinyUserInfo:{membershipId:'999'}},extended:{values:values({precisionKills:500})}},
    {characterId:'9',player:{destinyUserInfo:{membershipId:'1'}},extended:{values:values({precisionKills:7}),weapons:[{referenceId:2}]}}
  ]};}};
  const reports=new GuardianReports(destiny);const rows=[{activityDetails:{instanceId:'123'},character:{characterId:'9'}}];
  assert.equal((await reports.pvpDetails({membershipId:'1'},rows))[0].precision,7);
  assert.equal((await reports.pvpDetails({membershipId:'12345'},rows))[0].precision,null);
  assert.equal(calls,1);assert.equal(rows[0].precision,undefined);
});
test('battle report outages preserve existing history and leave precision unknown',async()=>{
  const report=new GuardianReports({cache:new CachedRequests(),api:async()=>{throw new Error('offline');}});
  const row={activityDetails:{instanceId:'123'},values:values({kills:10}),character:{characterId:'9'}};
  const [result]=await report.pvpDetails({membershipId:'1'},[row]);assert.equal(result.values.kills.basic.value,10);assert.equal(result.precision,null);
  assert.deepEqual((await report.pvpDetails({membershipId:'1'},[row],{budgetMs:0}))[0].weapons,[]);
});
test('recent weapons retain item hashes, aggregate counts and disclose incomplete precision',()=>{
  const rows=[{weapons:[{referenceId:1,values:values({uniqueWeaponKills:10,uniqueWeaponPrecisionKills:8})}]},{weapons:[{referenceId:1,values:values({uniqueWeaponKills:20,uniqueWeaponPrecisionKills:10})},{referenceId:2,values:values({uniqueWeaponKills:4})}]}];
  const result=pvpRecentWeapons(rows,{items:{1:{name:'同名枪'},2:{name:'同名枪'}}});assert.equal(result.length,2);assert.equal(result[0].headshots,'60.00%');assert.equal(result[0].kills,30);assert.equal(result[1].headshots,'—');
});
test('PvP screenshot contains data tables, all recent rows, escaped content and no map assets',()=>{
  const rows=Array.from({length:20},(_,i)=>pvpMatchRow({period:'2026-10-24T00:00:00Z',activityDetails:{instanceId:String(i+1),referenceId:2},values:values({kills:10,deaths:5,assists:2})},{activities:{2:{name:'<script>map</script>'}}}));
  const card={title:'PVP',subtitle:'<img onerror="bad">',matches:rows,headline:pvpOverview().headline,recentSummary:{sequence:[]},recentWeapons:[]};
  const html=pvpHtml(card);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img onerror'));assert.ok(!html.includes('background-image:'));assert.ok(html.includes('KDA'));assert.ok(html.includes('爆头率'));assert.equal((html.match(/class="when"/g)||[]).length,20);assert.deepEqual(pvpImagePaths(card),[]);
});
