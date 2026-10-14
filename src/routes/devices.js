const express=require('express');
const {pool}=require('../db');
const {httpError,deviceId,pageOptions,searchText,sqlLike}=require('../utils/validation');
const {displayTime,isoTime}=require('../utils/time');
module.exports = (control) => {
  const r=express.Router();
  r.get('/',async(req,res)=>{
    const [rows]=await pool.query('SELECT id,name,status,updated_at FROM devices ORDER BY id');
    res.json(rows.map(x=>({id:x.id,name:x.name,status:x.status,updatedAt:isoTime(x.updated_at)})));
  });
  r.get('/action-history',async(req,res)=>{
    const {page,size,offset}=pageOptions(req.query);
    const device=req.query.deviceId===undefined ? '' : searchText(req.query.deviceId);
    const action=searchText(req.query.action);
    const status=searchText(req.query.status);
    const time=searchText(req.query.time);
    const conditions=[];const args=[];
    if(device) {const id=deviceId(device);conditions.push('ah.device_id=?');args.push(id);}
    if(action) {if(!['ON','OFF'].includes(action)) throw httpError(400,'action không hợp lệ');conditions.push('ah.action=?');args.push(action);}
    if(status) {if(!['PENDING','SUCCESS','FAILED'].includes(status)) throw httpError(400,'status không hợp lệ');conditions.push('ah.status=?');args.push(status);}
    if(time) {conditions.push("DATE_FORMAT(DATE_ADD(ah.created_at, INTERVAL 7 HOUR),'%Y-%m-%d %H:%i:%s') LIKE ?");args.push(sqlLike(time));}
    const from=' FROM action_history ah JOIN devices d ON d.id=ah.device_id JOIN users u ON u.id=ah.user_id';
    const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
    const [[{total}]]=await pool.execute('SELECT COUNT(*) AS total'+from+where,args);
    const [rows]=await pool.execute('SELECT ah.id,ah.user_id AS userId,ah.device_id,ah.action,ah.status,ah.error_reason,ah.created_at,ah.finished_at,d.name AS deviceName,u.username,u.full_name'+from+where+` ORDER BY ah.created_at DESC,ah.id DESC LIMIT ${size} OFFSET ${offset}`,args);
    res.json({content:rows.map(x=>({id:Number(x.id),deviceId:x.device_id,deviceName:x.deviceName,action:x.action,status:x.status,errorReason:x.error_reason,time:displayTime(x.created_at),createdAt:isoTime(x.created_at),finishedAt:isoTime(x.finished_at),userId:x.userId,user:x.full_name||x.username})),page,size,totalElements:Number(total),totalPages:Math.ceil(Number(total)/size)});
  });
  r.get('/:id/status',async(req,res)=>{
    const id=deviceId(req.params.id);
    const [rows]=await pool.execute('SELECT status,updated_at FROM devices WHERE id=?',[id]);
    if(!rows.length)throw httpError(404,'Thiết bị không tồn tại');
    res.json({deviceId:id,status:rows[0].status,updatedAt:isoTime(rows[0].updated_at)});
  });
  r.post('/:id/control',async(req,res)=>{
    const id=deviceId(req.params.id);
    const action=req.body?.action;
    const result=await control.create(req.user.id,id,action);
    res.status(202).json(result);
  });
  return r;
};
