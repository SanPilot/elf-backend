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
  var mentionRegex = /\B[@＠]([A-Za-z0-9_-]+)/gi;

  var mentionsRaw = [], match;
  while(match = mentionRegex.exec(parsedBody)) {
    mentionsRaw.push(match[1])
  }

  // get list of @mentions
  var mentions = [];
  for(var i = 0; i < mentionsRaw.length; i++) {
    if(!~mentions.indexOf(mentionsRaw[i])) {
      mentions.push(mentionsRaw[i]);
    }
  }

  return {
    body: parsedBody,
    mentions: mentions
  }
}

var generateTaskBody = (params, connection) => {
  if(!(params.JWT && params.task && params.task.project && params.task.appliedForPriority !== undefined && params.task.body && params.task.attachedFiles)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return false;
  }
  var num = 10;
  if(!(params.task.constructor === {}.constructor && (params.task.project.constructor === num.constructor || params.task.project.constructor === "".constructor) && params.task.appliedForPriority.constructor === true.constructor && params.task.body.constructor === "".constructor && params.task.attachedFiles.constructor === [].constructor)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {id: params.id}, true));
    return false;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malacious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return false;
  }
  try {
    var parsedBody = parseTaskBody(params.task.body);
    var createdAt = new Date().getTime();
    var id = crypto.createHash('sha256').update(createdAt + ":" + parsedBody.body).digest('hex');
    var task = {
      id: id,
      createdAt: createdAt,
      user: users.getTokenInfo(params.JWT).payload.user,
      caselessUser: users.getTokenInfo(params.JWT).payload.user.toLowerCase,
      project: params.task.project,
      appliedForPriority: params.task.appliedForPriority,
      approvedPriority: false,
      markedAsDone: false,
      edited: false,
      body: parsedBody.body,
      mentions: parsedBody.mentions,
      attachedFiles: params.task.attachedFiles
    }
    return {
      parsedBody: parsedBody,
      id: id,
      task: task
    }
  } catch(e) {
    logger.log("Error trying to create task. (" + e + ")", 2, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
    return false;
  }
}

// Function to add a task
exports.addTask = (params, connection) => {
  var generated = generateTaskBody(params, connection);
  if(generated === false) {
    return;
  }
  var parsedBody = generated.parsedBody,
  id = generated.id,
  task = generated.task;

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
}

// Function to list tasks
exports.listTasks = (params, connection) => {
  if(!(params.request)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(!(params.request.constructor === {}.constructor && (!params.request.ids || params.request.ids.constructor === [].constructor) && (!params.request.users || params.request.users.constructor === [].constructor))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {id: params.id}, true));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malacious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  // Get the tasks that the user wants
  var getIDs = (params.request.ids ? params.request.ids : false), getUserTasks = (params.request.users ? params.request.users : false);
  getIDs = (getIDs.length ? getIDs : false);
  getUserTasks = (getUserTasks.length ? getUserTasks : false);
  if(!(getIDs || getUserTasks)) {
    global.mongoConnect.collection("tasks").find({}).toArray((err, docs) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }
      connection.send(JSON.stringify({
        type: "response",
        status: "success",
        id: params.id,
        content: docs
      }));
    });
  } else {
    var resArray = [], iterationStop = false;
    for(var idsi = 0; idsi < getIDs.length; idsi++) {
      global.mongoConnect.collection("tasks").find({id: getIDs[idsi]}).limit(1).toArray((err, docs) => {
        if(err || !docs.length) {
          if(err) logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
          connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
          iterationStop = true;
          return;
        }
        resArray.push(docs[0]);
        if(idsi === resArray.length && !getUserTasks) {
          connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, content: resArray}, true));
        }
      });
      if(iterationStop) return;
    }
    for(var usersi = 0; usersi < getUserTasks.length; usersi++) {
      global.mongoConnect.collection("tasks").find({caselessUser: getUserTasks[usersi].toLowerCase}).limit(1).toArray((err, docs) => {
        if(err || !docs.length) {
          logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
          connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
          iterationStop = true;
          return;
        }
        resArray.push(docs[0]);
        if(usersi === resArray.length) {
          setTimeout(() => {
            connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, content: resArray}, true));
          }, 20);
        }
      });
      if(iterationStop) return;
    }
  }
}

// modifyTask - method to modify already created task
exports.modifyTask = (params, connection) => {
  if(!((params.modifyId && params.modifyId.constructor === "".constructor) && (params.done === undefined || params.done.constructor === true.constructor))) {
    if(!params.modifyId) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
      return;
    } else if(params.modifyId.constructor !== "".constructor) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {id: params.id}, true));
      return;
    } else if(params.done.constructor !== true.constructor) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {id: params.id}, true));
      return;
    }
  }

  var id = params.modifyId;

  // Fetch the task with this id
  global.mongoConnect.collection("tasks").find({"id":id}).limit(1).toArray((err, docs) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    if(!docs.length) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    var task = docs[0],
    generated = generateTaskBody(params, connection);
    if(generated === false) {
      return;
    }
    var parsedBody = generated.parsedBody;

    if(params.done === undefined) params.done = task.markedAsDone;

    // The final modified task
    var newTask = {
      id: id,
      createdAt: new Date().getTime(),
      user: task.user,
      caselessUser: task.caselessUser,
      project: params.task.project,
      appliedForPriority: params.task.appliedForPriority,
      approvedPriority: task.approvedPriority,
      markedAsDone: params.done,
      edited: true,
      body: parsedBody.body,
      mentions: parsedBody.mentions,
      attachedFiles: params.task.attachedFiles
    }

    // Send notifications to the newly mentioned users
    for(var i = 0; i < parsedBody.mentions.length; i++) {
      if(!~task.mentions.indexOf(parsedBody.mentions[i])) continue; // Make sure people who were already notified aren't nofified again
      notify.sendNotification({
        type: "taskmention",
        from: users.getTokenInfo(params.JWT).payload.user,
        taskId: id
      }, parsedBody.mentions[i]);
    }

    // Update this task in the db
    global.mongoConnect.collection("tasks").updateOne({id:id},{$set:newTask}).then((r) => {
      if(!r.result.ok) {
        logger.log("Failed database query. (" + r + ")", 2, true, config.moduleName);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }
      logger.log("Updated task. (ID:" + newTask.id + ")", 6, false, config.moduleName);
      connection.send(JSON.stringify({
        type: "response",
        status: "success",
        id: params.id,
        content: newTask
      }));
    });
  });
}
