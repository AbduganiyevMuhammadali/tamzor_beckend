const winston = require('winston');
const { node_env } = require('../startup/config');

function errorMiddleware(error, req, res, next) {
    let { status = 500, message, data } = error;

    // Joi validatsiya xatosi — mijoz xatosi (400), server xatosi emas
    if (error && error.isJoi) {
        status = 400;
        data = {
            errors: (error.details || []).map(d => ({
                msg: d.message, param: (d.path || []).join('.'), location: 'body',
            })),
        };
    }
    // express.json() buzuq JSON — 400
    if (error && error.type === 'entity.parse.failed') status = 400;

    console.log(`[Error] ${error}`);
    winston.error(error.message, error);
    console.log(error.message);

    // MOBIL (APK) — javob konverti { error, message, error_code }.
    // APK body'dagi error ni o'qiydi (HTTP statusni emas), shuning uchun 200 bilan
    // yuboramiz. 401 (token yo'q/yaroqsiz) → error_code 405 (ilova logout qiladi).
    // Ikkala mobil prefiks: eski /api/mobile va asl serverga mos RashMilkNew/hs/AgentDostavshik.
    const isMobilePath = req.originalUrl && (
        req.originalUrl.startsWith('/api/mobile') ||
        req.originalUrl.startsWith('/RashMilkNew/hs/AgentDostavshik')
    );
    if (isMobilePath) {
        let msg;
        try { msg = req.mf(error.message); } catch (e) { msg = error.message; }
        if (status === 500 && node_env === 'production') msg = req.mf('Something went wrong');
        const error_code = (status === 401) ? 405 : status;
        return res.status(200).send({ error: true, message: msg || '', error_code, data: null });
    }
    // If status code is 500 - change the message to Intrnal server error
    if(error && error.isJoi){
        message = (error.details || []).map(d => d.message).join(', ') || message;
    }else if(message === 'excel_file'){
        message = req.mf('Only excel files are allowed');
    }else if(error.name === 'SequelizeUniqueConstraintError'){
        status = 400;
        const field = error.errors?.[0]?.path || 'maydon';
        message = `Bu ${field} allaqachon mavjud`;
        data = { errors: [{ msg: message, param: field, location: 'body' }] };
    }else if(message == 'Validation error'){
        const errors = [];
        error.errors.forEach(element => {
            element.message = req.mf(element.message);
            errors.push({
                msg: element.message,
                param: element.path,
                location: "body",
            })
        });
        status = 400;
        data = {errors: errors};

    }else {
        try {
            message = req.mf(error.message);
        } catch (e) {
            message = error.message; 
        }
    }
    // else
    //     message = status === 500 || !message ? 'Internal server error' : message;
    if(status === 500){
        // Ishlab chiqarishda ichki (SQL va h.k.) xato matni mijozga chiqarilmaydi — faqat logda
        if (node_env === 'production') {
            try { message = req.mf('Something went wrong'); } catch (e) { message = 'Something went wrong'; }
        } else {
            message = req.originalUrl + ' ' + message;
        }
    }

    error = {
        type: 'error',
        status,
        message,
        ...(data) && data
    }
   
    res.status(status).send(error);
}

module.exports = errorMiddleware;
/*
{
    type: 'error',
    status: 404,
    message: 'Not Found'
    data: {...} // optional
}
*/