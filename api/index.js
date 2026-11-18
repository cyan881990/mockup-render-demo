'use strict';
/** Vercel serverless entry: hands the request to the same Fastify app used locally. */
const { app } = require('../server');

let ready = null;
module.exports = async (req, res) => {
  if (!ready) ready = app.ready();
  await ready;
  app.server.emit('request', req, res);
};
