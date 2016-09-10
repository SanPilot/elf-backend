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
  if(!params.JWT) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malacious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

}
