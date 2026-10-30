import http from 'node:http';
import crypto from 'node:crypto';
import ece from 'http_ece';
const B='http://localhost:8787';
const KEY='sunshine-2026';
let ok=0; const check=(c,m)=>{if(!c){console.error('FAIL',m);process.exitCode=1}else{ok++;}};
const j=async(p,o={})=>{const r=await fetch(B+p,{method:o.method||'GET',headers:{'content-type':'application/json','x-family-key':o.key??KEY},body:o.body?JSON.stringify(o.body):undefined});let d=null;try{d=await r.json()}catch{};return{s:r.status,d}};

// fake push service
const got=[];
const srv=http.createServer((req,res)=>{const ch=[];req.on('data',c=>ch.push(c));req.on('end',()=>{got.push({h:req.headers,body:Buffer.concat(ch)});res.writeHead(201);res.end()})}).listen(9911);
const ua=crypto.createECDH('prime256v1');ua.generateKeys();const auth=crypto.randomBytes(16);
const sub={endpoint:'http://127.0.0.1:9911/push/abc',keys:{p256dh:ua.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};

check((await j('/api/status')).d.setup===false,'not setup');
check((await j('/api/setup',{method:'POST',body:{key:'abc',family:'X'}})).s===400,'short key rejected');
check((await j('/api/setup',{method:'POST',body:{key:KEY,family:'Test family'}})).s===200,'setup');
check((await j('/api/setup',{method:'POST',body:{key:KEY}})).s===409,'second setup blocked');
check((await j('/api/login',{method:'POST',body:{key:'nope-nope'}})).s===401,'wrong key');
check((await j('/api/login',{method:'POST',body:{key:KEY}})).d.family==='Test family','login');
check((await j('/api/sync',{key:'bad'})).s===401,'auth required');

const now=Date.now();
await j('/api/reminders',{method:'PUT',body:{feed:{auto:true,hours:3},pump:{auto:false,hours:2},due:{feed:null,pump:null},tz:'Europe/Amsterdam'}});
let r=await j('/api/events/e1',{method:'PUT',body:{type:'feed',kind:'bottle',ml:90,min:20,t:now-60000,note:'good',by:'Dad'}});
check(r.d.rem&&Math.abs(r.d.rem.due.feed-(now-60000+3*36e5))<5,'auto reminder set from feed');
await j('/api/events/e2',{method:'PUT',body:{type:'diaper',kind:'wet',t:now-30000}});
await j('/api/events/e3',{method:'PUT',body:{type:'pump',side:'both',ml:120,min:15,t:now-20000}});
r=await j('/api/sync');
check(r.d.full&&r.d.events.length===3,'full sync has 3 events');
const since=r.d.now;
await j('/api/events/e2',{method:'DELETE'});
await j('/api/growth/g1',{method:'PUT',body:{t:now,kg:4.2,cm:55}});
r=await j('/api/sync?since='+since);
check(r.d.events.some(e=>e.id==='e2'&&e.deleted),'delta has tombstone');
check(r.d.growth.length===1&&r.d.growth[0].kg===4.2,'delta has growth');
await j('/api/profile',{method:'PUT',body:{name:'Mira',birth:'2026-09-01',sex:'girl'}});
check((await j('/api/sync')).d.profile.name==='Mira','profile saved');

// push
check((await j('/api/subscribe',{method:'POST',body:{subscription:sub,member:'Dad'}})).s===200,'subscribe');
const vapid=(await j('/api/vapid')).d.publicKey;
r=await j('/api/test-push',{method:'POST',body:{endpoint:sub.endpoint}});
check(r.d.sent===1,'test push sent '+JSON.stringify(r.d));
// make feed reminder due now and run cron
await j('/api/reminders',{method:'PUT',body:{feed:{auto:true,hours:3},pump:{auto:false,hours:2},due:{feed:Date.now()-1000,pump:null},tz:'Europe/Amsterdam'}});
await fetch(B+'/__scheduled?cron=*+*+*+*+*');
await new Promise(r=>setTimeout(r,1500));
await fetch(B+'/__scheduled?cron=*+*+*+*+*'); // second run must not notify again
await new Promise(r=>setTimeout(r,1500));
check(got.length===2,'exactly 2 pushes received (test + reminder), got '+got.length);
for(const g of got){
  check(g.h['content-encoding']==='aes128gcm','encoding');
  const m=/vapid t=([^,]+), k=(.+)/.exec(g.h.authorization);check(m&&m[2]===vapid,'vapid header');
  const [h,p,sig]=m[1].split('.');const claims=JSON.parse(Buffer.from(p,'base64url'));check(claims.aud==='http://127.0.0.1:9911','aud');
  const pub=crypto.createPublicKey({key:{kty:'EC',crv:'P-256',x:Buffer.from(vapid,'base64url').subarray(1,33).toString('base64url'),y:Buffer.from(vapid,'base64url').subarray(33).toString('base64url')},format:'jwk'});
  check(crypto.verify('sha256',Buffer.from(h+'.'+p),{key:pub,dsaEncoding:'ieee-p1363'},Buffer.from(sig,'base64url')),'jwt signature valid');
  const plain=ece.decrypt(g.body,{version:'aes128gcm',privateKey:ua,authSecret:auth.toString('base64url')});
  console.log('  push:',plain.toString());
}
// snooze
r=await j('/api/snooze',{method:'POST',body:{kind:'feed',minutes:15}});
check(r.d.rem.due.feed>Date.now()+14*60000,'snooze');
// gone subscription cleanup
srv.close();
const srv2=http.createServer((q,s)=>{s.writeHead(410);s.end()}).listen(9911);
r=await j('/api/test-push',{method:'POST',body:{}});
check(r.d.gone===1,'410 removes subscription');
check((await j('/api/devices')).d.devices.length===0,'no devices left');
srv2.close();
// static
const html=await fetch(B+'/');check((await html.text()).includes('<title>Baby Care Log</title>'),'index served');
check((await fetch(B+'/sw.js')).headers.get('content-type').includes('javascript'),'sw served');
check((await fetch(B+'/icon-192.png')).headers.get('content-type')==='image/png','icon served');
console.log(ok,'checks passed');
