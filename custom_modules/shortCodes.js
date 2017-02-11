/*
Short Codes Module
*/

// Require files
var apiResponses = global.apiResponses,
logger = global.logger,
config = require("./config/shortCodes.config.json"),
crypto = require('crypto'),
users = require("./users.js");

// Function to create a new short code
var createShortCode = (type, id, callback, length, attempt) => {
  length = length || 5;
  attempt = attempt || 0;
  if(attempt > 4) {
    callback(true);
    return;
  }
  var shortCode = id.substr(0, length);
  users.dbMatches("codes", {code: shortCode}, (result) => {
    if(!result.status) {
      createShortCode(type, id, callback, length, ++attempt);
      return;
    }

    if(result.matches !== 0) {
      // The code is not unique; try again with one more character
      createShortCode(type, id, callback, ++length);
      return;
    }

    // The code is unique; add it to the db
    global.mongoConnect.collection("codes").insertOne({
      code: shortCode,
      type: type,
      id: id
    }, (err, r) => {

      // The query failed, try again
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
        createShortCode(type, id, callback, length, ++attempt);
        return;
      }

      // Return the final code
      logger.log(`Created new shortcode. (${shortCode})`, 6, false, config.moduleName, __line, __file);
      callback(false, shortCode);
    });
  });
}

// Export this function for other modules
exports.createShortCode = createShortCode;

// Function to resolve short codes to their respective item
exports.resolveShortCode = (params, connection) => {
  if(!(params.JWT && params.code)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(!(params.code.constructor === String && params.code.length)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {id: params.id}, true));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  // Find the code
  global.mongoConnect.collection("codes").findOne({code: params.code}, (err, doc) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    if(doc === null) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, "content": doc}, true));
  });
}
