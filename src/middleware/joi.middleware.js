const middleware = (schema, property) => {
  return (req, res, next) => {
    // perms va boshqa validatsiya shart bo'lmagan maydonlarni saqlab qo'yamiz
    const perms = req.body.perms;

    const options = {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: false,
    };
    const { error, value } = schema.validate(req.body, options);

    if (error) {
      const { details } = error;
      const message = details.map(i => i.message).join(',');
      console.log(`Validation error: ${ message }`);
      next(error);
    } else {
      req.body = value;
      // perms ni doim saqlаymiz (validatsiya uni o'zgartirgan bo'lsa ham)
      req.body.perms = perms !== undefined ? perms : null;
      next();
    }
  }
}

module.exports = middleware;