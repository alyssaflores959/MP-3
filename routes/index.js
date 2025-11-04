/*
 * Connect all of your endpoints together here.
 */
module.exports = function (app, router) {
    // load each route module
    require('./home')(router);
    require('./users')(router);
    require('./tasks')(router);

    // prefix everything with /api
    app.use('/api', router);
};