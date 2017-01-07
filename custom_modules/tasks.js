/*
Tasks Module
*/

// Require files
var apiResponses = global.apiResponses,
logger = global.logger,
config = require("./config/tasks.config.json"),
users = require("./users.js"),
notify = require("./notify.daemon.js"),
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

// Escape strings to be inserted into regex
var escRegex = (str) => {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

// Function to search for tags in the db
var searchTags = (params, connection) => {
  if(!(params.letters && params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return false;
  }
  if(params.letters.constructor !== String) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return false;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malacious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return false;
  }
  var testExp = "^" + params.letters + ".*$";

  // Search the db for this pattern
  global.mongoConnect.collection("tags").find({tag:{$regex:testExp}}, (err, docs) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, "content": docs}, true));
  });
}

// This function adds newly defined tags to the database
var processTag = (name, user, attempt) => {
  name = name.toLowerCase();
  attempt = attempt || 0;
  if(attempt > 5) return; // If it still fails, we can't do anything
  global.mongoConnect.collection("tags").findOne({tag: name}, (err, doc) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
      processTag(name, user, ++attempt);
      return;
    }
    if(doc === null) {
      // This tag doesn't yet exist in the db, so insert it
      global.mongoConnect.collection("tags").insertOne({tag: name, user: user, createdAt: Math.floor(new Date() / 1000)}, (err) => {
        if(err) {
          logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName);
          processTag(name, user, ++attempt);
          return;
        }
        logger.log("Added new tag: '"+ name + "'.", 6, false, config.moduleName);
      });
    }
  });
}

// Function to ensure all elements of array are of the right type
var checkArray = (array, type) => {
  for(var i = 0; i < array.length; i++) {
    if(array[i].constructor !== type) return false;
  }
  return true;
}

// This function is the common code between addTask and modifyTask - it checks all the variables then creates the task's body
var generateTaskBody = (params, connection) => {
  if(!(params.JWT && params.task && params.task.project && params.task.appliedForPriority !== undefined && params.task.body && params.task.attachedFiles && params.task.tags)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return false;
  }
  if(!(params.task.constructor === {}.constructor && params.task.project.constructor === String && params.task.appliedForPriority.constructor === true.constructor && params.task.body.constructor === "".constructor && params.task.attachedFiles.constructor === Array && checkArray(params.task.attachedFiles, String) && params.task.tags.constructor === Array && checkArray(params.task.tags, String))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {id: params.id}, true));
    return false;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malacious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return false;
  }

  // Lowercase all the tags
  for(var i = 0; i < params.task.tags.length; i++) {
    params.task.tags[i] = params.task.tags[i].toLowerCase();
    // Send this to processTag
    processTag(params.task.tags[i], users.getTokenInfo(params.JWT).payload.user);
  }

  try {
    var parsedBody = parseTaskBody(params.task.body);
    var createdAt = Math.floor(new Date() / 1000);
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
      attachedFiles: params.task.attachedFiles,
      tags: params.task.tags
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

  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malacious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  var user = users.getTokenInfo(params.JWT).payload.user;

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
    var task = docs[0], newTask, successFunction;

    if(task.caselessUser === user) {
      var generated = generateTaskBody(params, connection);
      if(generated === false) {
        return;
      }
      var parsedBody = generated.parsedBody;

      if(params.done === undefined) params.done = task.markedAsDone;

      // The final modified task
      newTask = {
        id: id,
        createdAt: Math.floor(new Date() / 1000),
        user: task.user,
        caselessUser: task.caselessUser,
        project: params.task.project,
        appliedForPriority: params.task.appliedForPriority,
        approvedPriority: task.approvedPriority,
        markedAsDone: params.done,
        edited: true,
        body: parsedBody.body,
        mentions: parsedBody.mentions,
        attachedFiles: params.task.attachedFiles,
        tags: params.task.tags
      }

      // Send notifications to the newly mentioned users
      successFunction = () => {
        for(var i = 0; i < parsedBody.mentions.length; i++) {
          if(!~task.mentions.indexOf(parsedBody.mentions[i])) continue; // Make sure people who were already notified aren't nofified again
          notify.sendNotification({
            type: "taskmention",
            from: user,
            taskId: id
          }, parsedBody.mentions[i]);
        }
      }
    } else {
      if(params.task !== undefined || params.done === undefined || params.done.constructor !== true.constructor || params.done === task.markedAsDone) {
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }
      successFunction = () => {
        notify.sendNotification({
          type: (params.done ? "taskclosed" : "taskreopened"),
          from: user,
          taskId: id
        }, task.user);
      };
      newTask = task;
      newTask.markedAsDone = params.done;
    }

    // Update this task in the db
    global.mongoConnect.collection("tasks").updateOne({id:id},{$set:newTask}).then((r) => {
      if(!r.result.ok) {
        logger.log("Failed database query. (" + r + ")", 2, true, config.moduleName);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }
      logger.log("Updated task. (ID:" + id + ")", 6, false, config.moduleName);
      successFunction();
      connection.send(JSON.stringify({
        type: "response",
        status: "success",
        id: params.id,
        content: newTask
      }));
    });
  });
}
