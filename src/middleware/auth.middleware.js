const HttpException = require('../utils/HttpException.utils');
const UserModel = require('../models/user.model');
const jwt = require('jsonwebtoken');
const {secret_jwt} = require('../startup/config')

const auth = (...roles) => {
    return async function (req, res, next) {
        try {
            const authHeader = req.headers.authorization;
            const bearer = 'Bearer ';

            if (!authHeader || !authHeader.startsWith(bearer)) {
                throw new HttpException(401, req.mf('Access denied. No credentials sent!'));
            }

            const token = authHeader.slice(bearer.length);

            // Verify Token (faqat HS256 — "alg: none" va boshqa algoritmlar rad etiladi)
            let decoded;
            try {
                decoded = jwt.verify(token, secret_jwt, { algorithms: ['HS256'] });
            } catch (e) {
                throw new HttpException(401, req.mf('Authentication failed!'));
            }
            if (!decoded || decoded.user_id === undefined || decoded.user_id === null) {
                throw new HttpException(401, req.mf('Authentication failed!'));
            }

            const user = await UserModel.findOne({where:{ id: decoded.user_id }});

            if (!user) {
                throw new HttpException(401, req.mf('Authentication failed!'));
            }

            // Rol tekshiruvi. Avval "egasi" (req.params.id == user.id) bo'lsa rol
            // tekshiruvi o'tkazib yuborilardi — oddiy User PATCH /users/id/<o'z id>
            // bilan o'zini Admin qila olardi. Endi rol har doim tekshiriladi.
            if (roles.length && !roles.includes(user.role)) {
                throw new HttpException(403, req.mf('Unauthorized'));
            }

            req.currentUser = user;

            next();

        } catch (e) {
            // Auth xatolari 401/403; baza xatosi va boshqalar o'z statusi bilan (500)
            next(e);
        }
    }
}

module.exports = auth;
