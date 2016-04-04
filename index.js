/*
Index.js - Runs all modules and starts backend
*/

"use strict";

// Include required files
var config = require("./custom_modules/config/index.config.json"),
logger = require("./custom_modules/logger.daemon.js"),
express = require("express"),
helmet = require("helmet"),
expressServer = express(),
apis = [];

// Require API modules
for (var key in config.requireModules) {
  if (config.requireModules.hasOwnProperty(key)) {
    apis[key] = require("./custom_modules/" + config.requireModules[key]);
    logger.log("Required API module " + key + " with path \"" + config.requireModules[key] + "\".", 6, false, config.moduleName);
  }
}

// Log information
logger.log("Welcome to Elf. Index script started up successfully.", 3, false, config.moduleName);

// Configure server
logger.log("Starting Express HTTP server...", 4, false, config.moduleName);
logger.log("Notice: Logging from the Express server will not be logged through the Logger Daemon. It will therefore not be in the log file(s).", 6, false, config.moduleName);

// Configure express

// Add Helmet security
expressServer.use(helmet());

// Assign routes
for (var key in config.apiRoutes) {
  if (config.apiRoutes.hasOwnProperty(key)) {
    expressServer[config.apiRoutes[key][0]](key, apis[config.apiRoutes[key][1]][config.apiRoutes[key][2]]);
    logger.log("Added API route \"" + key + "\" type \"" + config.apiRoutes[key][0] + "\" with method \"" + config.apiRoutes[key][1] + "." + config.apiRoutes[key][2] + "\".", 6, false, config.moduleName);
  }
}

// Start server
expressServer.listen(config.usePort);
logger.log("Configuration complete, server active and listening on port " + config.usePort + ".", 3, false, config.moduleName);
