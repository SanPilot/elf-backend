/*
Logger Daemon [CORE MODULE]
*/

"use strict";

// Require config
var config = require('./config/logger.daemon.core.config.json');

// Require modules
var chalk = require('chalk'), fs = require('fs');

// used for status later down
var writeToFileStatus;

// where to log errors
var errorLogFile = (config.file.separateErrorLog ? config.file.errorLogFile : config.file.logFile);

// function to write to file
var writeToFile = function(message, useErrorFile) {
  var path = (useErrorFile ? errorLogFile : config.file.logFile);
  fs.appendFile(path, message + "\n", (err) => {
    if(err) {
      console.error(chalk.red(config.moduleName + " [ERROR, LOGLEVEL " + 1 + "] at " + Date() + ": " + chalk.bold("Unable to log to file! Error message: " + err)));
    }
  });
};

// logging function to be exported
var log = function(message, logLevel, error, name) {

  // console logging
  if(config.console.logging && logLevel <= config.console.logLevel) {

    // Error message
    if(error) {
      console.error(chalk.red(name + " [ERROR, LOGLEVEL " + logLevel + "] at " + Date() + ": " + chalk.bold(message)));

      // Normal message
    } else {
      console.log(name + " [LOG, LOGLEVEL " + logLevel + "] at " + Date() + ": " + chalk.bold(message));
    }
  }

  // file logging
  if(config.file.logging && logLevel <= config.file.logLevel) {

    // Error message
    if(error) {
      writeToFile(name + " [ERROR, LOGLEVEL " + logLevel + "] at " + Date() + ": " + message, true);

      // Normal message
    } else {
      writeToFile(name + " [LOG, LOGLEVEL " + logLevel + "] at " + Date() + ": " + message, false);
    }
  }
};

// export log function
exports.log = log;

// Log stuff
log("Logger Daemon [CORE MODULE] started and ready to go!", 3, false, config.moduleName);
log("This is an example log message", 5, false, config.moduleName);
log("This is an example error message", 5, true, config.moduleName);
