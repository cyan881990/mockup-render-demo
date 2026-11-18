const fs=require('fs');
const {Registry}=require('../src/registry');
const {AssetStore}=require('../src/assets');
const {RenderCache}=require('../src/cache');
const {Renderer}=require('../src/render');
const settings=JSON.parse(fs.readFileSync(__dirname+'/../data/settings.json','utf8'));
const reg=new Registry().loadAll();
const assets=new AssetStore({widths:settings.widths});
const cache=new RenderCache({memoryMB:384,diskEnabled:false});
const r=new Renderer(reg,assets,cache,{...settings,optimizeInBackground:false});
const BASE='https://macorner.co/products/christmas-together-personalized-runner-rug-xma011102vupg';
const bgs=['red','green','navy','cream','charcoal','burgundy'];
const socs=['red','green','blue','gold','cream','pink','plum','teal'];
const uniq=(i)=>`${BASE}?background=${bgs[i%6]}&member=${1+i%6}&name=Family%20${i}&soc1=${socs[i%8]}&soc2=${socs[(i+3)%8]}&soc3=${socs[(i+5)%8]}&year=202${i%10}`;
const pct=(a,p)=>a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))];
const stat=(a)=>({p50:+pct(a,.5).toFixed(1),p95:+pct(a,.95).toFixed(1),avg:+(a.reduce((s,x)=>s+x,0)/a.length).toFixed(1)});
(async()=>{
  for(const w of [400,800,1200]) await r.render({url:uniq(999),w,format:'webp'});   // warm assets+parts
  for(const [label,w,fmt] of [['800px webp',800,'webp'],['1200px webp',1200,'webp'],['1600px webp',1600,'webp'],['800px jpeg',800,'jpeg']]){
    const ts=[],parts={artwork:[],composite:[],encode:[]};
    for(let i=0;i<40;i++){const res=await r.render({url:uniq(i+label.length*1000),w,format:fmt});
      ts.push(res.timings.total);parts.artwork.push(res.timings.artwork);parts.composite.push(res.timings.composite);parts.encode.push(res.timings.encode);}
    const s=stat(ts);
    console.log(`COLD ${label.padEnd(12)} total p50 ${String(s.p50).padStart(6)}ms p95 ${String(s.p95).padStart(6)}ms  | art ${stat(parts.artwork).p50}  comp ${stat(parts.composite).p50}  enc ${stat(parts.encode).p50}`);
  }
  // warm cache
  const hot=[];
  for(let i=0;i<200;i++){const t=process.hrtime.bigint();await r.render({url:uniq(5),w:800,format:'webp'});hot.push(Number(process.hrtime.bigint()-t)/1e6);}
  console.log('WARM cache hit   ',JSON.stringify(stat(hot)),'ms');
  // throughput: concurrent unique renders
  const t0=Date.now();const N=60;
  await Promise.all(Array.from({length:N},(_,i)=>r.render({url:uniq(50000+i),w:800,format:'webp'})));
  const el=(Date.now()-t0)/1000;
  console.log(`THROUGHPUT ${N} unique cold renders in ${el.toFixed(2)}s = ${(N/el).toFixed(1)} renders/sec (2 vCPU)`);
  console.log('cache',JSON.stringify(r.cache.info()));
  console.log('parts',JSON.stringify(r.parts.info()));
  console.log('assets',JSON.stringify(r.assets.stats()));
})();
