/*
Events Module
*/

// Require files
var config = require("./config/events.config.json"),
users = require("./users.js"),
apiResponses = global.apiResponses,
logger = global.logger,

// Hold registered users
registered = {};

// Function to respond to events
exports.events = (connection) => {

  // Register the user
  connection.on('message', (message) => {
    // Check for authentication
    if(!connection.authenticated) {
      if(users.verifyJWT(message.utf8Data)) {
        connection.authenticated = true;
        connection.send(apiResponses.strings.success);
        return;
      }
      connection.send(apiResponses.strings.errors.authFailed);
      return;
    }

    // Variable to hold registered eids
    connection.registered = connection.registered || [];

    // Register this user
    var eid = message.utf8Data;
    if(connection.registered.indexOf(eid) !== -1) {
      connection.send(apiResponses.strings.success);
      return;
    }
    if(registered[eid]) {
      registered[eid].push(connection);
    } else {
      registered[eid] = [connection];
    }
    logger.log(`Registered user to EID:${eid}.`, 6, false, config.moduleName, __line, __file);
    connection.registered.push(eid);
    connection.send(apiResponses.strings.success);
  });


  // Disassociate the user
  connection.on('close', () => {
    // Loop through the eids the user was registered to
    connection.registered.forEach((eid) => {
      registered[eid].splice(registered[eid].indexOf(connection), 1);
      if(!registered[eid].length) {
        delete registered[eid];
      }
    });
  });
};

// Function to push events to registered users
var emit = (eid) => {
  if(eid.constructor === Array) {
    eid.forEach((neid) => {
      emit(eid);
    });
    return;
  }
  if(registered[eid]) {
    registered[eid].forEach((connection) => {
      connection.send(eid);
    });
    logger.log(`Emitted EID:${eid} to ${registered[eid].length} users.`, 6, false, config.moduleName, __line, __file);
  }
}
global.emit = emit;
