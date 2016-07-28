/*
Tasks Module
*/


// Require files
var apiResponses = global.apiResponses,
logger = global.logger,
config = require("./config/tasks.config.json"),
users = require("./users.js");

// Function to add a task
exports.addTask = (params, connection) => {
  if(!params.JWT) {}
}
