/*
Users Module
*/

// Require files
var apiResponses = global.apiResponses
var logger = global.logger;

// Return requested users
exports.getUsers = (params, connection) => {
  if(params.users) {
    var getIDs = params.users.split(",");
    var resArray = [];
    var queryCallback = (err, docs) => {
      if(!err) {
        resArray.push(docs);
      } else {
        connection.send(apiResponses.strings.errors.failed);
        logger.log("Failed database query. (" + err + ")", 2, true, "Users Module (users.js)");
      }
    };
    for(var i = 0; i < getIDs.length; i++) {
      global.mongoConnect.collection("users").find({id:getIDs[i]}).limit(1).each(queryCallback);
    }
    connection.send(JSON.stringify({
      "type": "response",
      "status": "success",
      "content": resArray
    }));
  } else {
    connection.send(apiResponses.strings.errors.missingParameters);
  }
};

// Authenticate Users
exports.auth = (params, connection) => {
  if(params.auth && params.auth[0] && params.auth[1]) {
    var queryCallback = (err, docs) => {
      if(!err) {
        if(docs.passwd === params.auth[1]) {
          
        } else {
          connection.send(apiResponses.errors.authFailed);
        }
      } else {
        connection.send(apiResponses.strings.errors.failed);
        logger.log("Failed database query. (" + err + ")", 2, true, "Users Module (users.js)");
      }
    }
    global.mongoConnect.collection("users").find({user:params.auth[0]}).limit(1).each(queryCallback);
  } else {
    connection.send(apiResponses.strings.errors.missingParameters)
  }
}
