'use strict';
/**
 * Production entry point: one render worker per core, sharing the listening socket.
 * Each worker keeps its own memory cache; the disk cache (and any CDN in front) is shared.
 */
const cluster = require('cluster');
const os = require('os');

const WORKERS = Number(process.env.WORKERS) || Math.max(1, os.cpus().length);

if (cluster.isPrimary) {
  console.log(`[cluster] starting ${WORKERS} render workers`);
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    console.warn(`[cluster] worker ${worker.process.pid} exited (${signal || code}) — restarting`);
    cluster.fork();
  });
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { for (const w of Object.values(cluster.workers)) w.kill(sig); process.exit(0); });
  }
} else {
  require('./server');
}
