/*
Tasks Module
*/


// Require files
var apiResponses = global.apiResponses,
logger = global.logger,
config = require("./config/tasks.config.json"),
users = require("./users.js"),
notify = require("./notify.js"),
xss = require('xss'),
crypto = require('crypto');

// Function to parse body for XSS + @mentions
var parseTaskBody = (body) => {
  // Strip XSS
  var parsedBody = xss(body, {
    whiteList: xss.whiteList,
    allowCommentTag: false,
    stripIgnoreTag: true
  });

  // search for @mentions
  var mentionRegex = /\B[@＠][A-Za-z0-9_-]+/gi;

  // get list of @mentions
  var mentionsRaw = parsedBody.match(mentionRegex);
  var mentions = [];
  for(var i = 0; i < mentions.length; i++) {
    if(!~mentions.indexOf(mentionsRaw[i])) {
      mentions.push(mentionsRaw[i]);
    }
  }

  return {
    body: parsedBody,
    mentions: mentions
  }
}

// Function to add a task
exports.addTask = (params, connection) => {
  if(!(params.JWT && params.task && params.task.project && params.task.appliedForPriority !== null && params.task.body && params.task.attachedFiles)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  var num = 10;
  if(!(params.task.constructor === {}.constructor && (params.task.project.constructor === num.constructor || params.task.project.constructor === "".constructor) && params.task.appliedForPriority.constructor === true.constructor && params.task.body.constructor === "".constructor && params.task.attachedFiles === [].constructor)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {id: params.id}, true));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malacious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }
  try {
    var parsedBody = parseTaskBody(params.task.body);
    var createdAt = new Date().getTime();
    var id = createdAt + ":" + crypto.createHash('sha256').update(parsedBody.body).digest('hex');
    var task = {
      id: id,
      createdAt: createdAt,
      user: users.getTokenInfo(params.JWT).payload.user,
      project: params.task.project,
      appliedForPriority: params.task.appliedForPriority,
      approvedPriority: false,
      body: parsedBody.body
    }

    // Send @mention notification
    for(var i = 0; i < parsedBody.mentions.length; i++) {
      notify.sendNotification({
        type: "taskmention",
        from: users.getTokenInfo(params.JWT).payload.user,
        taskId: id
      }, parsedBody.mentions[i]);
    }

    // Insert this new task into the database
    global.mongoConnect.collection("tasks").insertOne(task, (err) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }
      logger.log("Created new task. (ID:" + task.id + ")", 6, false, config.moduleName);
      connection.send(JSON.stringify({
        type: "response",
        status: "success",
        id: params.id,
        content: task
      }));
    });
  } catch(e) {
    logger.log("Error trying to create task. (" + e + ")", 2, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
    return;
  }
}
