/*
Module for storing users' files
*/

// Require files
var logger = global.logger,
fs = require('fs'),
apiResponses = global.apiResponses,
crypto = require('crypto'),
http = require('http'),
config = require("./config/fileStorage.config.json"),
sanitize = require('sanitize-filename'),
users = require('./users.js'),
transferList = {},
maxSize = 4294967295,

// Helper function to create required directories
createDirs = (user) => {
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
          logger.log("Created filestorage directory.", 5, false, config.moduleName, __line, __file);
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
    fs.mkdir(userDir, 0o700, (crErr) => {
      if(crErr) {
        logger.log("Unable to create filestorage directory for user '" + user + "'. This user will be unable to upload until the issue is resolved. This error may be caused by incorrectly set permissions.", 2, true, config.moduleName, __line, __file);
        return;
      }
      logger.log("Created filestorage directory for user '" + user + "'.", 6, false, config.moduleName, __line, __file);
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
  var user = users.getTokenInfo(params.JWT).payload.user,
  createdAt = Math.floor(new Date() / 1000),
  id = crypto.createHash('sha256').update(params.file.name + ":" + user + createdAt).digest('hex'),
  uploadObj = {
    id: id,
    fileName: sanitize(params.file.name),
    user: user,
    createdAt: createdAt,
    size: params.file.size,
    mimetype: params.file.type,
    type: "upload"
  },

  // Create the file
  filename = config.directoryLocation + "/" + sanitize(uploadObj.user) + "/" + uploadObj.id;
  fs.writeFile(filename, "", (err) => {
    if(err) {
      logger.log("There was an error opening a file for writing in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file)
      connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
      return;
    }

    // Add this to the list of uploads
    transferList[id] = uploadObj;

    // Send this back to the user
    connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, "upload": uploadObj}, true));
  });
}

// Function to finalize upload, adding the file to the database
var finalizeUpload = (uploadObj, res) => {
  // Remove the upload from the list
  delete transferList[uploadObj.id];

  var filename = config.directoryLocation + "/" + sanitize(uploadObj.user) + "/" + uploadObj.id;

  // Check if the file size matches the entry file size
  fs.stat(filename, (err, stats) => {
    if(err) {
      logger.log("There was an error reading a file in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file);
      res.writeHead(500);
      res.end(apiResponses.strings.errors.failed);
      return;
    }

    // If the size doesn't match, refuse the upload
    if(stats.size !== uploadObj.size) {
      res.writeHead(500);
      res.end(JSON.stringify({
        type: 'response',
        status: 'failed',
        error: 'Incorrect size'
      }));
      return;
    }

    // Add this file to the DB
    global.mongoConnect.collection("files").insertOne(uploadObj, (err, r) => {
      if(err) {
        logger.log("Failed database query. (" + err + ")", 2, true, config.moduleName, __line, __file);
        res.writeHead(500);
        res.end(apiResponses.strings.errors.failed);
        return;
      }

      // Report successful transfer
      logger.log(`Completed transfer of file from user. (ID:${uploadObj.id})`, 6, false, config.moduleName, __line, __file);

      // Send the result back to the user
      res.writeHead(200);
      res.end(apiResponses.strings.success);
    });
  });
},

// Function to recieve a file from the client
upload = (uploadObj, res, req) => {
  var filename = config.directoryLocation + "/" + sanitize(uploadObj.user) + "/" + uploadObj.id,
  writeStream = fs.createWriteStream(filename),
  failed = false;

  // Send the request to the file
  req.pipe(writeStream);

  // Prevent upload from going over reported size and ensure file hasn't expired
  req.on('data', () => {
    if(writeStream.bytesWritten > uploadObj.size || transferList[uploadObj.id] === undefined) {
      // Cancel the upload
      failed = true;
      res.writeHead(500);
      res.end(JSON.stringify({
        type: 'response',
        status: 'failed',
        error: (transferList[uploadObj.id] ? 'Incorrect size' : 'No upload selected')
      }));
      writeStream.close();
    }
  });

  // Finalize the upload when it finishes
  writeStream.on('close', () => {
    if(failed) return;

    // Handoff connection to finalizeUpload function
    finalizeUpload(uploadObj, res);
  });
},

// A function used in the deleteAbandoned function below
checkAndDelete = (filename, file) => {
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
            if(transferList[file]) {
              delete transferList[file];
            }
          });
        }
      });
    }
  });
},

// Maintenance function to delete abandoned uploads
deleteAbandoned = (attempt, user, directory) => {
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
};

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
    fs.stat(filename, (err, stats) => {
      if(err) {
        logger.log("There was an error reading a file in directory '" + config.directoryLocation + "'. This may be due to incorrectly set permissions.", 2, true, config.moduleName, __line, __file)
        connection.send(apiResponses.concatObj(apiResponses.JSON.errors.failed, {"id": params.id}, true));
        return;
      }

      // Create the download identifier
      var user = users.getTokenInfo(params.JWT).payload.user;
      var time = Math.floor(new Date() / 1000);
      var id = crypto.createHash('sha256').update(doc.id + ":" + user + time).digest('hex');
      transferList[id] = {
        id: id,
        fileId: doc.id,
        file: filename,
        actualName: doc.fileName,
        type: "download"
      }

      // Set an expiration for the download
      var expires = Math.floor(new Date() / 1000) + config.downloadExpiration;
      setTimeout(() => {
        delete transferList[id];
      }, config.downloadExpiration);

      // Everything is good; send a success message
      connection.send(apiResponses.concatObj(apiResponses.JSON.success, {"id": params.id, "content": {"id": id, "expires": expires}}, true));
    });
  });
};


// Function to send the file to the client
var download = (downloadObj, res) => {
  var readStream = fs.createReadStream(downloadObj.file);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${downloadObj.actualName}"`
  });
  readStream.pipe(res);
  readStream.on('close', () => {
    // Report successful transfer
    logger.log(`Completed transfer of file to user. (ID:${downloadObj.fileId})`, 6, false, config.moduleName, __line, __file);
    res.end();
  });
};

// Create an HTTP server to transfer files
logger.log("Starting file transfer server...", 4, false, config.moduleName, __line, __file);

// Start HTTP server
var server = http.createServer((req, res) => {
  var reqId = req.url.substr(1),
  selectedTransfer = transferList[reqId];
  if(!selectedTransfer) {
    res.writeHead(404, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({
      type: 'response',
      status: 'failed',
      error: 'No transfer selected'
    }));
    res.end();
    return;
  }

  // Hand the connection off to either the download or upload function
  if(selectedTransfer.type === "download") {
    download(selectedTransfer, res);
  } else {
    upload(selectedTransfer, res, req);
  }
});

// Set up error handling
server.on("error", (e) => {
  logger.log("There was an error starting the file transfer server on port " + config.fileTransferPort + ": " + e + ".", 1, true, config.moduleName, __line, __file);
  process.exit(1);
});

server.listen(config.fileTransferPort, () => {
  logger.log("File transfer server started listening on port " + config.fileTransferPort + ".", 4, false, config.moduleName, __line, __file);
});
