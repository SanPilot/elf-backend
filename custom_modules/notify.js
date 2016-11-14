/*
Notify Module
*/

// Require files
var apiResponses = global.apiResponses,
logger = global.logger,
users = require("./users.js");

// Function to send users notifications
exports.sendNotification = (notification, user) => {
  global.mongoConnect.collection("users");
}
