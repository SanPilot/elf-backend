/*
Search Module
*/

// Require files
var logger = global.logger,
apiResponses = global.apiResponses,
checkArray = require("./tasks.js").checkArray,
config = require("./config/search.config.json"),
users = require("./users.js"),
escRegex = users.escRegex,

// Helper function to see if a string is present in another string
contains = (string, sub) => {
  if(sub.constructor === String) return string.toLowerCase().substr(sub.toLowerCase()) !== -1;
  if(sub.constructor === Array) {
    for(var i = 0; i < sub.length; i++) {
      if(contains(string, sub[i])) return true;
    }
    return false;
  }
},

// Function to sort array
sort = (unsorted) => {
  var convertedArray = [];
  for(var key in unsorted) {
    convertedArray.push([key, unsorted[key]]);
  }
  var sorted = convertedArray.sort((a, b) => {
    return b[1] - a[1];
  }),
  result = [];

  // Create the final array
  for(var i = 0; i < sorted.length; i++) {
    result.push(sorted[i][0]);
  }

  // Return the final, sorted array
  return result;
},

// Function to find related users and send the results
usersHandoff = (results, relatedUsers, keywords, connection, params) => {
  // Query the db to find related users
  global.mongoConnect.collection("users").find({$text: {$search: keywords.join(" ")}}, {score: {$meta: "textScore"}}).each((err, user) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }

    // If this is the end of the cursor, send the results
    if(user === null) {
      relatedUsers = sort(relatedUsers);
      connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, content: {results: sort(results).slice(0, config.maxResults), relatedUsers: relatedUsers.slice(0, Math.ceil(relatedUsers.length / 10))}}, true));

      // Add the query to the suggestions
      var suggestion = keywords.join(" ");
      global.mongoConnect.collection("suggestions").findOne({suggestion: suggestion}, (err, suggestions) => {
        if(err) {
          logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
          return;
        }

        var searchDate = Math.floor(Date.now() / 1000);

        if(suggestions === null) {
          // The suggestion doesn't exist, create it
          global.mongoConnect.collection("suggestions").insertOne({suggestion: suggestion, searchers: [users.getTokenInfo(params.JWT).payload.user.toLowerCase()], lastUsed: searchDate}, (err) => {
            if(err) {
              logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
              return;
            }
          });
        } else {
          // The suggestion exists, update the record
          global.mongoConnect.collection("suggestions").updateOne({suggestion: suggestion}, {$set: {lastUsed: searchDate}, $addToSet: {searchers: users.getTokenInfo(params.JWT).payload.user.toLowerCase()}}, (err) => {
            if(err) {
              logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
              return;
            }
          });
        }
      });

      // Exit the function
      return;
    }

    // Calculate score
    var score = 200 * user.score;

    // If the username is a keyword, ensure this result reaches the top
    keywords.forEach((keyword) => {
      if(keyword.toLowerCase() === user.caselessUser) {
        score += 1000;
      }
    });

    // Add the finalized score to relatedUsers
    relatedUsers[user.caselessUser] ? relatedUsers[user.caselessUser] += score : relatedUsers[user.caselessUser] = score;
  });
};


// Function to get suggestions for an incomplete query
exports.suggestions = (params, connection) => {
  if(!(params.query && params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }

  if(params.query.constructor !== String) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }

  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  var keywords = params.query.split(/[^\w,']+/),
  suggestionKeywords = keywords.join(" "),
  suggestions = [];

  // Search the db for related suggestions
  global.mongoConnect.collection("suggestions").find({$text: {$search: suggestionKeywords}}, {score: {$meta: "textScore"}}).each((err, suggestion) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }

    // If this is the end of the cursor, send the suggestions to the user
    if(suggestion === null) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, content: sort(suggestions).slice(0, 6)}, true));
      return;
    }

    // Score each suggestion
    var score = 500 * suggestion.score;

    // Increase score for popularity
    score += 500 * suggestion.searchers.length;

    // Score based on order of keywords
    suggestion.suggestion.split(/[^\w,']+/).forEach((word, i) => {
      if(keywords[i] === word) score += 500;
    });

    // Score based on recency
    var age = Math.floor(Date.now() / 1000) - suggestion.lastUsed;
    score -= (age / (10 ^ 9)) ^ (Math.log10(1000) / Math.log10(11.731392));

    // Add this to the results list
    suggestions[suggestion.suggestion] = score;
  });
}

// Function to search database for tasks and users
exports.search = (params, connection) => {
  if(!(params.query && params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }

  if(params.filters && params.filters.constructor !== Object) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }

  // Ensure all of the filters are of the correct type
  var validFilters = true,
  filterTypes = {
    tags: Array,
    project: String,
    users: Array,
    status: Boolean,
    date: Number
  },
  filters = {};
  for(var filter in params.filters) {
    // Skip loop if the property is from prototype
    if(!params.filters.hasOwnProperty(filter)) continue;

    // Ensure the filter is of the correct type
    var expectedType = filterTypes[filter];
    if(expectedType !== undefined && expectedType !== params.filters[filter].constructor) {
      validFilters = false;
      break;
    }
    if(expectedType === Array) {
      if(!checkArray(params.filters[filter], String)) {
        validFilters = false;
        break;
      }
    }
    filters[filter] = params.filters[filter] || undefined;
  }
  if(!(params.query.constructor === String && validFilters)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }

  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  // Use caseless versions of search filters
  if(filters.tags) {
    filters.tags.forEach((tag, i) => {
      filters.tags[i] = tag.toLowerCase();
    });
  }
  if(filters.users) {
    filters.users.forEach((user, i) => {
      filters.users[i] = user.toLowerCase();
    });
  }

  // Create the aggregate pipeline stages
  var stages = [],
  matchStage = {},
  results = {},
  relatedUsers = {},
  query = params.query,
  keywords = query.split(/[^\w,']+/),
  textAggregate = keywords.join(" ");

  // Ensure at least one field contains at least one keyword
  matchStage.$text = {
    $search: textAggregate
  };
  if(filters.tags) {
    matchStage.tags =  {
      $in: filters.tags
    }
  }
  if(filters.project) {
    matchStage.project = filters.project;
  }
  if(filters.users) {
    matchStage.caselessUser = {
      $in: filters.users
    };
  }
  if(filters.status !== undefined) {
    matchStage.markedAsDone = filters.status
  }
  if(filters.date) {
    matchStage.createdAt = {
      $gte: filters.date
    }
  }

  // Add the match stage to the pipeline
  stages.push({$match: matchStage});

  // Get each task's score
  stages.push({$addFields: {score: {$meta: "textScore"}}});

  // Limit the results
  stages.push({$limit: config.searchDepth});

  // Sort the results by date
  stages.push({$sort: {date: -1}});

  // Execute the query
  global.mongoConnect.collection("tasks").aggregate(stages).each((err, task) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }

    // Check if this is the end of the cursor
    if(task === null) {
      // Now find related users
      usersHandoff(results, relatedUsers, keywords, connection, params);
      return;
    }

    // Process each result

    // Score the result
    var score = 1000 * task.score;

    // Ensure the word is present in at least one field
    if(contains(task.body, keywords)) score += 2000;
    if(contains(task.caselessUser, keywords)) score += 500;
    for(var i = 0; i < task.comments.length; i++) {
      if(contains(task.comments[i].comment, keywords)) score += 200;
    }
    if(contains(task.summary, keywords)) score += 3000;
    for(var i2 = 0; i2 < task.tags.length; i2++) {
      if(contains(task.tags[i2], keywords)) score += 200;
    }

    // Check if the exact query is present in any of the fields
    if(contains(task.body, query)) score += 8000;
    if(contains(task.caselessUser, query)) score += 2000;
    for(var i3 = 0; i3 < task.comments.length; i3++) {
      if(contains(task.comments[i3].comment, query)) score += 800;
    }
    if(contains(task.summary, query)) score += 12000;
    for(var i4 = 0; i4 < task.tags.length; i4++) {
      if(contains(task.tags[i4], query)) score += 800;
    }

    // Score based on recency
    var age = Math.floor(Date.now() / 1000) - task.date;
    score -= (age / (10 ^ 9)) ^ (Math.log10(4000) / Math.log10(11.731392));

    // Add the task to the results
    results[task.id] = score;

    // Collect related users
    relatedUsers[task.user.toLowerCase()] ? relatedUsers[task.user.toLowerCase()] += 200 : relatedUsers[task.user.toLowerCase()] = 200;
    task.mentions.forEach((mentionedUser) => {
      relatedUsers[mentionedUser.toLowerCase()] ? relatedUsers[mentionedUser.toLowerCase()] += 100 : relatedUsers[mentionedUser.toLowerCase()] = 100;
    });
    task.comments.forEach((comment) => {
      relatedUsers[comment.user.toLowerCase()] ? relatedUsers[comment.user.toLowerCase()] += 100 : relatedUsers[comment.user.toLowerCase()] = 100;
      comment.mentions.forEach((mentionedUser) => {
        relatedUsers[mentionedUser.toLowerCase()] ? relatedUsers[mentionedUser.toLowerCase()] += 50 : relatedUsers[mentionedUser.toLowerCase()] = 50;
      });
    });
  });
};
