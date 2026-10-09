'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),net=require('node:net');
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {LotteryStore}=require('../server/store.cjs'),defaults=require('../server/prizes.cjs');
function setup(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'trae-lottery-test-'));
  let store=new LotteryStore(path.join(directory,'lottery.sqlite'));
  t.after(()=>{
    store.close();
    const resolved=path.resolve(directory),base=path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved),base);assert.ok(path.basename(resolved).startsWith('trae-lottery-test-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  return {get store(){return store;},directory,reopen(){store.close();store=new LotteryStore(path.join(directory,'lottery.sqlite'));return store;}};
}
function request(store,key=randomUUID()){return {requestId:key,campaignId:store.active().id};}
test('文档奖池 200 签、58 实物，两种手办和等级分别准确',t=>{
  const {store}=setup(t),s=store.state();
  assert.equal(s.total,200);assert.equal(s.remaining,200);assert.equal(s.winRate,.29);
  assert.deepEqual(Object.fromEntries(['特等奖','一等奖','二等奖','三等奖'].map(level=>[level,s.prizes.filter(p=>p.level===level).reduce((sum,p)=>sum+p.count,0)])),{'特等奖':2,'一等奖':16,'二等奖':15,'三等奖':25});
  assert.equal(s.prizes.find(p=>p.id==='new-figurine').count,1);
  assert.equal(s.prizes.find(p=>p.id==='trae-figurine').count,4);
});
test('抽满 200 次恰好发出各品类库存，201 次失败，无额外签',t=>{
  const {store}=setup(t),counts={};
  for(let i=0;i<200;i++){const draw=store.draw(request(store));counts[draw.prize_id]=(counts[draw.prize_id]||0)+1;}
  for(const p of defaults)assert.equal(counts[p.id],p.count);
  assert.equal(store.state().remaining,0);assert.equal(store.history().length,200);
  assert.throws(()=>store.draw(request(store)),/已全部抽完/);store.checkInventory();
});
test('重复请求在重启后仍返回同一记录，只消耗一次',t=>{
  const fixture=setup(t),input=request(fixture.store),first=fixture.store.draw(input);
  assert.deepEqual(fixture.store.draw(input),first);
  const reopened=fixture.reopen();assert.deepEqual(reopened.draw(input),first);
  assert.equal(reopened.state().drawn,1);assert.equal(reopened.state().remaining,199);
});
test('最后一签的响应丢失后，重试仍能取回结果，耗尽状态不阻断请求去重',t=>{
  const {store}=setup(t);
  store.createCampaign({requestId:randomUUID(),campaignId:store.active().id,title:'末签恢复测试',prizes:[{...defaults[0],count:1}]});
  const input=request(store),draw=store.draw(input);
  assert.equal(store.state().remaining,0);assert.deepEqual(store.draw(input),draw);assert.equal(store.state().drawn,1);
});
test('新建奖池保留原记录；过期页面不能扣新库存；重复新建不重置',t=>{
  const {store}=setup(t),old=store.active().id;
  store.draw(request(store));const input={requestId:randomUUID(),campaignId:old,title:'第二轮',prizes:defaults};
  const id=store.createCampaign(input);assert.equal(store.createCampaign(input),id);
  assert.equal(store.history().length,1);assert.equal(store.state().remaining,200);
  assert.throws(()=>store.draw({requestId:randomUUID(),campaignId:old}),/已切换/);
});
test('抽奖失败回滚扣减和记录，损坏的状态不会默默重建',t=>{
  const fixture=setup(t),{store}=fixture;
  store.db.exec("CREATE TRIGGER simulate_disk_failure BEFORE INSERT ON draws BEGIN SELECT RAISE(ABORT,'disk failure'); END;");
  assert.throws(()=>store.draw(request(store)),/disk failure/);
  assert.equal(store.state().remaining,200);assert.equal(store.history().length,0);
  store.db.exec('DROP TRIGGER simulate_disk_failure; UPDATE prizes SET remaining=remaining-1 WHERE id=\'bag\';');
  assert.throws(()=>store.checkInventory(),/不一致/);
  assert.throws(()=>new LotteryStore(path.join(fixture.directory,'lottery.sqlite')),/不一致/);
  // Repair this deliberately damaged test fixture so cleanup can close normally.
  store.db.exec("UPDATE prizes SET remaining=initial WHERE id='bag';");
});
test('旧奖池按逐项数量校验，保留原等级和已抽记录，重复导入不重复发奖',t=>{
  const {store}=setup(t),prizes=[{id:'legacy-0',name:'TRAE宝手办',level:'二等奖',count:5,color:'#46B5A4'},{id:'legacy-1',name:'谢谢参与',level:'',count:2,color:'#F4F1EA'}];
  const input={campaignId:store.active().id,prizes,deck:['TRAE宝手办','TRAE宝手办','TRAE宝手办','TRAE宝手办','谢谢参与'],drawn:['TRAE宝手办','谢谢参与']};
  const id=store.importLegacy(input);assert.equal(store.importLegacy(input),id);
  const s=store.state();assert.equal(s.drawn,2);assert.equal(s.remaining,5);assert.equal(s.prizes[0].remaining,4);
  assert.equal(store.history()[0].level,'二等奖');assert.equal(store.history()[0].created_at,null);
  assert.throws(()=>store.importLegacy({...input,drawn:['谢谢参与','谢谢参与']}),/数量与参数不一致/);
  assert.equal(store.state().drawn,2);
});
test('开始抽奖后旧记录不能覆盖服务器库存；无效新奖池不能改变当前状态',t=>{
  const {store}=setup(t);store.draw(request(store));const before=store.state();
  const deck=defaults.flatMap(p=>Array(p.count).fill(p.name));
  assert.throws(()=>store.importLegacy({campaignId:before.campaign.id,prizes:defaults,deck,drawn:[]}),/已经抽奖/);
  assert.throws(()=>store.createCampaign({requestId:randomUUID(),campaignId:before.campaign.id,title:'无效',prizes:[{...defaults[0],count:-1}]}),/请检查/);
  assert.deepEqual(store.state(),before);
});
test('在线 SQLite 备份完整，可恢复后继续原记录',async t=>{
  const {store,directory}=setup(t);const first=store.draw(request(store));
  const file=await store.backup(path.join(directory,'backups'));
  const restored=new LotteryStore(file);
  try{assert.equal(restored.state().drawn,1);assert.deepEqual(restored.result(first.request_key),first);restored.draw(request(restored));assert.equal(restored.state().remaining,198);restored.checkInventory();}
  finally{restored.close();}
});
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function launch(t,port,directory){
  const child=spawn(process.execPath,[path.join(__dirname,'../server/index.cjs')],{env:{...process.env,PORT:String(port),LOTTERY_DATA_DIR:directory},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
  t.after(async()=>{if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}});
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw new Error(output);
    try{if((await fetch(base+'/api/health')).ok)return base;}catch{}
    await new Promise(r=>setTimeout(r,40));
  }
  throw new Error('服务启动超时 '+output);
}
test('两个服务进程并发共享数据库：重复请求去重，库存不超发；跨站及私有文件拒绝访问',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'trae-lottery-test-http-'));
  // Leave this tiny HTTP fixture in the OS temp directory: process cleanup is handled above.
  const [p1,p2]=await Promise.all([freePort(),freePort()]);
  const a=await launch(t,p1,directory),b=await launch(t,p2,directory);
  const initial=await (await fetch(a+'/api/state')).json();
  const post=(base,input,headers={})=>fetch(base+'/api/draw',{method:'POST',headers:{'Content-Type':'application/json','X-Lottery-Client':'local-wheel-v1',...headers},body:JSON.stringify(input)});
  const inputs=Array.from({length:200},()=>({requestId:randomUUID(),campaignId:initial.campaign.id}));
  const responses=await Promise.all(inputs.flatMap((input,i)=>[post(i%2?a:b,input),post(i%2?b:a,input)]));
  assert.ok(responses.every(r=>r.status===200));
  const records=await Promise.all(responses.map(r=>r.json()));
  assert.equal(new Set(records.map(r=>r.draw.id)).size,200);
  const final=await (await fetch(b+'/api/state')).json();assert.equal(final.remaining,0);assert.equal(final.drawn,200);
  assert.equal((await post(a,{requestId:randomUUID(),campaignId:initial.campaign.id})).status,409);
  assert.equal((await post(a,inputs[0],{Origin:'https://example.com'})).status,403);
  assert.equal((await fetch(a+'/api/draw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(inputs[0])})).status,403);
  for(const url of ['/data/lottery.sqlite','/.git/config','/server/index.cjs','/scripts/service.cjs'])assert.equal((await fetch(a+url)).status,404);
  const csv=await (await fetch(a+'/api/export.csv')).text();assert.equal(csv.split('\r\n').length,201);
  const backup=await fetch(a+'/api/backup',{method:'POST',headers:{'Content-Type':'application/json','X-Lottery-Client':'local-wheel-v1'},body:'{}'});
  assert.equal(backup.status,200);assert.match(backup.headers.get('content-type'),/sqlite3/);
  fs.writeFileSync(path.join(directory,'download.sqlite'),Buffer.from(await backup.arrayBuffer()));
  const db=new DatabaseSync(path.join(directory,'download.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT COUNT(*) AS count FROM draws').get().count,200);db.close();
});
