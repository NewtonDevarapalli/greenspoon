function createUploadsRepository(deps) {
  return {
    buildPublicUrl: deps.buildPublicUrl,
  };
}

module.exports = {
  createUploadsRepository,
};
