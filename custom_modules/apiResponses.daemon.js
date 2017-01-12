/*
Default API responses
*/

var logger = global.logger,
config = require('./config/apiResponses.daemon.config.json');

logger.log("API Responses Module [DAEMON] started and ready to go!", 4, false, config.moduleName, __line, __file);

// Common API responses
module.exports = {
  "JSON": config.responses,
  "strings": {}
};

// This is a function to tell if an object contains more objects, it is used below
var isMultiDimen = (object) => {
  // Loop through the object
  for(var key in object) {
    // Skip loop if the property is from prototype
    if(!object.hasOwnProperty(key)) continue;
    if(object[key].constructor === {}.constructor) return true; // There is at least one object in this object. Return true
  }
  return false; // There were no objects in the object
}

// This is a recursive function to turn each JSON response into a stringify-ed version
var stringify = (object) => {
  var result = {};
  // Loop through the elements of the object
  for(var key in object) {
    // Skip loop if the property is from prototype
    if(!object.hasOwnProperty(key)) continue;

    // Check if this object has more objects
    if(isMultiDimen(object[key])) {
      result[key] = stringify(object[key]); // Stringify each of this object's objects
    } else {
      result[key] = JSON.stringify(object[key]); // Stringify this object
    }
  }
  return result;
};

// Convert the JSON object to a stringify-ed version
module.exports.strings = stringify(module.exports.JSON);

// This is a function to combine two objects, and optionally stringify them
module.exports.concatObj = (resp, concat, stringify) => {
  var newObj = Object.assign({}, resp, concat);
  if(stringify) newObj = JSON.stringify(newObj);
  return newObj;
};
