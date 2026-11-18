const fs=require('fs');
const {Registry}=require('../src/registry');
const {AssetStore}=require('../src/assets');
const {RenderCache}=require('../src/cache');
const {Renderer}=require('../src/render');
const settings=JSON.parse(fs.readFileSync(__dirname+'/../data/settings.json','utf8'));
const reg=new Registry().loadAll();
const assets=new AssetStore({widths:settings.widths});
const cache=new RenderCache({memoryMB:settings.memoryCacheMB, diskEnabled:false});
const r=new Renderer(reg,assets,cache,settings);
(async()=>{
  const url='https://macorner.co/products/christmas-together-personalized-runner-rug-xma011102vupg?background=red&member=3&soc1=blue&name=Nguyen&soc2=green&utm_source=fb';
  const res=await r.render({url, w:1200, format:'jpeg'});
  fs.writeFileSync('/tmp/r1.jpg',res.body);
  console.log(JSON.stringify({meta:res.meta,timings:res.timings,tier:res.tier},null,1));
  const art=await r.render({url, mode:'artwork', w:1200, format:'png'});
  fs.writeFileSync('/tmp/a1.png',art.body);
  console.log('artwork bytes',art.body.length, art.timings);
})().catch(e=>{console.error(e); process.exit(1);});
