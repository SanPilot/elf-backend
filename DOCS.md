<p align="center">
<img height="300" width="300" alt="Elf" src="meta/icons/elf-logo.min.svg" style="margin-bottom: 20px">
</p>
# Documentation for Elf Modules
*by Hussain Khalil*

## Table of Contents
* [Introduction](#introduction)
* [The Modules](#the_modules)
  * [Logger `DAEMON`](#logger)

## <a name="introduction"></a>Introduction
At its simplest, the backend of Elf is constructed by a series of modules, which use NodeJS's (the language of the backend) module implementation.

This paper contains documentation explaining each module and its usage, along with their respective configuration options.

## <a name="the_modules"></a>The Modules
The modules are APIs which receive requests and complete the corresponding action. They are separated by their functions, which make the backend simple, modular, and easily maintainable.

A subset of the APIs, called Daemons, have special core functionality required by the other modules. They are therefore started separately from the other modules. Below, the Daemons are distinguished from other modules with the `DAEMON` tag.

### <a name="logger"></a>Logger `DAEMON`

This module provides logging functionality. It is used to log information and errors to the console and to a log file.

*Config*

* `console` (object) - configuration for console logging
    * `logging` (boolean) - log to console?
    * `logLevel` (int) - what messages to log? (1: fatal error messages only, 2: error messages, 3: important status messages only, 4: status messages, 5: debug messages, 6: all messages)
* `file` (object) - configuration for file logging
    * `logging` (boolean) - log to file?
    * `logLevel` (int) - see above
    * `logFile` (string) - file to log to
    * `separateErrorLog` (boolean) - log errors in separate files?
    * `errorLogFile` (string) - if above is true, file to log errors to

*Last updated 01.04.2016*
