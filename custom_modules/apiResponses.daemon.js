/*
Default API responses
*/

var logger = global.logger;

logger.log("API Responses Module [DAEMON] started and ready to go!", 4, false, "API Responses Module [DAEMON] (apiResponses.daemon.js)");

// Common API responses
module.exports = {
  "JSON": {
    "errors": {
      "malformedRequest": {
        "type": "response",
        "status": "failed",
        "error": "Malformed request"
      },
      "invalidAction": {
        "type": "response",
        "status": "failed",
        "error": "Invalid action"
      },
      "tooManyRequests": {
        "type": "response",
        "status": "failed",
        "error": "Too many requests"
      },
      "missingParameters": {
        "type": "response",
        "status": "failed",
        "error": "Missing parameters"
      },
      "failed": {
        "type": "response",
        "status": "failed",
        "error": "Failed"
      },
      "authFailed": {
        "type": "response",
        "status": "failed",
        "error": "Authentication failed"
      },
      "userAlreadyExists": {
        "type": "response",
        "status": "failed",
        "error": "User already exists"
      },
      "invalidField": {
        "type": "response",
        "status": "failed",
        "error": "Invalid Field"
      }
    },
    "success": {
      "type": "response",
      "status": "success"
    }
  },
  "strings": {}
};

// Loop through and stringify each one
for (var key in module.exports.JSON) {

  // skip loop if the property is from prototype
  if (!module.exports.JSON.hasOwnProperty(key)) continue;

  if(module.exports.JSON[key] !== null && typeof module.exports.JSON[key] === 'object') {
    for (var obj in module.exports.JSON[key]) {

      // skip loop if the property is from prototype
      if (!module.exports.JSON[key].hasOwnProperty(obj)) continue;
      if(module.exports.strings[key] == null) module.exports.strings[key] = {};
      module.exports.strings[key][obj] = JSON.stringify(module.exports.JSON[key][obj]);
    }
  } else {
    module.exports.strings[key] = JSON.stringify(module.exports.JSON[key]);
  }
}

module.exports.concatObj = (resp, concat, stringify) => {
  var newObj = resp;
  for(var key in concat) {
    if(!concat.hasOwnProperty(key)) continue;
    newObj[key] = concat[key];
  }
  if(stringify) newObj = JSON.stringify(newObj);
  return newObj;
};
