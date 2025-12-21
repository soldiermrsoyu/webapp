module.exports = (role) => {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.sendStatus(403);
    }
    next();
  };
};