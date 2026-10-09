'use strict';
const $ = id => document.getElementById(id);
const canvas=$('wheel'), ctx=canvas.getContext('2d'), spinBtn=$('spin');
const resultEl=$('result'), stockEl=$('stock'), subEl=$('sub');
const rowsEl=$('rows'), sumHint=$('sumHint');
const PENDING_KEY='ironspirit_server_pending_v1';
const LEGACY_ACK='ironspirit_legacy_ack_v1';
let PRIZES=[], snapshot=null, rotation=0, spinning=false, connected=false, managing=false;
let draft=[], pending=null, legacy=null, legacyBlocked=false, draftCampaign=null;
const PALETTE=['#6C5CE7','#FFD3A5','#EF7BAE','#FFF1B6','#46B5A4','#BFE3F5','#5D8DEE','#C9EBD4','#8D79D9','#F2A65E'];
const OLD_DEFAULTS=[['单肩背包','特等奖',2],['马克杯','一等奖',5],['笔记本','一等奖',10],['TRAE宝手办','二等奖',5],['徽章','二等奖',2],['钥匙扣','二等奖',3],['按键挂件','二等奖',6],['冰箱贴','三等奖',15],['贴纸','三等奖',10],['谢谢参与','',142]]
  .map(([name,level,count],i)=>({name,level,count,color:PALETTE[i%PALETTE.length]}));
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function api(url,input){
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000),
    ...(input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Lottery-Client':'local-wheel-v1'},body:JSON.stringify(input)})});
  const data=await response.json();
  if(!response.ok){const error=new Error(data.error||'服务请求失败');error.status=response.status;throw error;}
  return data;
}
function status(message,bad=false){$('serviceStatus').textContent=message;$('serviceStatus').classList.toggle('offline',bad);}
function message(text){resultEl.className='result empty';resultEl.innerHTML=`<div class="name">${escapeHtml(text)}</div>`;}
function enable(){
  spinBtn.disabled=!connected||spinning||managing||(legacyBlocked&&!pending)||(!pending&&!snapshot?.remaining);
  spinBtn.textContent=spinning?'抽取中':pending?'重试本次':'抽奖';
  $('apply').disabled=!connected||spinning||managing||Boolean(pending)||legacyBlocked;
  $('reset').disabled=$('apply').disabled;
  $('importLegacy').disabled=!connected||spinning||managing||Boolean(pending)||!legacy;
}
function showState(next){
  snapshot=next;
  // Editing a new pool never changes the active wheel or stock.
  PRIZES=next.prizes;
  $('tRemain').textContent=next.remaining;$('tDrawn').textContent=next.drawn;
  $('tWinRate').textContent=next.remaining?(next.winRate*100).toFixed(1)+'%':'--';
  subEl.textContent=`${next.total} 张奖签 · 不放回 · ${next.campaign.title}`;
  stockEl.innerHTML=PRIZES.map(p=>`<li class="${p.remaining?'':'out'}"><span class="dot" style="background:${p.color}"></span><span class="nm" title="${escapeHtml(p.level)}">${escapeHtml(p.name)}</span><span class="rm">${p.remaining}</span><span class="pb">${next.remaining?(100*p.remaining/next.remaining).toFixed(1):'0.0'}%</span></li>`).join('');
  $('history').innerHTML=next.latest.length?next.latest.map(d=>`<li><span>#${d.id} · ${escapeHtml(d.level||'未中奖')}</span><strong>${escapeHtml(d.name)}</strong></li>`).join(''):'<li>暂无抽奖记录</li>';
  if(draftCampaign!==next.campaign.id){draftCampaign=next.campaign.id;draft=PRIZES.map(p=>({...p}));renderRows();}
  if(!spinning) render();
  enable();
}
async function refresh(){
  if(spinning||managing)return;
  try{showState(await api('/api/state'));connected=true;status('本地服务已连接 · 库存和记录自动保存');}
  catch{connected=false;status('本地服务未连接 · 请启动服务，连接恢复前暂停抽奖',true);}
  enable();
}

function render(){
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 - 4;
  const n = PRIZES.length;

  ctx.clearRect(0, 0, w, h);
  if (n === 0){
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    return;
  }

  const seg = 2 * Math.PI / n;
  const start0 = -Math.PI / 2;            // 0° 指向正上方，与指针一致
  const rad = rotation * Math.PI / 180;

  for (let i = 0; i < n; i++){
    const p = PRIZES[i];
    const a1 = start0 + i * seg + rad;
    const a2 = a1 + seg;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a1, a2);
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = Math.max(1, R * 0.006);
    ctx.stroke();

    // 文字沿半径方向排布
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a1 + seg / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const dark = isDark(p.color);
    const fg = dark ? '#ffffff' : '#12151c';
    if (p.level){
      ctx.font = `${Math.round(R * 0.055)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
      ctx.globalAlpha = .78;
      ctx.fillStyle = fg;
      ctx.fillText(p.level, R * 0.88, -R * 0.075);
      ctx.globalAlpha = 1;
    }
    ctx.font = `700 ${Math.round(R * 0.078)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
    ctx.fillStyle = fg;
    ctx.fillText(p.name, R * 0.88, p.level ? R * 0.045 : 0);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = '#4b3fe3';
  ctx.lineWidth = Math.max(2, R * 0.022);
  ctx.stroke();
}
function isDark(hex){
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (0.299*r + 0.587*g + 0.114*b) < 150;
}
function fitCanvas(){
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  render();
}



function animateTo(target,duration){
  const from=rotation,t0=performance.now();
  return new Promise(resolve=>{function frame(t){const k=Math.min(1,(t-t0)/duration);rotation=from+(target-from)*(1-Math.pow(1-k,3));render();k<1?requestAnimationFrame(frame):resolve();}requestAnimationFrame(frame);});
}
async function spin(){
  if(spinBtn.disabled)return;
  spinning=true;enable();
  try{
    if(!pending){
      pending={requestId:crypto.randomUUID(),campaignId:snapshot.campaign.id};
      // Save BEFORE sending. If storage fails, do not send an unrecoverable draw.
      try{sessionStorage.setItem(PENDING_KEY,JSON.stringify(pending));}
      catch{pending=null;throw new Error('浏览器无法保存请求编号，本次没有抽奖，请允许浏览器存储');}
    }
    message('正在抽取，请稍候…');
    const response=await api('/api/draw',pending);
    // Mark a committed response as resolved before animation. A reload can read its audit record.
    sessionStorage.removeItem(PENDING_KEY);pending=null;
    showState(response.state);
    const idx=PRIZES.findIndex(p=>p.id===response.draw.prize_id);
    if(response.draw.campaign_id===snapshot.campaign.id&&idx>=0){
      const segment=360/PRIZES.length,want=((-(idx+.5)*segment)%360+360)%360,cur=((rotation%360)+360)%360;
      await animateTo(rotation+2160+(want-cur+360)%360,matchMedia('(prefers-reduced-motion: reduce)').matches?120:4200);
    }
    resultEl.className='result';
    resultEl.innerHTML=`<div class="lv">${escapeHtml(response.draw.level||'未中奖')} · 记录 #${response.draw.id}</div><div class="name">${escapeHtml(response.draw.name)}</div>`;
    connected=true;status('结果已保存 · 可在记录中核对编号');
  }catch(e){
    if(e.status&&e.status<500){sessionStorage.removeItem(PENDING_KEY);pending=null;}
    if(!e.status)status('连接中断 · 本次编号已保留，重试不会重复扣库存',true);
    message(e.message||'连接失败，请重试本次抽奖');
  }finally{spinning=false;enable();}
}
function collectRows(){
  draft=Array.from(rowsEl.children).map(row=>({id:row.dataset.id,name:row.querySelector('.c-name').value.trim(),level:row.querySelector('.c-level').value.trim(),count:Number(row.querySelector('.c-count').value),color:row.querySelector('.c-color').value}));
  updateSum();
}
function updateSum(){sumHint.textContent=`合计 ${draft.reduce((s,p)=>s+(Number.isFinite(p.count)?p.count:0),0)} 张奖签`;}
function renderRows(){
  rowsEl.innerHTML=draft.map(p=>`<div class="prow" data-id="${escapeHtml(p.id)}"><input class="c-name" aria-label="奖项名称" maxlength="40" value="${escapeHtml(p.name)}"><input class="c-level" aria-label="奖项等级" maxlength="20" value="${escapeHtml(p.level)}"><input class="c-count" aria-label="奖签数量" type="number" min="0" max="10000" step="1" value="${p.count}"><input class="c-color" aria-label="奖项颜色" type="color" value="${p.color}"><button class="del" type="button" aria-label="删除${escapeHtml(p.name)}">✕</button></div>`).join('');
  rowsEl.querySelectorAll('input').forEach(el=>el.addEventListener('input',collectRows));
  rowsEl.querySelectorAll('.del').forEach(el=>el.addEventListener('click',()=>{if(rowsEl.children.length<=1)return;el.closest('.prow').remove();collectRows();}));
  updateSum();
}
async function newCampaign(prizes){
  if(!connected||spinning||managing||pending||legacyBlocked)return;
  const total=prizes.reduce((s,p)=>s+p.count,0);
  if(!confirm(`新建 ${total} 张奖签的奖池？原奖池和已抽记录全部保留。请先确认这是新活动或已核对实际剩余礼品，不能用满库存重复发奖。`))return;
  managing=true;enable();
  // Stable request across retries prevents accidentally creating two campaigns.
  const input={requestId:crypto.randomUUID(),campaignId:snapshot.campaign.id,prizes,title:'1010 活动 · '+new Date().toLocaleString('zh-CN')};
  try{let response;try{response=await api('/api/campaigns',input);}catch(e){if(e.status)throw e;response=await api('/api/campaigns',input);}showState(response.state);message('新奖池已创建，原抽奖记录已归档');}
  catch(e){alert(e.message);}
  finally{managing=false;await refresh();enable();}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
let legacyRaw=null,legacyFingerprint=null;
function detectLegacy(){
  try{
    const raw=localStorage.getItem('ironspirit_wheel_v2');
    if(!raw)return;
    const params=localStorage.getItem('ironspirit_wheel_params_v4');
    legacyRaw={state:raw,params};legacyFingerprint=JSON.stringify(legacyRaw);
    let previous;
    try{previous=JSON.parse(raw);}catch{}
    if(previous&&Array.isArray(previous.drawn)&&previous.drawn.length===0&&Array.isArray(previous.deck))return;
    try{
      const p=params?JSON.parse(params):OLD_DEFAULTS;
      if(!Array.isArray(p)||!Array.isArray(previous.deck)||!Array.isArray(previous.drawn))throw 0;
      legacy={prizes:p.map((v,i)=>({...v,id:`legacy-${i}`})),deck:previous.deck,drawn:previous.drawn};
    }catch{legacy=null;}
    legacyBlocked=localStorage.getItem(LEGACY_ACK)!==legacyFingerprint;
    $('legacyNotice').hidden=!legacyBlocked;
    $('legacyMessage').textContent=legacy?`检测到本浏览器 ${legacy.drawn.length} 条旧记录。迁移会保留原奖项等级和剩余数量；已抽手办不会重新分级。`:'检测到异常旧缓存，请先导出备份、核对现场记录；不会清空或自动补签。';
  }catch{legacyBlocked=true;$('legacyNotice').hidden=false;$('legacyMessage').textContent='无法读取浏览器旧缓存，请允许存储并刷新后再抽奖。';}
}
$('exportLegacy').addEventListener('click',()=>{if(legacyRaw)download(new Blob([JSON.stringify(legacyRaw,null,2)],{type:'application/json'}),'old-wheel-browser-backup.json');});
$('importLegacy').addEventListener('click',async()=>{
  if(!legacy||!snapshot||spinning||managing||pending)return;
  managing=true;enable();
  try{
    const response=await api('/api/import-legacy',{...legacy,campaignId:snapshot.campaign.id});
    localStorage.setItem(LEGACY_ACK,legacyFingerprint);legacyBlocked=false;$('legacyNotice').hidden=true;
    showState(response.state);message('旧记录已迁移，按原奖池剩余数量继续抽奖');
  }catch(e){alert(e.message);}finally{managing=false;enable();}
});
$('keepNew').addEventListener('click',()=>{
  if(!legacyRaw)return;
  if(!confirm('确认旧记录已核对，当前服务器奖池可以独立使用？将下载旧缓存备份；旧记录尚未导入服务，浏览器原缓存仍然保留。'))return;
  download(new Blob([JSON.stringify(legacyRaw,null,2)],{type:'application/json'}),'old-wheel-browser-backup.json');
  localStorage.setItem(LEGACY_ACK,legacyFingerprint);legacyBlocked=false;$('legacyNotice').hidden=true;enable();
});
$('backup').addEventListener('click',async()=>{
  try{const response=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json','X-Lottery-Client':'local-wheel-v1'},body:'{}'});
    if(!response.ok)throw new Error((await response.json()).error);download(await response.blob(),`lottery-backup-${Date.now()}.sqlite`);status('数据库备份已保存到本地备份目录并下载');
  }catch(e){alert(e.message);}
});
$('spin').addEventListener('click',spin);
$('apply').addEventListener('click',()=>{collectRows();void newCampaign(draft);});
$('reset').addEventListener('click',async()=>{try{const {prizes}=await api('/api/defaults');await newCampaign(prizes);}catch(e){alert(e.message);}});
$('addRow').addEventListener('click',()=>{collectRows();draft.push({id:crypto.randomUUID(),name:'新奖项',level:'',count:1,color:PALETTE[draft.length%PALETTE.length]});renderRows();});
$('toggleAdmin').addEventListener('click',()=>{const body=$('adminBody');body.hidden=!body.hidden;$('toggleAdmin').textContent=body.hidden?'展开':'收起';});
$('adminHead').addEventListener('click',e=>{if(!e.target.closest('button'))$('toggleAdmin').click();});
function toggleAdmin(){const admin=document.querySelector('.admin');admin.hidden=!admin.hidden;$('reset').hidden=admin.hidden;if(!admin.hidden)admin.scrollIntoView({behavior:'smooth',block:'start'});}
$('manage').addEventListener('click',toggleAdmin);
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='a'){e.preventDefault();toggleAdmin();}});
window.addEventListener('resize',fitCanvas);
window.addEventListener('focus',refresh);
async function init(){
  detectLegacy();
  try{const raw=sessionStorage.getItem(PENDING_KEY);pending=raw?JSON.parse(raw):null;}catch{legacyBlocked=true;message('请求记录无法读取，请核对抽奖记录后再继续');}
  await refresh();fitCanvas();
  if(pending)message('上次请求尚未确认，点击“重试本次”取回同一结果');
  else if(snapshot?.latest[0])message(`上次记录 #${snapshot.latest[0].id}：${snapshot.latest[0].name}`);
  else message('点击中间按钮开始抽奖');
  setInterval(refresh,3000);
}
void init();
