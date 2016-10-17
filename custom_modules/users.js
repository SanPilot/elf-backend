/*
Users Module
*/

// Require files
var apiResponses = global.apiResponses,
logger = global.logger,
fs = require('fs'),
crypto = require('crypto'),
config = require('./config/users.config.json');

// Function for password hashing
var passwdHash = (passwd, user, salt, callback) => {
  var userHash = crypto.createHash('sha512').update(user).digest('hex');
  crypto.pbkdf2(passwd, salt + userHash + salt, 100000, 512, 'sha512', (err, key) => {
    if(!err) {
      callback({"status":true,"hashedPasswd":key.toString('hex')});
    } else {
      callback({"status": false});
    }
  });
};

// Function to sign data
var generateSig = (body) => {
  return crypto.createSign('RSA-SHA256').update(body).sign(fs.readFileSync(config.signingKeyFiles.private, "utf8"), 'hex');
};

// Function to verify signature
var verifySig = (body, sig) => {
  return crypto.createVerify('RSA-SHA256').update(body).verify(fs.readFileSync(config.signingKeyFiles.public, "utf8"), sig, 'hex');
};

// Functions for dealing with base64
var btoa = (string) => {
  return new Buffer(string).toString('base64');
}

var atob = (encoded) => {
  return new Buffer(encoded, 'base64').toString('ascii');
}

// Export a function to get the body of a token
var getTokenInfo = (JWT) => {
  var token = {};
  try {
    JWT = JWT.split('.');
    token.header = JSON.parse(atob(JWT[0]));
    token.payload = JSON.parse(atob(JWT[1]));
    token.signature = atob(JWT[2]);
    token.body = JWT[0] + "." + JWT[1];
    return token;
  } catch(e) {
    return false;
  }
}

exports.getTokenInfo = getTokenInfo;

// Function for checking how many results match a query to the DB
var dbMatches = (collection, query, callback) => {
  global.mongoConnect.collection(collection).find(query).toArray((err, docs) => {
    if(!err) {
      callback({"status":true,"matches":docs.length});
    } else {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
      callback({"status":false});
    }
  });
}

// Function to verify authentication token
var verifyJWT = (JWT) => {
  var token = {};
  JWT = getTokenInfo(JWT);
  if(!JWT) return false;
  token.header = JWT.header;
  token.payload = JWT.payload;
  token.signature = JWT.signature;
  token.body = JWT.body;

  // Make sure token is valid
  if(token.payload.user && token.payload.expires > Math.floor(new Date() / 1000) && verifySig(token.body, token.signature)) {
    return true;
  } else {
    return false;
  }
}

// Export this function for other scripts to use
exports.verifyJWT = verifyJWT;

// Function for generating JWT
var generateJWT = (payload) => {
  var header = {
    "alg": "RS256",
    "typ": "JWT"
  },
  headerB64 = btoa(JSON.stringify(header)),
  payloadB64 = btoa(JSON.stringify(payload)),
  signature = generateSig(headerB64 + '.' + payloadB64),
  signatureB64 = btoa(signature);
  return headerB64 + '.' + payloadB64 + '.' + signatureB64;
};

// Function to only get parts of an object
var getObjectParts = (obj, parts, callback) => {
  var returnObj = {};
  for(var i2 = 0; i2 < parts.length; i2++) {
    if(obj.hasOwnProperty(parts[i2])) {
      returnObj[parts[i2]] = obj[parts[i2]];
    }
    if(i2 + 1 === parts.length) {
      callback(returnObj);
    }
  }
}

// Return requested users
exports.getUsers = (params, connection) => {
  if(!(params.users && params.JWT)) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true)); return;}
  if(params.users.constructor !== Array) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true)); return;}
  for(var i = 0; i < params.users.length; i++) {
    if(typeof params.users[i] !== "string") {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true)); return;}
  }
  if(verifyJWT(params.JWT)) {
    var getUsers = params.users,
    resArray = [],
    queryFailed,
    queryCallback = (err, docs, last) => {
      if(!err) {
        getObjectParts(docs, ["user", "caselessUser", "name", "email", "active"], (resultObj) => {
          resArray.push(resultObj);
        });
      } else {
        queryFailed = true;
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
      }
      if(last) {
        if(!queryFailed) {
          connection.send(JSON.stringify({
            "type": "response",
            "status": "success",
            "id": params.id,
            "content": resArray
          }));
        } else {
          connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        }
      }
    };

    // Get info for each user in the array
    if(!getUsers.length) {
      global.mongoConnect.collection("users").find({active:true}).toArray((err, docs) => {
        if(err) {
          logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
          connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
          return;
        }
        for(var iu = 0; iu < docs.length; iu++) {
          queryCallback(err, docs[iu], iu === docs.length - 1)
        }
      });
    } else {
      for(var iu = 0; iu < getUsers.length; iu++) {
        global.mongoConnect.collection("users").find({caselessUser:getUsers[iu].toLowerCase()}).limit(1).next((err, docs) => {
          if(!docs) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true)); return;}
          queryCallback(err, docs, docs.caselessUser === getUsers[getUsers.length - 1].toLowerCase());
        });
      }
    }
  } else {
    logger.log("Recieved possibly malacious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
  }
};

// Authenticate Users
exports.auth = (params, connection) => {
  if(!(params.auth && params.auth[0] && params.auth[1])) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(typeof params.auth[0] !== "string" || typeof params.auth[1] !== "string") {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true)); return;}
  dbMatches("users", {caselessUser:params.auth[0].toLowerCase()}, (result) => {
    if(result.status) {
      if(result.matches > 0) {
        var queryCallback = (err, docs) => {
          if(!err) {
            if(!docs.active) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true)); return;}
            passwdHash(params.auth[1], docs.user, docs.salt, (result) => {
              if(result.status) {
                if(docs.passwd === result.hashedPasswd) {
                  var expires = Math.floor(new Date() / 1000) + 18000;
                  connection.send(JSON.stringify({
                    "type": "response",
                    "status": "success",
                    "id": params.id,
                    "content": {
                      "token": generateJWT({"user": docs.user, "iat": Math.floor(new Date() / 1000), "expires": expires}),
                      "expires": expires
                    }
                  }));
                } else {
                  connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
                }
              } else {
                connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
              }
            });
          } else {
            connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
            logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
          }
        }
        global.mongoConnect.collection("users").find({caselessUser:params.auth[0].toLowerCase()}).limit(1).next(queryCallback);
      } else {
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
      }
    } else {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
    }
  });
}

// Function to create salt
var generateSalt = () => {
  return crypto.randomBytes(512).toString('base64');
}

// Add a user to the DB
exports.createUser = (params, connection) => {
  if(!params.create || !params.create[0] || !params.create[1] || !params.create[2] || !params.create[3]) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true)); return;}
  if(typeof params.create[0] !== "string" || typeof params.create[1] !== "string" || typeof params.create[2] !== "string" || typeof params.create[3] !== "string") {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true)); return;}
  var user = params.create[0],
  name = params.create[1],
  passwd = params.create[2],
  email = params.create[3];

  // Make sure parameters are good
  if(!(/^[A-Za-z0-9_-]+$/ig.test(user) && /^[A-Za-z ]+$/ig.test(name) && /^.+[@＠].+/ig.test(email))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.invalidField, {id: params.id}, true));
    return;
  }

  dbMatches("users", {caselessUser:params.create[0].toLowerCase()}, (result) => {
    if(result.status) {
      // Check if user already exists
      if(result.matches === 0) {

        // Generate Salt
        var salt = generateSalt();

        // Hash password
        passwdHash(passwd, user, salt, (result) => {
          if(result.status) {
            // Insert new user into db
            global.mongoConnect.collection("users").insertOne({user:user, caselessUser: user.toLowerCase(), name:name, passwd:result.hashedPasswd, salt:salt, email:email, active:true}, (err) => {
              if(!err) {
                connection.send(JSON.stringify({
                  "type": "response",
                  "status": "success",
                  "id": params.id,
                  "content": generateJWT({"user": user, "iat": Math.floor(new Date() / 1000), "expires": Math.floor(new Date() / 1000) + 18000})
                }));
                logger.log("Added new user '" + user + "'.", 6, false, config.moduleName);
              } else {
                logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
                connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
              }
            });
          } else {
            connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
          }
        });
      } else {
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.userAlreadyExists, {"id": params.id}, true));
      }
    } else {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
    }
  });
}

// Remove a user from the db
exports.removeUser = (params, connection) => {
  if(!params.JWT) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true)); return;}
  if(!verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malacious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }
  var userToDelete = getTokenInfo(params.JWT).payload.user.toLowerCase();

  // Check if this user exists
  dbMatches("users", {caselessUser:userToDelete}, (result) => {
    if(!result.status || result.matches === 0) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true)); return;}

    // Make sure user isn't already inactive
    global.mongoConnect.collection("users").find({caselessUser:userToDelete}).limit(1).next((err, docs) => {
      if(docs.active) {
        // Set user to inactive
        global.mongoConnect.collection("users").updateOne({caselessUser:userToDelete}, {$set: {active:false}}, (err) => {
          if(!err) {
            logger.log("Removed user '" + userToDelete + "'.")
            connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id}, true));
          } else {
            logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
            connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
          }
        });
      } else {
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      }
    });
  });
}
