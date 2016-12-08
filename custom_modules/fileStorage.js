/*
Module for storing users' files
*/

// Require files
var logger = global.logger,
fs = require('fs'),
apiResponses = global.apiResponses,
crypto = require('crypto'),
config = require("./config/fileStorage.config.json"),
sanitize = require('sanitize-filename');

// Helper function to create required directories
var createDirs = (user) => {
  user = user || false;

  // Callback hell (we need to check and make sure all directories are writable and create ones that don't exist yet) ->
  fs.access(config.directoryLocation, fs.constants.W_OK, (err) => {
    var dirWrite = !err;
    fs.access(config.directoryLocation, fs.constants.F_OK, (fErr) => {
      var dirEx = !fErr;
      if(dirEx && !dirWrite) {
        logger.log("Elf does not have write access to filestorage directory. Please correct permissions.", 1, true, config.moduleName);
        process.exit(1);
      }
      if(!dirEx) {
        logger.log("The filestorage directory does not exist and will be created.", 3, false, config.moduleName);
        fs.mkdir(config.directoryLocation, 0o700, (err) => {
          if(err) {
            logger.log("Failed to create filestorage directory.", 1, true, config.moduleName);
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
    logger.log("Creating filestorage directory for user '" + user + "'.", 6, false, config.moduleName);
    fs.mkdir(userDir, 0o700, (crErr) => {
      if(crErr) logger.log("Unable to create filestorage directory for user '" + user + "'. This user will be unable to upload until the issue is resolved. This error may be caused by incorrectly set permissions.", 2, true, config.moduleName);
    });
  });
}

// Export this function for other modules to use
exports.createDirs = createDirs;

// Run this function when the script starts to ensure directory is present
createDirs();
