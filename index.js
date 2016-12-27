/*
Index.js - Runs all modules and starts backend
*/

"use strict";

// Title of process in 'top' and 'ps' commands
process.title = 'elf-backend';

// Set global values
global.logger = require("./custom_modules/logger.daemon.js");
global.apiResponses = require("./custom_modules/apiResponses.daemon.js");
global.mongoConnect = require("./custom_modules/mongoConnect.daemon.js");

// Include required files + define variables
var config = require("./custom_modules/config/index.config.json"),
http = require("http"),
webSocketServer = require("websocket").server,
logger = global.logger,
apiResponses = global.apiResponses,
apis = [];

// Log information
logger.log("Welcome to Elf. Index script started up successfully.", 3, false, config.moduleName);

// Require API modules
for (var key in config.requireModules) {
  if (config.requireModules.hasOwnProperty(key)) {
    apis[key] = require("./custom_modules/" + config.requireModules[key]);
    logger.log("Required API module '" + key + "' with path \"" + config.requireModules[key] + "\".", 6, false, config.moduleName);
  }
}

// Configure server
logger.log("Starting API server...", 4, false, config.moduleName);

// Start HTTP server
var server = http.createServer(()=>{});
server.listen(config.usePort, () => {
  logger.log("API server started listening on port " + config.usePort + ".", 4, false, config.moduleName);
});

// Start WebSocket server
var wsServer = new webSocketServer({
  httpServer: server,
  maxReceivedFrameSize: config.maxMessageSize,
  maxRecievedMessageSize: config.maxMessageSize
});

wsServer.on('request', (request) => {
  setTimeout(() => {
    logger.log("Recieved API connection from origin " + request.origin + ".", 6, false, config.moduleName);
    var connection = request.accept(null, request.origin);

    var firstMessageSent = false;

    // limit messages per second
    var messagesInLastSecond = 0,
    freqBlock = false;

    // Reset every second
    setInterval(() => {
      messagesInLastSecond = 0;
    }, 1000);

    // accept message
    connection.on('message', (message) => {
      // Special ping/pong messaging to determine connectivity
      if(message.type === "utf8" && message.utf8Data === "ping") {
        connection.send("pong");
        // And that's it!
        return;
      }

      if(++messagesInLastSecond > config.freqBlock.messagesAllowedPerSecond) {
        freqBlock = true;
        setTimeout(() => {
          freqBlock = false;
        }, config.freqBlock.blockTime);
        logger.log("Possibly malacious requests blocked for being too frequent from " + connection.remoteAddress + ".", 4, true, config.moduleName);
      }
      if(!freqBlock) {
        if(connection.isSpecialConnection) return; // This is a special connection, don't respond to the message
        if(!firstMessageSent && message.type === 'utf8' && config.specialConnections[message.utf8Data]) {
          var specReg = config.specialConnections[message.utf8Data];
          // This request is a special request. Hand it off to be used by the module:
          apis[specReg[0]][specReg[1]](connection);

          // Respond to the message
          connection.send(apiResponses.strings.success);

          // Set a flag
          connection.isSpecialConnection = true;

          // End this function
          return;
        }
        firstMessageSent = true;
        if (message.type === 'utf8') {
          var msgObject;
          try {
            msgObject = JSON.parse(message.utf8Data);
          } catch(e) {
            connection.send(apiResponses.strings.errors.malformedRequest);
            return;
          }
          if(msgObject.id) {
            if(msgObject.action) {
              if(config.apiRoutes[msgObject.action]) {
                // This is the handoff - where the message is send to the registered (via config file) module with these three params.
                apis[config.apiRoutes[msgObject.action][0]][config.apiRoutes[msgObject.action][1]](msgObject, connection);
              } else {
                connection.send(apiResponses.concatObj(apiResponses.JSON.errors.invalidAction, {"id": msgObject.id}, true));
                return;
              }
            } else {
              connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": msgObject.id}, true));
              return;
            }
          } else {
            connection.send(apiResponses.strings.errors.missingParameters);
          }
        } else {
          connection.send(apiResponses.strings.errors.malformedRequest);
        }
      } else {
        connection.send(apiResponses.strings.errors.tooManyRequests);
        return;
      }
    });

    connection.on('close', () => {
      logger.log("Connection from " + request.origin + " closed.", 6, false, config.moduleName);
    });
  });
}, 2000);
