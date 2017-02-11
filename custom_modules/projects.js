/*
Projects Module
*/

// Require files
var apiResponses = global.apiResponses,
logger = global.logger,
config = require("./config/projects.config.json"),
users = require("./users.js"),
shortCodes = require("./shortCodes.js"),
crypto = require("crypto"),
checkArray = require("./tasks.js").checkArray;

// Common code between createProject and modifyProject
var createProjectObj = (params, connection) => {
  if(!params.JWT) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return false;
  }

  if(!((params.miscKeys === undefined || params.miscKeys.constructor === Object) && (!params.projectName || params.projectName.constructor === String) && (!params.projectDesc || params.projectDesc.constructor === String))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return false;
  }

  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return false;
  }

  // Get token information
  var createUser = users.getTokenInfo(params.JWT).payload.user;

  // Generate the project id
  var createdAt = Math.floor(new Date() / 1000);
  var id = crypto.createHash('sha256').update(createdAt + ":" + params.projectName + (params.projectDesc || "")).digest('hex');

  // Return the project object
  return {
    id: id,
    createdAt: createdAt,
    createdBy: createUser,
    projectName: params.projectName || "",
    projectDesc: params.projectDesc || "",
    miscKeys: params.miscKeys || {}
  };
}

// Function to create a new project
exports.createProject = (params, connection) => {
  if(!(params.projectName)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }

  // Create the project object
  var projectObj = createProjectObj(params, connection);
  if(!projectObj) return;
  // Generate a shortcode for the project
  shortCodes.createShortCode('project', projectObj.id, (err, code) => {
    if(err) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    projectObj.shortCode = code;

    // Add the new project to the db
    global.mongoConnect.collection("projects").insertOne(projectObj, (err) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }
      logger.log("Created new project. (ID:" + projectObj.id + ")", 6, false, config.moduleName, __line, __file);
      connection.send(JSON.stringify({
        type: "response",
        status: "success",
        id: params.id,
        content: projectObj
      }));
    });
  });
}

// Function to modify project
exports.modifyProject = (params, connection) => {
  if(!params.modifyId) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(params.modifyId.constructor !== String) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }

  // Ensure the project exists
  global.mongoConnect.collection("projects").findOne({id: params.modifyId}, (err, doc) => {
    if(err || doc === null) {
      if(err) logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }

    // The task exists, update it
    var projectObj = createProjectObj(params, connection);

    // Pick the values that we need
    projectObj = {
      projectName: projectObj.projectName,
      projectDesc: projectObj.projectDesc,
      miscKeys: params.miscKeys || doc.miscKeys
    }

    // Update the project
    global.mongoConnect.collection("projects").updateOne({id: doc.id}, {$set: projectObj}, (err) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }

      // The project was updated successfully
      logger.log(`Updated project. (ID:${doc.id})`, 6, false, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id}, true));
    });
  });
}

// Function to list existing projects
exports.listProjects = (params, connection) => {
  if(!(params.ids && params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(!(params.ids.constructor === Array && checkArray(params.ids, String))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  // Build the DB query
  var query = {};
  if(params.ids.length) {
    // The user wants specific projects
    query = {id: {$in: params.ids}};
  }

  // Find the selected projects
  global.mongoConnect.collection("projects").find(query).toArray((err, docs) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }

    // Send the result to the user
    connection.send(apiResponses.concatObj(apiResponses.JSON.success, {id: params.id, content: docs}, true));
  })
}

// Function to retrieve a project's users or tasks
exports.listProjectItems = (params, connection) => {
  if(!(params.projectId && params.tasks !== undefined && params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(!(params.projectId.constructor === String && params.tasks.constructor === Boolean)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }

  // Build the DB query
  var query = (params.tasks ? {project: params.projectId} : {projects: {$in: [params.projectId]}});

  // Get the list from the db
  global.mongoConnect.collection((params.tasks ? "tasks" : "users")).find(query, [(params.task ? "id" : "user")]).toArray((err, docs) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }

    // Get the username or id of each result
    var resultArray = [];
    for(var i = 0; i < docs.length; i++) {
      resultArray.push(docs[i][(params.task ? "id" : "user")]);
    }

    // Send the results to the user
    connection.send(apiResponses.concatObj(apiResponses.JSON.success, {id: params.id, content: resultArray}, true));
  });
}
