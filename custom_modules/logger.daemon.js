/*
Logger Module [DAEMON]
*/


// Require config
var config = require('./config/logger.daemon.config.json');

// Require modules
var chalk = require('chalk'), fs = require('fs');

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

  // HH:MM:SS
  var date = new Date();

  var time = date.getHours();
  time = (time < 10 ? "0" : "") + time;

  var min  = date.getMinutes();
  time += ":" + (min < 10 ? "0" : "") + min;

  var sec  = date.getSeconds();
  time += ":" + (sec < 10 ? "0" : "") + sec;

  // Replace template variables
  var replace = [
    ["M", chalk.bold(message)],
    ["E", logLevel],
    ["N", name],
    ["L", line],
    ["F", file],
    ["T", time]
  ];

  var logString = config.logPatterns[(error ? "error" : "log")];

  // iterate through keys
  for(var i = 0; i < replace.length; i++) {
    logString = logString.replace(new RegExp("\\$" + replace[i][0], 'g'), replace[i][1]);
  }

  // console logging
  if(config.console.logging && logLevel <= config.console.logLevel) {

    // Error message
    if(error) {
      console.error(chalk.red(logString));

      // Normal message
    } else {
      console.log(logString);
    }
  }

};

// export log function
exports.log = log;

// Log stuff
log("Logger Module [DAEMON] started and ready to go!", 4, false, config.moduleName, __line, __file);
