/*
Users Module
*/

// Require files
var apiResponses = global.apiResponses,
logger = global.logger,
fs = require('fs'),
crypto = require('crypto'),
config = require('./config/users.config.json'),
sanitize = require('sanitize-filename'),
fileStorage = require('./fileStorage.js');

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
      callback({"status":true, "matches": docs.length});
    } else {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      callback({"status":false});
    }
  });
}

exports.dbMatches = dbMatches;

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

// Escape strings to be inserted into regex
var escRegex = (str) => {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

// Make this function available to other modules
exports.escRegex = escRegex;

// Function to search for users in the db
exports.searchUsers = (params, connection) => {
  if(!(params.query && params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(!(params.query.constructor === String && params.query.length)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }
  if(!verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  // Create the regex for the db search
  var testExp = "^" + escRegex(params.query.toLowerCase()) + ".*$";

  // Search the db for this pattern
  global.mongoConnect.collection("users").find({caselessUser:{$regex:testExp}}).toArray((err, docs) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }

    // Get each username
    docs.forEach((user, i) => {
      docs[i] = user.user;
    });
    connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, "content": docs}, true));
  });
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
        resArray.push(docs);
      } else {
        queryFailed = true;
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
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
      global.mongoConnect.collection("users").find({active:true}, ['user', 'caselessUser', 'name', 'email', 'active', 'miscKeys', 'projects']).toArray((err, docs) => {
        if(err) {
          logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
          connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
          return;
        }
        for(var iu = 0; iu < docs.length; iu++) {
          queryCallback(err, docs[iu], iu === docs.length - 1)
        }
      });
    } else {
      for(var iu = 0; iu < getUsers.length; iu++) {
        var iterationStop = false;
        global.mongoConnect.collection("users").find({caselessUser:getUsers[iu].toLowerCase()}, ['user', 'caselessUser', 'name', 'email', 'active', 'miscKeys', 'projects']).limit(1).next((err, docs) => {
          if(!docs) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true)); iterationStop = true; return;}
          queryCallback(err, docs, docs.caselessUser === getUsers[getUsers.length - 1].toLowerCase());
        });
        if(iterationStop) return;
      }
    }
  } else {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
  }
};

// Authenticate Users
var auth = (params, connection) => {
  if(!(params.auth && params.auth[0] && params.auth[1])) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(typeof params.auth[0] !== "string" || typeof params.auth[1] !== "string") {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true)); return;}
  dbMatches("users", {$or: [
    {caselessUser: params.auth[0].toLowerCase()},
    {email: params.auth[0].toLowerCase()}
  ]}, (result) => {
    if(result.status) {
      if(result.matches === 1) {
        var queryCallback = (err, docs) => {
          if(!err) {
            if(!docs.active) {
              setTimeout(() => {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));}, config.passwordFailedTimeout);
              return;
            }
            passwdHash(params.auth[1], docs.user, docs.salt, (result) => {
              if(result.status) {
                if(docs.passwd === result.hashedPasswd) {
                  var expires = Math.floor(new Date() / 1000) + 3600;
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
                  setTimeout(() => {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));}, config.passwordFailedTimeout);
                }
              } else {
                connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
              }
            });
          } else {
            connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
            logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
          }
        }
        global.mongoConnect.collection("users").find({$or: [
          {caselessUser: params.auth[0].toLowerCase()},
          {email: params.auth[0].toLowerCase()}
        ]}).limit(1).next(queryCallback);
      } else {
        setTimeout(() => {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));}, config.passwordFailedTimeout);
      }
    } else {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
    }
  });
}
exports.auth = auth;

// Function to create salt
var generateSalt = () => {
  return crypto.randomBytes(512).toString('base64');
}

// Add a user to the DB
exports.createUser = (params, connection) => {
  if(!params.create || !params.create.user || !params.create.name || !params.create.passwd || !params.create.email) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true)); return;}
  if(typeof params.create.user !== "string" || typeof params.create.name !== "string" || typeof params.create.passwd !== "string" || typeof params.create.email !== "string" || !(params.create.miscKeys === undefined || params.create.miscKeys.constructor === Object)) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true)); return;}
  var user = params.create.user,
  name = params.create.name,
  passwd = params.create.passwd,
  email = params.create.email.toLowerCase(),
  miscKeys = params.create.miscKeys || {};

  // Make sure parameters are good
  if(!(/^[A-Za-z ]+$/ig.test(name) && /^.+[@＠].+/ig.test(email))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.invalidField, {id: params.id}, true));
    return;
  }
  if(sanitize(user) !== user || !(/^[A-Za-z0-9_-]+$/ig.test(user))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.invalidUser, {id: params.id}, true));
    return;
  }

  dbMatches("users", {$or: [
    {caselessUser: user.toLowerCase()},
    {email: email}
  ]}, (result) => {
    if(result.status) {
      // Check if user already exists
      if(result.matches === 0) {

        // Generate Salt
        var salt = generateSalt();

        // Hash password
        passwdHash(passwd, user, salt, (result) => {
          if(result.status) {
            // Insert new user into db
            global.mongoConnect.collection("users").insertOne({user:user, caselessUser: user.toLowerCase(), name:name, passwd:result.hashedPasswd, salt:salt, email:email, active:true, miscKeys:miscKeys, projects:[]}, (err) => {
              if(!err) {
                fileStorage.createDirs(user);
                logger.log("Added new user '" + user + "'.", 6, false, config.moduleName, __line, __file);
                auth({auth:[user,passwd],id:params.id}, connection);
              } else {
                logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
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

// Modify an existing user
exports.modifyUser = (params, connection) => {
  if(!(params.JWT && params.modify)) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true)); return;}
  if(!(params.modify.constructor === Object && (params.modify.name === undefined || params.modify.name.constructor === String) && (params.modify.passwd === undefined || params.modify.passwd.constructor === String) && (params.modify.email === undefined || params.modify.email.constructor === String) && (params.modify.miscKeys === undefined || params.modify.miscKeys.constructor === Object) && (params.modify.projects === undefined || params.modify.projects.constructor === Array))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }
  if(!verifyJWT(params.JWT)) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true)); return;}

  // Get the existing user information from the db
  var user = getTokenInfo(params.JWT).payload.user;
  global.mongoConnect.collection("users").findOne({caselessUser:user.toLowerCase()}, (err, doc) => {
    if(err || doc === undefined) {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      }
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    var name = params.modify.name || doc.name,
    email = (params.modify.email ? params.modify.email.toLowerCase() : doc.email.toLowerCase()),
    miscKeys = params.modify.miscKeys || doc.miscKeys,
    modPass = params.modify.passwd !== undefined,
    passwd = (modPass ? params.modify.passwd : doc.passwd),
    salt = (modPass ? generateSalt() : doc.salt),
    projects = params.modify.projects || doc.projects,
    hashCallback = (result) => {
      if(!result.status) {
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }

      // Make sure parameters are good
      if(!(/^[A-Za-z ]+$/ig.test(name) && /^.+[@＠].+/ig.test(email))) {
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.invalidField, {"id": params.id}, true));
        return;
      }

      // Update the user
      global.mongoConnect.collection("users").updateOne({user:user}, {$set: {name: name, email: email, miscKeys: miscKeys, passwd: result.hashedPasswd, salt: salt, projects: projects}}, (err) => {
        if(!err) {
          global.emit('user:' + user);
          logger.log("Modified user '" + user + "'.", 6, false, config.moduleName, __line, __file);
          if(modPass) {
            auth({auth:[user,passwd]}, connection);
          } else {
            connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id}, true));
          }
        } else {
          logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
          connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        }
      });
    },
    emailMatchCallback = () => {
      // Execute this function depending on if the password is to be changed or not
      if(modPass) {
        passwdHash(params.modify.passwd, user, salt, hashCallback);
      } else {
        hashCallback({status:true, hashedPasswd:passwd});
      }
    };

    // Check if the new email is unique
    if(!params.modify.email || params.modify.email.toLowerCase() === doc.email.toLowerCase()) {
      // The email is not changing, continue
      emailMatchCallback();
    } else {
      // The email is changing, check if it is unique
      dbMatches('users', {email: email}, (result) => {
        if(!result.status) {
          connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
          return;
        }
        if(result.matches !== 0) {
          connection.send(apiResponses.concatObj(apiResponses.JSON.errors.userAlreadyExists, {"id": params.id}, true));
          return;
        }

        // Email is unique, continue
        emailMatchCallback();
      });
    }
  });
};

// Remove a user from the db
exports.removeUser = (params, connection) => {
  if(!params.JWT) {connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true)); return;}
  if(!verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
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
            global.emit('user:' + getTokenInfo(params.JWT).payload.user);
            logger.log("Removed user '" + getTokenInfo(params.JWT).payload.user + "'.", 6, false, config.moduleName, __line, __file)
            connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id}, true));
          } else {
            logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
            connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
          }
        });
      } else {
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      }
    });
  });
};
