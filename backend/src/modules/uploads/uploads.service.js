function createUploadsService(deps) {
  const repo = deps.repository;

  function uploadMenuImage(req, res) {
    const file = req.file;
    if (!file) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'image file is required.');
    }

    const normalizedFilename = file.filename.replace(/\\/g, '/');
    const relativePath = `/uploads/menu/${normalizedFilename}`;
    const url = repo.buildPublicUrl(req, relativePath);

    deps.audit?.({
      action: 'menu_image.upload',
      entityType: 'upload',
      entityId: file.filename,
      tenantId: req.auth?.tenantId,
      actorUserId: req.auth?.userId,
      actorEmail: req.auth?.email,
      status: 'success',
      details: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: relativePath,
      },
    });

    return res.status(201).json({
      filename: file.filename,
      contentType: file.mimetype,
      size: file.size,
      path: relativePath,
      url,
    });
  }

  return {
    uploadMenuImage,
  };
}

module.exports = {
  createUploadsService,
};
