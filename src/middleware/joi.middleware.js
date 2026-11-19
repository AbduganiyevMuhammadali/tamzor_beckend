const middleware = (schema, property) => {
  return (req, res, next) => {
    // perms va boshqa validatsiya shart bo'lmagan maydonlarni saqlab qo'yamiz
    const permsBor = Object.prototype.hasOwnProperty.call(req.body || {}, 'perms');
    const perms = permsBor ? req.body.perms : undefined;

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
      error.status = 400;
      next(error);
    } else {
      req.body = value;
      // perms faqat so'rovda yuborilgan bo'lsa saqlanadi (validatsiya uni o'zgartirgan bo'lsa ham).
      // Avval yuborilmaganda null qo'yilardi — foydalanuvchini tahrirlash ruxsatlarini o'chirib yuborardi.
      if (permsBor) req.body.perms = perms;
      else delete req.body.perms;
      next();
    }
  }
}

module.exports = middleware;