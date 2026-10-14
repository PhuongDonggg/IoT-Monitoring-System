const express=require('express');
const {pool}=require('../db');
module.exports=mqtt=>{
  const r=express.Router();
  r.get('/status',async(req,res)=>res.json(mqtt.status()));
  r.get('/health',async(req,res)=>{
    try {
      await pool.query('SELECT 1');
      res.json({status:mqtt.connected()?'ok':'degraded',database:'connected',...mqtt.status()});
    }catch {res.status(503).json({status:'down',database:'disconnected',...mqtt.status()});}
  });
  return r;
};
