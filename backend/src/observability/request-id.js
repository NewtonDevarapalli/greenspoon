const crypto = require('crypto');

function requestIdMiddleware(req, res, next) {
  const headerId = req.headers['x-request-id'];
  const id = typeof headerId === 'string' && headerId.trim().length > 0
    ? headerId.trim()
    : crypto.randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}

module.exports = {
  requestIdMiddleware,
};
