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
  global.mongoConnect.collection("users").find({caselessUser: user.toLowerCase}).toArray((err, docs) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
      setTimeout(() => {
        sendNotification(notification, user, callback, ++attempt);
      }, 10000);
      return;
    }
    if(docs.length === 0) {
      return;
    }
    var currentNotifications = docs[0].notifications || [];
    currentNotifications.push(notification);

    // Now add this notification to the database
    global.mongoConnect.collection("users").updateOne({caselessUser: user.toLowerCase}, {$set: {notifications: currentNotifications}}).then((r) => {
      if(!r.result.ok) {
        logger.log("Failed database query. (" + r.result + ")", 2, true, config.moduleName);
        setTimeout(() => {
          sendNotification(notification, user, callback, ++attempt);
        }, 10000);
        return;
      }
      logger.log("Sent notification to user '" + docs.user + "'.", 6, false, config.moduleName);
      return;
    });
  });
};
exports.sendNotification = sendNotification;
