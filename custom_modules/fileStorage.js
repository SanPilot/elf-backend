/*
Module for storing users' files
*/

// Require files
var logger = global.logger,
fs = require('fs'),
apiResponses = global.apiResponses,
crypto = require('crypto'),
config = require("./config/fileStorage.config.json"),
maxMessageSize = require("./config/index.config.json").maxMessageSize,
sanitize = require('sanitize-filename'),
users = require('./users.js'),
uploadsList = {},
downloadsList = {},
maxSize = 4294967295;

// Helper function to create required directories
var createDirs = (user) => {
  user = user || false;

  // Callback hell (we need to check and make sure all directories are writable and create ones that don't exist yet) ->
  fs.access(config.directoryLocation, fs.constants.W_OK, (err) => {
    var dirWrite = !err;
    fs.access(config.directoryLocation, fs.constants.F_OK, (fErr) => {
      var dirEx = !fErr;
      if(dirEx && !dirWrite) {
        logger.log("Elf does not have write access to filestorage directory. Please correct permissions.", 1, true, config.moduleName, __line, __file);
        process.exit(1);
      }
      if(!dirEx) {
        logger.log("The filestorage directory does not exist and will be created.", 3, false, config.moduleName, __line, __file);
        fs.mkdir(config.directoryLocation, 0o700, (err) => {
          if(err) {
            logger.log("Failed to create filestorage directory.", 1, true, config.moduleName, __line, __file);
            process.exit(1);
          }
        });
      }
    });
  });

  // If the parameter was passed, we need to check (and create, if necessary) the individual user directory
  if(!user) return;

  var userDir = config.directoryLocation + sanitize(user) + "/";
  fs.access(userDir, fs.constants.F_OK, (err) => {
    if(!err) return;

    // Create the directory
    logger.log("Creating filestorage directory for user '" + user + "'.", 6, false, config.moduleName, __line, __file);
    fs.mkdir(userDir, 0o700, (crErr) => {
      if(crErr) logger.log("Unable to create filestorage directory for user '" + user + "'. This user will be unable to upload until the issue is resolved. This error may be caused by incorrectly set permissions.", 2, true, config.moduleName, __line, __file);
    });
  });
}

// Export this function for other modules to use
exports.createDirs = createDirs;

// Run this function when the script starts to ensure directory is present
createDirs();

// Create the upload identifier
exports.createUpload = (params, connection) => {
  if(!(params.JWT && params.file && params.file.name && params.file.size !== undefined && params.file.type)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(!(params.file.constructor === {}.constructor && params.file.name.constructor === "".constructor && params.file.size.constructor === Number && params.file.size > 0 && params.file.type.constructor === "".constructor)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }
  if(params.file.size > maxSize) {
    connection.send(JSON.stringify({
      type: 'response',
      status: 'failed',
      error: 'File too large',
      id: params.id
    }));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }
  var user = users.getTokenInfo(params.JWT).payload.user;
  var createdAt = Math.floor(new Date() / 1000);
  var id = crypto.createHash('sha256').update(params.file.name + ":" + user + createdAt).digest('hex');

  var uploadObj = {
    id: id,
    fileName: sanitize(params.file.name),
    user: user,
    createdAt: createdAt,
    size: params.file.size,
    mimetype: params.file.type
  }

  // Create the file
  var filename = config.directoryLocation + "/" + sanitize(uploadObj.user) + "/" + uploadObj.id;
  fs.writeFile(filename, "", (err) => {
    if(err) {
      logger.log("There was an error opening a file for writing in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file)
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }

    // Add this to the list of uploads
    uploadsList[id] = uploadObj;

    // Send this back to the user
    connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, "upload": uploadObj, "maxMessageSize": maxMessageSize}, true));
  });
}

// Function to finalize upload, adding the file to the database
exports.finalizeUpload = (params, connection) => {
  if(!(params.fileId && params.fileId.constructor === "".constructor && uploadsList[params.fileId])) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors[(!params.fileId ? 'missingParameters' : 'malformedRequest')], {"id": params.id}, true));
    return;
  }

  var uploadObj = uploadsList[params.fileId];
  var filename = config.directoryLocation + "/" + sanitize(uploadObj.user) + "/" + uploadObj.id;

  // Check if the file size matches the entry file size
  fs.stat(filename, (err, stats) => {
    if(err) {
      logger.log("There was an error reading a file in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file);      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }

    // If the size doesn't match, refuse the upload
    if(stats.size !== uploadObj.size) {
      connection.send(JSON.stringify({
        type: 'response',
        status: 'failed',
        error: 'Incorrect size'
      }));
      return;
    }

    // Add this file to the DB
    global.mongoConnect.collection("files").insertOne(uploadsList[params.fileId], (err, r) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }

      // Remove the upload from the list
      uploadsList[params.fileId] = undefined;

      // Send the result back to the user
      connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id}, true));
    });
  });
}

// The upload function handles a special connection. It recieves binary data and appends it to the correct file.
exports.upload = (connection) => {
  // Variable to determine if server is ready to accept next message
  var acceptReady = true;
  connection.on('message', (message) => {
    // If the upload has been removed from the list, disassociate the connection with the upload
    if(!uploadsList[connection.selectedUploadId]) {
      connection.selectedUploadId = undefined;
    }

    // We need to know which upload this is
    if(!connection.selectedUploadId) {
      if(message.type === 'utf8' && uploadsList[message.utf8Data]) {
        connection.selectedUploadId = message.utf8Data;
        connection.send(apiResponses.strings.success);
      } else {
        connection.send(JSON.stringify({
          type: 'response',
          status: 'failed',
          error: 'No upload selected'
        }));
      }
      return;
    }

    var uploadObj = uploadsList[connection.selectedUploadId];
    var filename = config.directoryLocation + "/" + sanitize(uploadObj.user) + "/" + connection.selectedUploadId;

    // Recieve binary data and add it to file
    if(message.type === 'binary') {
      if(!acceptReady) {
        connection.send(JSON.stringify({
          type: 'response',
          status: 'failed',
          error: 'Server not ready'
        }));
        return;
      }
      acceptReady = false;
      // Append this data to the file
      fs.appendFile(filename, message.binaryData, (err) => {
        acceptReady = true;
        if(err) {
          logger.log("There was an error writing to a file in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file)
          connection.send(apiResponses.strings.errors.failed);
          return;
        }
        // See if the new size of the file is too large
        fs.stat(filename, (err, stats) => {
          if(err) {
            logger.log("There was an error reading a file in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file)
            return;
          }
          // If it is, delete the upload
          if(stats.size > uploadObj.size) {
            connection.selectedUploadId = undefined;
            uploadsList[uploadObj.id] = undefined;
            connection.send(JSON.stringify({
              type: 'response',
              status: 'failed',
              error: 'File size too large'
            }));
            return;
          }
          connection.send(apiResponses.strings.success);
        });
      })
    } else {
      connection.send(apiResponses.strings.errors.malformedRequest);
    }
  });
}

// A function used in the deleteAbandoned function below
var checkAndDelete = (filename, file) => {
  fs.stat(filename, (err, stats) => {
    if(err) {
      // There's nothing we can do, just log and quit
      logger.log("There was an error reading a file in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file)
      return;
    }
    if(Math.floor((new Date() - stats.mtime) / 1000) > config.maxUploadTime) {
      // This file was last modified over the specified maxUploadTime, if it is abandoned, delete it
      global.mongoConnect.collection("files").findOne({id: file}, (err, doc) => {
        if(err) {
          logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
          return;
        }
        if(doc === null) {
          // This file is abandoned, delete it
          fs.unlink(filename, (err) => {
            if(err) {
              logger.log("There was an error removing a file in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file)
              return;
            }
            // Remove the file if it exists in the upload list
            if(uploadsList[file]) {
              uploadsList[file] = undefined;
            }
          });
        }
      });
    }
  });
}

// Maintenance function to delete abandoned uploads
var deleteAbandoned = (attempt, user, directory) => {
  attempt = attempt || 0;
  user = user || false;
  directory = (user ? config.directoryLocation + "/" + directory : config.directoryLocation);
  if(attempt > 5) return; // There seems to be an issue, just give up
  fs.readdir(directory, (err, files) => {
    if(err) {
      logger.log("There was an error reading the files in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file)
      deleteAbandoned(++attempt, user, directory);
      return;
    }
    for(var i = 0; i < files.length; i++) {
      if(!user) {
        // We're in the filestorage directory; run the function for the user directory
        deleteAbandoned(0, true, files[i]);
      } else {
        // We're in the user directory; delete the file if it is abandoned
        var file = files[i];
        var filename = directory + "/" + file;
        checkAndDelete(filename, file);
      }
    }
  });
}

// Run this function every minute
setInterval(deleteAbandoned, 60000);

// Function to retrieve file information
exports.fileInfo = (params, connection) => {
  if(!(params.JWT && params.fileId)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(params.fileId.constructor !== String) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  // See if the file exists
  global.mongoConnect.collection("files").findOne({id: params.fileId}, (err, doc) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    if(doc === null) {
      // The upload doesn't exist
      connection.send(JSON.stringify({
        type: 'response',
        status: 'failed',
        error: 'File does not exist',
        id: params.id
      }));
      return;
    }
    connection.send(JSON.stringify({
      type: 'response',
      status: 'success',
      file: doc,
      id: params.id
    }));
  });
}

// Function create a download identifier
exports.createDownload = (params, connection) => {
  if(!(params.JWT && params.fileId)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.missingParameters, {"id": params.id}, true));
    return;
  }
  if(params.fileId.constructor !== String) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.malformedRequest, {"id": params.id}, true));
    return;
  }
  if(!users.verifyJWT(params.JWT)) {
    connection.send(apiResponses.concatObj(apiResponses.JSON.errors.authFailed, {"id": params.id}, true));
    return;
  }

  // See if the file exists
  global.mongoConnect.collection("files").findOne({id: params.fileId}, (err, doc) => {
    if(err) {
      logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }
    if(doc === null) {
      // The upload doesn't exist
      connection.send(JSON.stringify({
        type: 'response',
        status: 'failed',
        error: 'File does not exist',
        id: params.id
      }));
      return;
    }

    // Get the file path
    var filename = config.directoryLocation + "/" + doc.user + "/" + doc.id;

    // Read the file and send the data
    fs.readFile(filename, (err, data) => {
      if(err) {
        logger.log("There was an error reading a file in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file)
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }
      
      var pieces = [];

      // If the file is too large, it will need to be sliced
      if(data.byteLength > maxMessageSize) {
        var numPieces = Math.ceil(data.byteLength / maxMessageSize);
        for(var i = 0; i < numPieces; i++) {
          pieces[i] = data.slice(maxMessageSize * i, (maxMessageSize * i) + maxMessageSize);
        }
      } else {
        pieces = [data];
      }

      // Create the download identifier
      var user = users.getTokenInfo(params.JWT).payload.user;
      var time = Math.floor(new Date() / 1000);
      var id = crypto.createHash('sha256').update(doc.id + ":" + user + time).digest('hex');
      downloadsList[id] = {
        id: id,
        user: user,
        time: time,
        pieces: pieces,
        numPieces: pieces.length
      }

      // Everything is good; send a success message
      connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, "pieces": pieces.length, "download": id}, true));
    });
  });
}

// Special connection - send file to client
exports.download = (connection) => {
  connection.on('message', (message) => {
    // If the download has been removed from the list, disassociate the connection with the download
    if(!downloadsList[connection.selectedDownloadId]) {
      connection.selectedDownloadId = undefined;
    }

    // We need to know which download this is
    if(!connection.selectedDownloadId) {
      if(message.type === 'utf8' && downloadsList[message.utf8Data]) {
        connection.selectedDownloadId = message.utf8Data;
        connection.send(apiResponses.strings.success);
      } else {
        connection.send(JSON.stringify({
          type: 'response',
          status: 'failed',
          error: 'No download selected'
        }));
      }
      return;
    }

    var downloadObj = downloadsList[connection.selectedDownloadId];

    // Send the requested piece
    if(message.type === 'utf8' && (+message.utf8Data).constructor === Number && downloadObj.pieces[(+message.utf8Data)]) {
      connection.send(downloadObj.pieces[(+message.utf8Data)]);
      return;
    }

    // We couldn't figure out what the client wanted
    connection.send(apiResponses.strings.errors.malformedRequest);
  });
}
