'use strict';
const { DatabaseSync, backup } = require('node:sqlite');
const { randomInt, randomUUID, createHash } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const defaults = require('./prizes.cjs');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function requireKey(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value))
    throw new HttpError(400, '请求编号格式不正确');
  return value;
}
function validatePrizes(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 40)
    throw new HttpError(400, '奖项数量须为 1 至 40 项');
  const ids = new Set(), names = new Set();
  const prizes = input.map((p, i) => {
    if (!p || typeof p !== 'object') throw new HttpError(400, '奖项格式不正确');
    const id = String(p.id || `prize-${i}`), name = String(p.name || '').trim();
    const level = String(p.level || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id) || !name || name.length > 40 || names.has(name)
        || level.length > 20 || !Number.isSafeInteger(p.count) || p.count < 0 || p.count > 10000
        || !/^#[0-9a-fA-F]{6}$/.test(p.color)) throw new HttpError(400, '请检查名称、等级、整数数量和颜色，名称不能重复');
    ids.add(id); names.add(name);
    return { id, name, level, count:p.count, color:p.color };
  });
  const total = prizes.reduce((s,p) => s + p.count, 0);
  if (total < 1 || total > 10000) throw new HttpError(400, '总奖签数须为 1 至 10000');
  return prizes;
}

class LotteryStore {
  constructor(filename) {
    mkdirSync(path.dirname(filename), { recursive:true });
    this.filename = filename;
    this.db = new DatabaseSync(filename, { timeout:5000 });
    try {
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    if (this.db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('数据库校验失败，请从备份恢复；不会重置奖池');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('数据库版本高于此服务，停止启动以保护数据');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
        request_key TEXT NOT NULL UNIQUE, active INTEGER NOT NULL CHECK(active IN (0,1)),
        legacy_json TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_campaign ON campaigns(active) WHERE active=1;
      CREATE TABLE IF NOT EXISTS prizes (
        campaign_id TEXT NOT NULL REFERENCES campaigns(id), id TEXT NOT NULL,
        position INTEGER NOT NULL, name TEXT NOT NULL, level TEXT NOT NULL, color TEXT NOT NULL,
        initial INTEGER NOT NULL CHECK(initial>=0), remaining INTEGER NOT NULL CHECK(remaining>=0 AND remaining<=initial),
        PRIMARY KEY(campaign_id,id), UNIQUE(campaign_id,name)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS draws (
        id INTEGER PRIMARY KEY, request_key TEXT NOT NULL UNIQUE,
        campaign_id TEXT NOT NULL, prize_id TEXT NOT NULL,
        created_at TEXT, source TEXT NOT NULL,
        FOREIGN KEY(campaign_id,prize_id) REFERENCES prizes(campaign_id,id)
      ) STRICT;
      PRAGMA user_version=1;
    `);
    this.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM campaigns').get()) this.insertCampaign(defaults, '1010 活动 · 普通转盘', 'initial-campaign-2026');
      if (!this.db.prepare('SELECT 1 FROM campaigns WHERE active=1').get()) throw new Error('缺少活动奖池；不会自动重建');
      this.checkInventory();
    });
    } catch(e) { this.db.close(); throw e; }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  checkInventory() {
    const mismatch = this.db.prepare(`SELECT p.id FROM prizes p LEFT JOIN draws d
      ON d.campaign_id=p.campaign_id AND d.prize_id=p.id
      GROUP BY p.campaign_id,p.id HAVING p.initial-p.remaining <> COUNT(d.id)`).get();
    if (mismatch) throw new Error('抽奖记录与库存不一致，停止服务，请检查备份');
    if (this.db.prepare('PRAGMA foreign_key_check').get()) throw new Error('奖项或记录关联损坏，停止服务，请检查备份');
  }
  active() { return this.db.prepare('SELECT id,title,created_at FROM campaigns WHERE active=1').get(); }
  insertCampaign(prizes, title, key, legacy = null) {
    const id = randomUUID();
    this.db.prepare('UPDATE campaigns SET active=0 WHERE active=1').run();
    this.db.prepare('INSERT INTO campaigns VALUES (?,?,?,?,1,?)').run(id, title, new Date().toISOString(), key, legacy);
    const insert = this.db.prepare('INSERT INTO prizes VALUES (?,?,?,?,?,?,?,?)');
    prizes.forEach((p,i) => insert.run(id,p.id,i,p.name,p.level,p.color,p.count,p.count));
    return id;
  }
  state() {
    // A read transaction prevents mismatched summary/prizes when another process writes.
    this.db.exec('BEGIN');
    try {
      const campaign = this.active();
      const prizes = this.db.prepare('SELECT id,name,level,color,initial AS count,remaining FROM prizes WHERE campaign_id=? ORDER BY position').all(campaign.id);
      const remaining = prizes.reduce((s,p) => s+p.remaining,0), total = prizes.reduce((s,p) => s+p.count,0);
      const winning = prizes.reduce((s,p) => s+(p.level ? p.remaining:0),0);
      const latest = this.db.prepare(`SELECT d.id,d.created_at,p.name,p.level FROM draws d JOIN prizes p
        ON p.campaign_id=d.campaign_id AND p.id=d.prize_id WHERE d.campaign_id=? ORDER BY d.id DESC LIMIT 10`).all(campaign.id);
      this.db.exec('COMMIT');
      return { campaign, prizes, remaining, total, drawn:total-remaining, winRate:remaining ? winning/remaining:0, latest };
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  result(key) {
    return this.db.prepare(`SELECT d.id,d.request_key,d.campaign_id,d.created_at,p.id AS prize_id,p.name,p.level,p.color
      FROM draws d JOIN prizes p ON p.campaign_id=d.campaign_id AND p.id=d.prize_id WHERE request_key=?`).get(key);
  }
  draw({requestId,campaignId}) {
    requireKey(requestId);
    return this.transaction(() => {
      const previous = this.result(requestId);
      if (previous) {
        if (previous.campaign_id !== campaignId) throw new HttpError(409, '请求编号已用于另一个奖池');
        return previous;
      }
      const active = this.active();
      if (campaignId !== active.id) throw new HttpError(409, '奖池已切换，请刷新后再抽奖');
      const prizes = this.db.prepare('SELECT id,remaining FROM prizes WHERE campaign_id=? AND remaining>0 ORDER BY position').all(active.id);
      const total = prizes.reduce((s,p) => s+p.remaining,0);
      if (!total) throw new HttpError(409, '奖签已全部抽完');
      let ticket = randomInt(total);
      const prize = prizes.find(p => { if(ticket<p.remaining) return true; ticket-=p.remaining; return false; });
      const changed = this.db.prepare('UPDATE prizes SET remaining=remaining-1 WHERE campaign_id=? AND id=? AND remaining>0').run(active.id,prize.id);
      if (changed.changes !== 1) throw new Error('库存扣减失败');
      this.db.prepare('INSERT INTO draws(request_key,campaign_id,prize_id,created_at,source) VALUES (?,?,?,?,?)')
        .run(requestId,active.id,prize.id,new Date().toISOString(),'server');
      return this.result(requestId);
    });
  }
  createCampaign({requestId,campaignId,prizes,title}) {
    requireKey(requestId); prizes=validatePrizes(prizes);
    if (typeof title !== 'string' || !title.trim() || title.length>80) throw new HttpError(400,'请输入 1 至 80 字的奖池名称');
    return this.transaction(() => {
      const previous=this.db.prepare('SELECT id FROM campaigns WHERE request_key=?').get(requestId);
      if(previous) return previous.id;
      if (campaignId !== this.active().id) throw new HttpError(409,'奖池已切换，请刷新后操作');
      return this.insertCampaign(prizes,title.trim(),requestId);
    });
  }
  importLegacy({campaignId,prizes,deck,drawn}) {
    prizes=validatePrizes(prizes);
    if (!Array.isArray(deck) || !Array.isArray(drawn) || deck.length+drawn.length>10000) throw new HttpError(400,'旧记录格式不正确');
    const counts=new Map(prizes.map(p=>[p.name,0]));
    for(const name of [...deck,...drawn]) {
      if(!counts.has(name)) throw new HttpError(400,'旧记录包含未知奖项，请保留备份并人工核对');
      counts.set(name,counts.get(name)+1);
    }
    if(prizes.some(p=>counts.get(p.name)!==p.count)) throw new HttpError(400,'旧记录数量与参数不一致，不会自动补签');
    const raw=JSON.stringify({prizes,deck,drawn});
    const key='legacy-'+createHash('sha256').update(raw).digest('hex');
    return this.transaction(()=> {
      const previous=this.db.prepare('SELECT id FROM campaigns WHERE request_key=?').get(key);
      if(previous) return previous.id;
      const active=this.active();
      if(campaignId!==active.id || this.db.prepare('SELECT 1 FROM draws WHERE campaign_id=?').get(active.id))
        throw new HttpError(409,'当前服务已经抽奖或切换奖池，旧记录不能覆盖，请先导出核对');
      const id=this.insertCampaign(prizes,'旧浏览器奖池 · 保留原等级',key,raw);
      drawn.forEach((name,i)=> {
        const p=prizes.find(p=>p.name===name);
        this.db.prepare('UPDATE prizes SET remaining=remaining-1 WHERE campaign_id=? AND id=?').run(id,p.id);
        this.db.prepare('INSERT INTO draws(request_key,campaign_id,prize_id,created_at,source) VALUES (?,?,?,NULL,?)').run(`${key}-${i}`,id,p.id,'legacy');
      });
      this.checkInventory();
      return id;
    });
  }
  history() {
    return this.db.prepare(`SELECT d.id,c.title AS campaign,d.campaign_id,d.created_at,d.source,p.name,p.level
      FROM draws d JOIN campaigns c ON c.id=d.campaign_id JOIN prizes p ON p.campaign_id=d.campaign_id AND p.id=d.prize_id ORDER BY d.id`).all();
  }
  async backup(directory) {
    mkdirSync(directory,{recursive:true});
    const filename=path.join(directory,`lottery-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.sqlite`);
    await backup(this.db,filename);
    return filename;
  }
  close() { this.db.close(); }
}
module.exports={LotteryStore,HttpError,validatePrizes};
