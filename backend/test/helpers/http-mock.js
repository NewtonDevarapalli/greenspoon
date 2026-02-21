function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
}

function sendError(res, status, code, message, details = {}) {
  return res.status(status).json({ code, message, details });
}

module.exports = {
  createMockRes,
  sendError,
};
