/*
Index.js - Runs all modules and starts backend
*/

"use strict";

// Include required files
var config = require("./custom_modules/config/index.config.json"),
logger = require("./custom_modules/logger.daemon.js"),
express = require("express");

// Log information
logger.log("Welcome to Elf. Index script started up successfully.", 3, false, config.moduleName);

// Start HTTP server
logger.log("Starting Express HTTP server...", 4, false, config.moduleName);
