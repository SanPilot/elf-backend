/*
Logger Module [DAEMON]
*/


// Require config
var config = require('./config/logger.daemon.config.json');

// Require modules
var chalk = require('chalk'), fs = require('fs');

// where to log errors
var errorLogFile = (config.file.separateErrorLog ? config.file.errorLogFile : config.file.logFile);

// function to write to file
var writeToFile = (message, useErrorFile) => {
  var path = (useErrorFile ? errorLogFile : config.file.logFile);
  fs.appendFile(path, message + "\n", (err) => {
    if(err) {
      console.error(chalk.red(config.moduleName + " [ERROR, LOGLEVEL " + 1 + "] at " + Date() + ": " + chalk.bold("Unable to log to file! Error message: " + err)));
    }
  });
};

// global properties to find line and function
Object.defineProperty(global, '__stack', {
  get: function() {
    var orig = Error.prepareStackTrace;
    Error.prepareStackTrace = function(_, stack) {
      return stack;
    };
    var err = new Error;
    Error.captureStackTrace(err, arguments.callee);
    var stack = err.stack;
    Error.prepareStackTrace = orig;
    return stack;
  }
});

Object.defineProperty(global, '__line', {
  get: function() {
    return __stack[1].getLineNumber();
  }
});

Object.defineProperty(global, '__file', {
  get: function() {
    return __stack[1].getFileName();
  }
});

// logging function to be exported
var log = function(message, logLevel, error, name, line, file) {

  var loc = (line ? ", LINE " + line : "") + (file ? ", FILE '" + file + "'" : "");

  // console logging
  if(config.console.logging && logLevel <= config.console.logLevel) {

    // Error message
    if(error) {
      console.error(chalk.red(name + " [ERROR, LOGLEVEL " + logLevel + loc + "] at " + Date() + ": " + chalk.bold(message)));

      // Normal message
    } else {
      console.log(name + " [LOG, LOGLEVEL " + logLevel + loc + "] at " + Date() + ": " + chalk.bold(message));
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
log("Logger Module [DAEMON] started and ready to go!", 4, false, config.moduleName, __line, __file);
