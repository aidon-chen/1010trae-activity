'use strict';
// Small local supervisor: detached from the terminal, with crash restart and a stop signal file.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),data=path.join(root,'data');
fs.mkdirSync(data,{recursive:true});
const lock=path.join(data,'service.json'),stop=path.join(data,'service-stop.json');
const restartSignal=path.join(data,'service-restart.json');
const mode=process.argv[2]||'start';
function readLock(){try{return JSON.parse(fs.readFileSync(lock,'utf8'));}catch{return null;}}
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
async function health(){try{const r=await fetch('http://127.0.0.1:5173/api/health',{signal:AbortSignal.timeout(1500)});return (await r.json()).service==='trae-local-lottery';}catch{return false;}}
async function main(){
  if(mode==='restart'){
    const current=readLock();
    if(!current||!alive(current.pid))throw new Error('后台服务未运行，请先 start');
    fs.writeFileSync(restartSignal,JSON.stringify({token:current.token}));
    console.log('重启信号已交给当前后台服务，库存和记录保留');return;
  }
  if(mode==='stop'){
    const current=readLock();
    if(!current||!alive(current.pid)){console.log('后台服务未运行');return;}
    fs.writeFileSync(stop,JSON.stringify({token:current.token}));
    for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,200));if(!alive(current.pid)){console.log('本地服务已停止，抽奖数据保留');return;}}
    throw new Error('停止超时，请查看 data/service.log；未强制结束其他进程');
  }
  if(mode==='start'){
    const current=readLock();
    if(current&&alive(current.pid)){console.log('后台服务已在运行：http://127.0.0.1:5173/');return;}
    if(await health()){console.log('活动服务已在运行（前台模式），请在原终端 Ctrl+C 停止');return;}
    const log=fs.openSync(path.join(data,'service.log'),'a');
    const child=spawn(process.execPath,[__filename,'run'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log]});
    child.unref();fs.closeSync(log);
    for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,250));if(await health()){console.log('后台服务已启动：http://127.0.0.1:5173/lucky-wheel.html');return;}}
    throw new Error('服务暂未就绪，请检查 data/service.log 和 5173 端口');
  }
  if(mode!=='run')throw new Error('用法：node scripts/service.cjs start|stop|restart');
  const current=readLock();
  if(current&&alive(current.pid))return;
  // This file is not used to kill a PID. Stop requests carry the current supervisor token.
  const token=randomUUID();
  if(fs.existsSync(lock)){
    const owner=readLock();
    if(owner&&alive(owner.pid))return;
    if(!owner&&Date.now()-fs.statSync(lock).mtimeMs<15000)return;
    fs.unlinkSync(lock);
  }
  let descriptor;
  try{descriptor=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')return;throw e;}
  fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,token,started:new Date().toISOString()}));
  fs.closeSync(descriptor);
  let child=null,stopping=false,restart=null,failures=0;
  function cleanup(){if(readLock()?.token===token)fs.unlinkSync(lock);process.exit(0);}
  function end(){if(stopping)return;stopping=true;clearTimeout(restart);if(child)child.kill();else cleanup();}
  function launch(){
    const started=Date.now();
    child=spawn(process.execPath,[path.join(root,'server','index.cjs')],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,PORT:'5173',LOTTERY_DATA_DIR:data}});
    console.log(new Date().toISOString(),'server PID',child.pid);
    child.on('error',e=>console.error('启动失败',e.message));
    child.on('exit',(code)=>{
      child=null;if(stopping)return cleanup();
      failures=Date.now()-started>30000?0:failures+1;
      console.error(new Date().toISOString(),'服务退出',code,'连续启动失败',failures);
      if(failures>=8){console.error('停止自动重试，请检查端口或数据库后重新启动');return cleanup();}
      restart=setTimeout(launch,Math.min(15000,3000*(failures||1)));
    });
  }
  const watch=setInterval(()=>{
    try{if(JSON.parse(fs.readFileSync(stop,'utf8')).token===token){fs.unlinkSync(stop);end();}}catch{}
    try{if(!stopping&&JSON.parse(fs.readFileSync(restartSignal,'utf8')).token===token){fs.unlinkSync(restartSignal);if(child)child.kill();}}catch{}
  },1000);
  process.on('SIGINT',end);process.on('SIGTERM',end);
  process.on('exit',()=>clearInterval(watch));
  launch();
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
