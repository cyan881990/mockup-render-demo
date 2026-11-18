const BASE=process.env.BASE||'http://localhost:3000';
const P='/render?url='+encodeURIComponent('https://macorner.co/products/christmas-together-personalized-runner-rug-xma011102vupg');
const bgs=['red','green','navy','cream','charcoal','burgundy'],socs=['red','green','blue','gold','cream','pink','plum','teal'];
const u=(i,w)=>`${BASE}${P}&background=${bgs[i%6]}&member=${1+i%6}&name=${encodeURIComponent('Family '+i)}&soc1=${socs[i%8]}&soc2=${socs[(i+3)%8]}&soc3=${socs[(i+5)%8]}&w=${w}&format=webp`;
const pct=(a,p)=>a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))];
async function run(label,urls,conc){
  const lat=[],sizes=[];let i=0;const t0=Date.now();
  await Promise.all(Array.from({length:conc},async()=>{
    while(i<urls.length){const my=i++;const s=performance.now();
      const r=await fetch(urls[my]);const b=await r.arrayBuffer();
      lat.push(performance.now()-s);sizes.push(b.byteLength);}}));
  const el=(Date.now()-t0)/1000;
  console.log(`${label.padEnd(34)} n=${urls.length} conc=${conc}  p50 ${pct(lat,.5).toFixed(1)}ms  p95 ${pct(lat,.95).toFixed(1)}ms  ${(urls.length/el).toFixed(1)} req/s  avg ${(sizes.reduce((a,b)=>a+b,0)/sizes.length/1024).toFixed(0)}KB`);
}
(async()=>{
  await run('warm-up (ignore)',Array.from({length:12},(_,i)=>u(i,800)),4);
  await run('cold unique @800',Array.from({length:120},(_,i)=>u(1000+i,800)),8);
  await run('cold unique @1200',Array.from({length:60},(_,i)=>u(9000+i,1200)),8);
  await run('cold unique @400 (grid thumb)',Array.from({length:120},(_,i)=>u(20000+i,400)),8);
  await run('cache hit (same url x400)',Array.from({length:400},()=>u(7,800)),16);
  const m=await (await fetch(BASE+'/metrics')).json();
  console.log('\ncache',JSON.stringify(m.cache));console.log('parts',JSON.stringify(m.parts));
  console.log('cold breakdown',JSON.stringify(m.coldRender));
})();
