/*
Mongo Connect Module [DAEMON]
*/

"use strict";

// Require files
var config = require('./config/mongoConnect.daemon.config.json'),
MongoClient = require('mongodb').MongoClient,
logger = global.logger;
logger.log("Mongo Connect Module [DAEMON] started and ready to go!", 4, false, config.moduleName);

// Username and password
var auth = "",
endString = config.useDB;

if(config.auth.credentials) {
  auth = config.auth.user + ":" + config.auth.pwd + "@";
  endString = config.useDB + "?authMechanism=SCRAM-SHA-1&authSource=" + config.useDB;
}

// Connect to DB
var url = "mongodb://" + auth + config.dbAddress + ":" + config.dbPort + "/" + endString;

MongoClient.connect(url, (err, db) => {
  if(!err) {
    logger.log("Successfully connected to database at " + url + ".", 4, false, config.moduleName);
  } else {
    logger.log("Could not connect to database at " + url + ". Is the database running? (" + err + ")", 1, true, config.moduleName);
    process.exit(1);
  }
  global.mongoConnect = db;
});

// Periodic check for connection to database
var checkDBConnection = (attempt) => {
  attempt = attempt || 0;
  var killScript = false;
  if(attempt > config.DBCheck.maxAttempts - 1) killScript = true;
  MongoClient.connect(url, (err, db) => {
    if(err || db === null) {
      logger.log("DBCheck failed. Is the database running? (" + err + ")" + (!killScript ? " Trying again..." : " Killing process."), 1, true, config.moduleName);
      if(!killScript) {
        setTimeout(() => {checkDBConnection(++attempt)}, 5000);
        return;
      } else {
        process.exit(1);
        return;
      }
    } else {
      logger.log("DBCheck successful.", 3, false, config.moduleName);
      db.close();
      return;
    }
  });
}

if(config.DBCheck.enabled) {
  setInterval(checkDBConnection, config.DBCheck.interval);
}
