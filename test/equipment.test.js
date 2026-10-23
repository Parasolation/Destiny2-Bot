import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEquipmentIndex,equipmentSearch} from '../src/equipment.js';
import {equipmentHtml,equipmentImagePaths} from '../src/equipment-cards.js';

const plug=(hash,name,type='特性',description='测试说明')=>({hash,displayProperties:{name,description,icon:'/common/destiny2_content/icons/test.png'},itemTypeDisplayName:type,plug:{plugCategoryIdentifier:'frames'}});
test('weapon perk pools follow sockets, include random rolls and keep enhanced variants while excluding trial-only effects and trackers',()=>{
  const items={1:{hash:1,itemType:3,displayProperties:{name:'测试枪'},screenshot:'/common/destiny2_content/screenshots/1.jpg',sockets:{socketCategories:[{socketCategoryHash:4241085061,socketIndexes:[0,1]}],socketEntries:[{singleInitialItemHash:2,randomizedPlugSetHash:10},{singleInitialItemHash:7}]}},
    2:plug(2,'狂暴'),3:plug(3,'狂暴','强化特征','强化说明'),4:plug(4,'狂暴'),5:plug(5,'狂暴','试炼效果','三胜奖励'),6:plug(6,'已移出词条'),7:{...plug(7,'追踪器'),plug:{plugCategoryIdentifier:'v400.plugs.weapons.masterworks.trackers'}}};
  const index=buildEquipmentIndex(items,{10:{reusablePlugItems:[{plugItemHash:3,currentlyCanRoll:true},{plugItemHash:4},{plugItemHash:6,currentlyCanRoll:false}]}});
  assert.equal(index.weaponPerks.length,2);assert.equal(index.equipment[1].columns.length,1);
  assert.equal(index.equipment[1].columns[0].plugs.length,2);assert.ok(index.weaponPerks.some(p=>p.enhanced));
  assert.ok(index.weaponPerks.every(p=>p.description!=='三胜奖励'));
});

test('one detailed weapon version per page; weapon hash selection and perk-only exact-name results remain deterministic',()=>{
  const index={weapons:[{hash:'2',name:'测试枪'},{hash:'1',name:'测试枪'},{hash:'3',name:'其他武器'}],equipment:{1:{screenshot:'one'},2:{screenshot:'two'}},weaponPerks:[{hash:'p1',name:'狂暴',enhanced:false},{hash:'p2',name:'狂暴',enhanced:true},{hash:'p3',name:'狂暴者手段',enhanced:false}]};
  assert.equal(equipmentSearch(index,'weapon','测试枪',2).rows[0].screenshot,'two');
  assert.equal(equipmentSearch(index,'weapon','2').rows[0].hash,'2');
  assert.equal(equipmentSearch(index,'perk','狂暴').rows.length,2);
  assert.equal(equipmentSearch(index,'perk','狂').rows.length,3);
  index.patterns=[{itemHash:'2'}];
  assert.equal(equipmentSearch(index,'weapon','测试枪').rows[0].hash,'2');
  assert.equal(equipmentSearch(index,'weapon','测试枪').rows[0].craftable,true);
  assert.equal(equipmentSearch(index,'weapon','1').rows[0].craftable,false);
  assert.equal(equipmentSearch(index,'weapon','不存在').total,0);
});

test('equipment templates escape names, include all perk options and retain text when artwork is absent',()=>{
  const card={layout:'weapon-detail',items:[{hash:'1',name:'<script>alert(1)</script>',screenshot:'https://evil.test/tracker.jpg',attributes:[{name:'射程',value:150,max:100,bar:true}],columns:[{label:'特性',plugs:Array.from({length:20},(_,i)=>({name:'词条'+i,icon:'/common/destiny2_content/icons/test.png'}))}]}],page:1,pages:1,total:1};
  const html=equipmentHtml(card);
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('src="https://'));
  assert.equal((html.match(/class="pool-perk"/g)||[]).length,20);assert.ok(html.includes('width:100%'));
  assert.ok(html.includes('武器大图暂不可用'));assert.ok(html.includes('词条19'));
  assert.equal(equipmentImagePaths(card).length,2);
  const perk=equipmentHtml({layout:'perk-detail',items:[{name:'狂暴',enhanced:false,type:'特性',description:'普通'},{name:'狂暴',enhanced:true,type:'强化特征',description:'强化'}],page:1,pages:1,total:2});
  assert.ok(perk.includes('普通版本'));assert.ok(perk.includes('强化版本'));
});
