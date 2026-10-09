'use strict';
const {DatabaseSync}=require('node:sqlite');
let db;
try{
  if(!process.argv[2])throw new Error('需要备份路径');
  db=new DatabaseSync(process.argv[2],{readOnly:true});
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'
    ||db.prepare('PRAGMA user_version').get().user_version!==1
    ||db.prepare('PRAGMA foreign_key_check').get()
    ||db.prepare('SELECT COUNT(*) AS count FROM campaigns WHERE active=1').get().count!==1)
    throw new Error('数据库完整性、版本或活动奖池不正确');
  if(db.prepare(`SELECT p.id FROM prizes p LEFT JOIN draws d
    ON d.campaign_id=p.campaign_id AND d.prize_id=p.id
    GROUP BY p.campaign_id,p.id HAVING p.initial-p.remaining<>COUNT(d.id)`).get())
    throw new Error('库存与结果记录不一致');
  console.log('备份校验通过');
}catch(e){console.error(e.message);process.exitCode=1;}
finally{if(db)db.close();}
