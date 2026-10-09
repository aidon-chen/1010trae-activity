'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {LotteryStore,HttpError}=require('./store.cjs');
const defaults=require('./prizes.cjs');
const root=path.resolve(__dirname,'..');
const data=path.resolve(process.env.LOTTERY_DATA_DIR || path.join(root,'data'));
const port=Number(process.env.PORT || 5173);
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('端口不正确');
const store=new LotteryStore(path.join(data,'lottery.sqlite'));
const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
const publicFiles=new Set(['index.html','lucky-wheel.html','quiz-proto.html','wheel.js','ironspirit-logo.png',
  ...fs.readdirSync(root).filter(f=>/\.(jpg|jpeg|png|webp|ico)$/i.test(f))]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
function json(res,status,value) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
async function body(req) {
  if(!String(req.headers['content-type']||'').startsWith('application/json')) throw new HttpError(415,'请使用 JSON 请求');
  let raw='';
  for await(const chunk of req) { raw+=chunk; if(Buffer.byteLength(raw)>1024*1024) throw new HttpError(413,'请求过大'); }
  try { const parsed=JSON.parse(raw); if(!parsed||Array.isArray(parsed)||typeof parsed!=='object') throw 0; return parsed; }
  catch { throw new HttpError(400,'JSON 格式不正确'); }
}
function csvCell(value) {
  let s=String(value??'');
  if(/^[\s]*[=+@-]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
async function handle(req,res) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','same-origin');
  if(!allowedHosts.has(req.headers.host)) throw new HttpError(403,'仅接受本机访问');
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(req.headers.origin && req.headers.origin!==url.origin) throw new HttpError(403,'拒绝跨站请求');
  if(req.method==='POST') {
    if(req.headers['x-lottery-client']!=='local-wheel-v1') throw new HttpError(403,'缺少本地操作标识');
    const input=await body(req);
    if(url.pathname==='/api/draw') {
      const draw=store.draw(input);
      json(res,200,{draw,state:store.state()});
      if(draw.id%20===0&&draw.id>lastAutoDraw){lastAutoDraw=draw.id;void autoBackup();}
      return;
    }
    if(url.pathname==='/api/campaigns') {
      await store.backup(path.join(data,'backups'));
      const campaignId=store.createCampaign(input); return json(res,200,{campaignId,state:store.state()});
    }
    if(url.pathname==='/api/import-legacy') {
      await store.backup(path.join(data,'backups'));
      const campaignId=store.importLegacy(input); return json(res,200,{campaignId,state:store.state()});
    }
    if(url.pathname==='/api/backup') {
      const file=await store.backup(path.join(data,'backups'));
      res.writeHead(200,{'Content-Type':'application/vnd.sqlite3','Content-Disposition':`attachment; filename="${path.basename(file)}"`});
      return fs.createReadStream(file).pipe(res);
    }
    throw new HttpError(404,'接口不存在');
  }
  if(req.method!=='GET'&&req.method!=='HEAD') throw new HttpError(405,'不支持此操作');
  if(url.pathname==='/api/health') return json(res,200,{ok:true,service:'trae-local-lottery',pid:process.pid});
  if(url.pathname==='/api/state') return json(res,200,store.state());
  if(url.pathname==='/api/defaults') return json(res,200,{prizes:defaults});
  if(url.pathname==='/api/export.csv') {
    const rows=[['编号','奖池','奖池ID','时间（UTC；旧记录未知）','来源','奖品','等级'],...store.history().map(d=>[d.id,d.campaign,d.campaign_id,d.created_at,d.source,d.name,d.level])];
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="lottery-records.csv"','Cache-Control':'no-store'});
    return res.end('\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'));
  }
  const filename=decodeURIComponent(url.pathname.slice(1)||'index.html');
  if(!publicFiles.has(filename)) throw new HttpError(404,'页面不存在');
  res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-cache'});
  if(req.method==='HEAD') return res.end();
  fs.createReadStream(path.join(root,filename)).on('error',e=>res.destroy(e)).pipe(res);
}
let backupBusy=false,lastAutoDraw=0;
async function autoBackup() {
  if(backupBusy) return;
  backupBusy=true;
  try { await store.backup(path.join(data,'backups')); }
  catch(e) { console.error('自动备份失败（主数据库已提交）：',e.message); }
  finally { backupBusy=false; }
}
const server=http.createServer((req,res)=>handle(req,res).catch(e=> {
  if(!e.status) console.error(e);
  if(!res.headersSent) json(res,e.status||500,{error:e.status?e.message:'服务保存失败，请保留请求编号并重试；不会重置奖池'});
  else res.destroy();
}));
server.requestTimeout=15000;
server.on('error',e=>{ console.error(e.message); store.close(); process.exit(1); });
server.listen(port,'127.0.0.1',()=>{ console.log(`本地活动服务：http://127.0.0.1:${port}/lucky-wheel.html\n数据库：${data}`); void autoBackup(); });
function shutdown(){server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(1),5000).unref();}
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
