/*
Notify Module [DAEMON]
*/

// Require files
var apiResponses = global.apiResponses,
logger = global.logger,
users = require("./users.js"),
config = require("./config/notify.daemon.config.json");

// Function to send users notifications
var sendNotification = (notification, user, callback, attempt) => {
  attempt = attempt || 1;
  if(attempt > 10) return;
  notification.timestamp = Math.floor(new Date() / 1000);
  global.mongoConnect.collection("users").find({caselessUser: user.toLowerCase()}).toArray((err, docs) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      setTimeout(() => {
        sendNotification(notification, user, callback, ++attempt);
      }, 10000);
      return;
    }
    if(!docs.length) {
      return;
    }
    var currentNotifications = docs[0].notifications || [];
    currentNotifications.unshift(notification);

    // Now add this notification to the database
    global.mongoConnect.collection("users").updateOne({caselessUser: user.toLowerCase()}, {$set: {notifications: currentNotifications}}).then((r) => {
      if(!r.result.ok) {
        logger.log("Failed database query. (" + r.result + ")", 2, true, config.moduleName, __line, __file);
        setTimeout(() => {
          sendNotification(notification, user, callback, ++attempt);
        }, 10000);
        return;
      }
      global.emit("user:" + docs[0].user);
      logger.log("Sent notification to user '" + docs[0].user + "'.", 6, false, config.moduleName, __line, __file);
      return;
    });
  });
};
exports.sendNotification = sendNotification;

// Function to retrieve notifications
exports.getNotifications = (params, connection) => {
  if(!users.verifyJWT(params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }
  var user = users.getTokenInfo(params.JWT).payload.user;

  params.page = --params.page || 0;
  var perPage = 20;

  // Get the user's notifications
  global.mongoConnect.collection("users").find({caselessUser: user.toLowerCase()}).limit(1).toArray((err, docs) => {
    if(err || !docs.length) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    var notifications = docs[0].notifications || [];
    var totalNotifications = notifications.length;

    // Let's do some math!
    notifications = notifications.slice(params.page * perPage, (params.page + 1) * perPage);
    connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"content": {"notifications": notifications, page: params.page + 1, pages: Math.ceil(totalNotifications / perPage)}, "id": params.id}, true));
  });
}
