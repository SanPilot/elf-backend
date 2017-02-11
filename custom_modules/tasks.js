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
crypto = require('crypto'),
shortCodes = require("./shortCodes.js");

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
    mentionsRaw.push(match[1].toLowerCase());
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
exports.searchTags = (query, callback) => {

  // Create a promise for the value
  return new new Promise((resolve, reject) => {

    // Create the regex for the db search
    var testExp = "^" + query + ".*$";

    // Search the db for this pattern
    global.mongoConnect.collection("tags").find({tag:{$regex:testExp}}).toArray((err, docs) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
        reject(err);
        return;
      }
      resolve(docs);
    });
  });
}

// This function adds newly defined tags to the database
var processTag = (name, user, attempt) => {
  name = name.toLowerCase();
  attempt = attempt || 0;
  if(attempt > 5) return; // If it still fails, we can't do anything
  global.mongoConnect.collection("tags").findOne({tag: name}, (err, doc) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      processTag(name, user, ++attempt);
      return;
    }
    if(doc === null) {
      // This tag doesn't yet exist in the db, so insert it
      global.mongoConnect.collection("tags").insertOne({tag: name, user: user, createdAt: Math.floor(new Date() / 1000)}, (err) => {
        if(err) {
          logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
          processTag(name, user, ++attempt);
          return;
        }
        logger.log("Added new tag: '"+ name + "'.", 6, false, config.moduleName, __line, __file);
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
exports.checkArray = checkArray;

// This function is the common code between addTask and modifyTask - it checks all the variables then creates the task's body
var generateTaskBody = (params, connection) => {
  if(!(params.JWT && params.task && params.task.project && params.task.priority !== undefined && params.task.body && params.task.attachedFiles && params.task.tags && params.task.summary)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return false;
  }
  if(!(params.task.constructor === {}.constructor && params.task.project.constructor === String && params.task.priority.constructor === true.constructor && params.task.body.constructor === "".constructor && params.task.attachedFiles.constructor === Array && checkArray(params.task.attachedFiles, String) && params.task.tags.constructor === Array && checkArray(params.task.tags, String) && params.task.summary.constructor === String)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return false;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
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
      summary: params.task.summary,
      createdAt: createdAt,
      user: users.getTokenInfo(params.JWT).payload.user,
      caselessUser: users.getTokenInfo(params.JWT).payload.user.toLowerCase(),
      project: params.task.project,
      priority: params.task.priority,
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
    logger.log("Error trying to create task. (" + e + ")", 2, true, config.moduleName, __line, __file);
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

  // Add an empty comments array
  generated.task.comments = [];

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

  // Generate a shortcode for the task
  shortCodes.createShortCode('task', id, (err, code) => {
    if(err) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    task.shortCode = code;

    // Insert this new task into the database
    global.mongoConnect.collection("tasks").insertOne(task, (err) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }
      logger.log("Created new task. (ID:" + task.id + ")", 6, false, config.moduleName, __line, __file);
      connection.send(JSON.stringify({
        type: "response",
        status: "success",
        id: params.id,
        content: task
      }));
    });
  });
}

// Function to list tasks
exports.listTasks = (params, connection) => {
  if(!(params.request && params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(!(params.request.constructor === {}.constructor && (!params.request.ids || params.request.ids.constructor === [].constructor) && (!params.request.users || params.request.users.constructor === [].constructor))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {id: params.id}, true));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  // Get the tasks that the user wants
  var getIDs = (params.request.ids ? params.request.ids : false), getUserTasks = (params.request.users ? params.request.users : false);
  getIDs = (getIDs.length ? getIDs : false);
  getUserTasks = (getUserTasks.length ? getUserTasks : false);
  if(!(getIDs || getUserTasks)) {
    global.mongoConnect.collection("tasks").find({markedAsDone: false}).toArray((err, docs) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
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
          if(err) logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
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
      global.mongoConnect.collection("tasks").find({caselessUser: getUserTasks[usersi].toLowerCase()}).limit(1).toArray((err, docs) => {
        if(err || !docs.length) {
          logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
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
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  var user = users.getTokenInfo(params.JWT).payload.user;

  var id = params.modifyId;

  // Fetch the task with this id
  global.mongoConnect.collection("tasks").find({"id":id}).limit(1).toArray((err, docs) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    if(!docs.length) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.taskDoesNotExist, {"id": params.id}, true));
      return;
    }
    var task = docs[0], newTask, successFunction;

    if(task.user.toLowerCase() === user) {
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
        priority: params.task.priority,
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
    global.mongoConnect.collection("tasks").updateOne({id:id},{$set:newTask}, (err) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }
      logger.log("Updated task. (ID:" + id + ")", 6, false, config.moduleName, __line, __file);
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

// Functions for dealing with comments

// Function to add a comment to a task
exports.addComment = (params, connection) => {
  if(!(params.taskId && params.comment && params.JWT && params.attachedFiles)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(!(params.taskId.constructor === String && params.comment.constructor === String && params.attachedFiles.constructor === Array && checkArray(params.attachedFiles, String))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  // Check if the task exists
  users.dbMatches("tasks", {id: params.taskId}, (result) => {
    if(!result.status) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    if(result.matches !== 1) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.taskDoesNotExist, {"id": params.id}, true));
      return;
    }

    // Create the comment
    var createdAt = Math.floor(new Date() / 1000),
    parsedComment = parseTaskBody(params.comment),
    id = crypto.createHash('sha256').update(createdAt + ":" + parsedComment.body).digest('hex'),
    commentObj = {
      id: id,
      comment: parsedComment.body,
      user: users.getTokenInfo(params.JWT).payload.user,
      createdAt: createdAt,
      edited: false,
      attachedFiles: params.attachedFiles,
      mentions: parsedComment.mentions
    };

    // Add this comment to the task
    global.mongoConnect.collection("tasks").updateOne({id: params.taskId}, {$push: {comments: {$each: [commentObj], $position: 0}}}, (err) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }

      // Send @mention notification
      for(var i = 0; i < parsedComment.mentions.length; i++) {
        notify.sendNotification({
          type: "commentmention",
          from: users.getTokenInfo(params.JWT).payload.user,
          taskId: params.taskId,
          commentId: params.commentId
        }, parsedComment.mentions[i]);
      }
      logger.log("Added comment. (ID:" + id + ")", 6, false, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, "content": commentObj}, true));
    });
  });
}

// Function to modify existing comment
exports.modifyComment = (params, connection) => {
  if(!(params.taskId && params.commentId && params.newComment && params.JWT && params.attachedFiles)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(!(params.taskId.constructor === String && params.commentId.constructor === String && params.newComment.constructor === String && params.attachedFiles.constructor === Array && checkArray(params.attachedFiles, String))) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    logger.log("Recieved possibly malicious request with invalid authentication token from " + connection.remoteAddress + ".", 4, true, config.moduleName, __line, __file);
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  // Check if the specified task and comment exists
  users.dbMatches("tasks", {id: params.taskId, comments: {
    $elemMatch: {
      id: params.commentId,
      user: users.getTokenInfo(params.JWT).payload.user
    }
  }}, (result) => {
    if(!result.status) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    if(result.matches !== 1) {
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.commentDoesNotExist, {"id": params.id}, true));
      return;
    }

    // The comment exists, modify it

    // Create the new comment
    var createdAt = Math.floor(new Date() / 1000),
    parsedComment = parseTaskBody(params.newComment),
    commentObj = {
      comment: parsedComment.body,
      createdAt: createdAt,
      edited: true,
      attachedFiles: params.attachedFiles,
      mentions: parsedComment.mentions
    };

    // Add the updated version of the comment to the db
    global.mongoConnect.collection("tasks").updateOne({id: params.taskId, comments: {
      $elemMatch: {
        id: params.commentId,
        user: users.getTokenInfo(params.JWT).payload.user
      }
    }}, {$set: {"comments.$.comment": commentObj.comment, "comments.$.createdAt": commentObj.createdAt, "comments.$.edited": commentObj.edited}}, (err) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }

      // Send @mention notification
      for(var i = 0; i < parsedComment.mentions.length; i++) {
        notify.sendNotification({
          type: "commentmention",
          from: users.getTokenInfo(params.JWT).payload.user,
          taskId: params.taskId,
          commentId: params.commentId
        }, parsedComment.mentions[i]);
      }
      logger.log("Modified comment. (ID:" + params.commentId + ")", 6, false, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id}, true));
    });
  });
}
