/*
Mongo Connect Module [DAEMON]
*/

"use strict";

// Require files
var config = require('./config/mongoConnect.daemon.config.json'),
MongoClient = require('mongodb').MongoClient,
logger = global.logger;
logger.log("Mongo Connect Module [DAEMON] started.", 4, false, config.moduleName, __line, __file);

// Username and password
var auth = "",
endString = config.useDB,

// Make sure all specified indexes are present
createIndexes = (attempt, err) => {
  attempt = attempt || 1;
  err = err || "";

  // Try 3 times before failing
  if(attempt > 3) {
    logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
    return;
  }

  var indexes = config.indexes;
  for(var i = 0; i < indexes.length; i++) {
    indexes[i].options = indexes[i].options || {};
    global.mongoConnect.collection(indexes[i].collection).ensureIndex(indexes[i].index, indexes[i].options, (err, indexName) => {
      if(err) {
        createIndexes(++attempt, err);
      }
    });
  }

  // Success
  logger.log("There " + (indexes.length === 1 ? "is" : "are") + " " + indexes.length + " active database index" + (indexes.length === 1 ? "" : "es") + ".", 6, false, config.moduleName, __line, __file);
};

if(config.auth.credentials) {
  auth = config.auth.user + ":" + config.auth.pwd + "@";
  endString += "?authMechanism=SCRAM-SHA-1&authSource=" + config.useDB;
}

// Connect to DB
var url = "mongodb://" + auth + config.dbAddress + ":" + config.dbPort + "/" + endString,
authlessUrl = config.dbAddress + ":" + config.dbPort;

// Function create connection
var dbConnect = (callback) => {
  MongoClient.connect(url, (err, db) => {
    if(callback) callback();
    if(!err) {
      logger.log("Successfully connected to database at " + authlessUrl + ".", 4, false, config.moduleName, __line, __file);
    } else {
      logger.log("Could not connect to database at " + authlessUrl + ". Is the database running? (" + err + ")", 1, true, config.moduleName, __line, __file);
      process.exit(1);
    }
    global.mongoConnect = db;

    // Create the DB indexes
    createIndexes();
  });
};

// Create the connection
dbConnect();

// Periodic check for connection to database
var checkDBConnection = (attempt) => {
  attempt = attempt || 0;
  var killScript = false;
  if(attempt > config.DBCheck.maxAttempts - 2) killScript = true;
  global.mongoConnect.listCollections().toArray((err, cols) => {
    if(err) {
      logger.log("DBCheck failed. Is the database running? (" + err + ")" + (!killScript ? " Trying again..." : " Killing process."), 1, true, config.moduleName, __line, __file);
      if(!killScript) {
        setTimeout(() => {dbConnect(() => {checkDBConnection(++attempt)})}, 5000);
      } else {
        process.exit(1);
      }
    } else {
      if(config.DBCheck.successLogging) logger.log("DBCheck successful.", 6, false, config.moduleName, __line, __file);
      return;
    }
  });
}

if(config.DBCheck.enabled) {
  setInterval(checkDBConnection, config.DBCheck.interval);
}
