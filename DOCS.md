<p align="center">
<img height="300" width="300" alt="Elf" src="https://git.sanpilot.co/SanPilot/elf-meta/raw/master/icons/elflogo2.png" style="margin-bottom: 20px">
</p>

# Elf

### or, Epic Lab Form
Documentation for Elf API and Modules

*by Hussain Khalil*

## Table of Contents
* [Introduction](#introduction)
* [API Guide](#api)
  * [`getUsers`](#get_users)
  * [`auth`](#auth)
  * [`createUser`](#create_user)
  * [`modifyUser`](#modify_user)
  * [`removeUser`](#remove_user)
  * [`searchUser`](#search_users)
  * [`addTask`](#add_task)
  * [`listTasks`](#last_tasks)
  * [`modifyTask`](#modify_task)
  * [`addComment`](#add_comment)
  * [`modifyComment`](#modify_comment)
  * [`searchTags`](#search_tags)
  * [`getNotifications`](#get_notifications)
  * [`createUpload`](#create_upload)
  * [`modifyProject`](#modify_project)
  * [`listProjects`](#list_projects)
  * [`listProjectItems`](#list_project_items)
  * [`resolveShortCode`](#resolve_short_code)
  * [`search`](#search)
  * [`suggestions`](#suggestions)
* [The Modules](#the_modules)
  * [Index.js](#indexjs)
  * [Logger](#logger)
  * [API Responses](#api_responses)
  * [Mongo Connect](#mongo_connect)
  * [Notify](#notify)
  * [Events](#events)
  * [File Storage](#file_storage)
  * [Projects](#projects)
  * [Search](#search)
  * [Short Codes](#short_codes)
  * [Tasks](#tasks)
  * [Users](#users)

## <a name="introduction" id="introduction"></a>Introduction
The backend for Elf provides an API used to create, modify, delete and interact with the task-based application. At its most basic, Elf a collection of modules that each are designed to provide a specific area of function for the API.

This document lists the API calls and provides a description of each module, including its function and configuration options.

## <a name="api" id="api"></a>API Guide
Each of Elf's modules provides a number of APIs specific to their function. The `users` module, for example, provides API function related to the create, modification, and administration of users in Elf.

Elf's API is provided in the form a WebSocket connection. A client, via a WebSocket connection, can send API calls to request information or modify data.

Elf's API communicates in JSON, a format serialized and commonly used in web-based applications. The actions referred to in this section can be selected in the parameter `action`, and other request options are sent as peers of the `action` value. For example, a request for all the users in the database can be communicated with the following message to the backend:

    {
      action: 'getUsers',
      users: [],
      JWT: *JWT TOKEN*,
      id: *ID*
    }

In this example, the `action` value specifies that the client would like to receive a list of the users, the `users` value specifies the users (in this case, all of them), the `JWT` value specifies the authentication token and the `id` value specifies the ID that can be used to determine the corresponding response from the server.

The Elf backend in designed to provide a response to every request, whether successful or not, so an application can assume that each request will recieve a corresponding response. Each request must contain an `id`; this value is echoed back by the backend in its response, and thus this value can be used to determine the corresponding response to any request. The value of `id` can be of any type or value. The following is an example of a response from the backend for the request provided above:

    {
      type: 'response',
      status: 'success',
      id: *ID*,
      content: [ ... ]
    }

In this response, the `type` value indicates that this a response from the backend, the `status` value indicates that this request was completed successfully (the value would be `'failed'` if the operation had failed), the `id` value is equal to the `id` value that was sent in the request, and the `content` value contains the requested users.

Some, but not all, requests to the backend (especially those that concern restricted information) will require an authentication token. A token can be obtained by a registered user through the `auth` API call.

In the list below, API calls requiring an authentication token are marked with the `AUTH` tag.

Additionally, there is a limit (set in the configuration) of requests per second; this limit exists to prevent Denial-Of-Service or (DOS) attacks, and violating them results in a set period of time in which all of the client's requests are blocked.

Finally, to accommodate irregular API requests, Elf offers a number of 'special connections', whose behavior is different from the standard requests. These are listed below with the `SPECIAL` tag.

### <a name="get_users" id="get_users"></a>`getUsers`
`AUTH`

The `getUsers` action can be used to receive a list of users. If specified, the action will only retrieve a subset of the users.

**Example:**

*Request:*

    {
      action: 'getUsers',
      users: [],
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*,
      content: [ ... ]
    }

### <a name="auth" id="auth"></a>`auth`

This action is used to receive an authentication token required by some other actions.

**Example:**

*Request:*

    {
      action: 'auth',
      auth: [*USERNAME*, *PASSWORD*],
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*,
      content: {
        token: *JWT TOKEN*,
        expires: *EXPIRY DATE*
      }
    }

### <a name="create_user" id="create_user"></a>`createUser`

This action is used to register a new user.

*Note: The `miscKeys` parameter is used to store miscellaneous information such as profile picture, etc.*

*Note: The `content` value of the response contains an authentication token. This token is can be used immediately without having to authenticate.*

**Example:**

*Request:*

    {
      action: 'createUser',
      create: {
        user: *NEW USERNAME*,
        name: *NAME*,
        passwd: *NEW PASSWORD*,
        email: *EMAIL*,
        miscKeys: {
          ...
        }
      },
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*,
      content: {
        token: *JWT TOKEN*,
        expires: *EXPIRY DATE*
      }
    }

### <a name="modify_user" id="modify_user"></a>`modfiyUser`

`AUTH`

This action is used to modify an existing user.

*Note: Only fields that are to be changed must be included in the request.*

**Example:**

*Request:*

    {
      action: 'modifyUser',
      modify: {
        user: *NEW USERNAME*,
        name: *NAME*,
        passwd: *NEW PASSWORD*,
        email: *EMAIL*,
        miscKeys: {
          ...
        }
      },
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*
    }

### <a name="remove_user" id="remove_user"></a>`removeUser`

`AUTH`

This action allows a user to remove their account.

**Example:**

*Request:*

    {
      action: 'removeUser',
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*
    }

### <a name="search_users" id="search_users"></a>`searchUsers`

`AUTH`

This action returns users related to query.

**Example:**

*Request:*

    {
      action: 'searchUsers',
      query: *SEARCH QUERY*,
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      content: [ ... ],
      id: *ID*
    }

### <a name="add_task" id="add_task"></a>`addTask`

`AUTH`

This call can be used to create a new task.

*Note: The `dueDate` parameter is optional and should only be used if a due date is specified.*

**Example:**

*Request:*

    {
      action: 'addTask',
      task: {
        summary: *TASK SUMMARY*,
        project: *PROJECT NAME*,
        priority: false,
        body: *PROJECT BODY*,
        tags: [ ... ],
        attachedFiles: [ ... ],
        dueDate: *TASK DUE DATE*
      },
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      content: {
        ...
      },
      id: *ID*
    }

### <a name="list_tasks" id="list_tasks"></a>`listTasks`

`AUTH`

This call can be used to recieve a list of tasks.

*Note: The `request` parameter must be included, but its contents can be empty. If this is the case, it will return all currently open tasks.*

**Example:**

*Request:*

    {
      action: 'listTasks',
      request: {
        ids: [ ... ],
        users: [ ... ],
        done: true
      },
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      content: [ ... ],
      id: *ID*
    }

### <a name="modify_task" id="modify_task"></a>`modifyTask`

`AUTH`

This call can be used to modify a task.

*Note: Only the creator of a task can modify it. All other users can only set it as done or not.*

**Example:**

*Request:*

    {
      action: 'modifyTask',
      task: {
        project: "projectid",
        priority: false,
        body: "Foobar",
        tags:["test"],
        attachedFiles: []
      },
      done: true,
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*
    }

### <a name="add_comment" id="add_comment"></a>`addComment`

`AUTH`

This call is used to post a comment to a task.

**Example:**

*Request:*

    {
      action: 'addComment',
      taskId: *TASK ID*,
      comment: *COMMENT BODY*,
      attachedFiles: [],
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*
    }

### <a name="modify_comment" id="modify_comment"></a>`modifyComment`

`AUTH`

This call is used to modify an already posted comment.

*Note: Only the creator of a comment can modify it.*

**Example:**

*Request:*

    {
      action: 'modifyComment',
      taskId: *TASK ID*,
      commentId: *COMMENT ID*,
      comment: *COMMENT BODY*,
      attachedFiles: [],
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*
    }

### <a name="search_tags" id="search_tags"></a>`searchTags`

`AUTH`

This call can be used to search for tags.

**Example:**

*Request:*

    {
      action: 'searchTags',
      query: *QUERY*,
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      content: [ ... ],
      id: *ID*
    }

### <a name="get_notifications" id="get_notifications"></a>`getNotifications`

`AUTH`

This call retrieves a list of the user's notifications.

**Example:**

*Request:*

    {
      action: 'getNotifications',
      page: *PAGE*,
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      content: [ ... ],
      id: *ID*
    }

### <a name="create_upload" id="create_upload"></a>`createUpload`

`AUTH`

This call is used to initialize an upload. The actual file is later uploaded using the returned upload ID and the `upload` special connection.

**Example:**

*Request:*

    {
      action: 'createUpload',
      file: {
        name: *FILE NAME*,
        size: *FILE SIZE*,
        type: *FILE MIME TYPE*
      },
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      content: [ ... ],
      upload: {
        ...
      }
    }

### <a name="file_info" id="file_info"></a>`fileInfo`

`AUTH`

This call is useful to determine the details of a file, such as size, type or name.

**Example:**

*Request:*

    {
      action: 'finalizeUpload',
      fileId: *UPLOAD ID*,
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*,
      file: {
        ...
      }
    }

### <a name="create_download" id="create_download"></a>`createDownload`

`AUTH`

Get a HTTP URL to download a previously uploaded file.

**Example:**

*Request:*

    {
      action: 'createDownload',
      fileId: *FILE ID*,
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*,
      content: {
        id: *DOWNLOAD ID*,
        expires: *EXPIRES TIME*
      }
    }

### <a name="create_project" id="create_project"></a>`createProject`

`AUTH`

Create a new project.

*Note: The `projectDesc` and `miscKeys` fields are optional.*

**Example:**

*Request:*

    {
      action: 'createProject',
      projectName: *NEW PROJECT NAME*,
      projectDesc: *NEW PROJECT DESCRIPTION*,
      miscKeys: *NEW PROJECT KEYS*,
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      id: *ID*,
      content: {
        ...
      }
    }

### <a name="list_projects" id="list_projects"></a>`listProjects`

`AUTH`

This call returns a list of existing projects.

*Note: Using an empty array for the `ids` parameter will return every existing project.*

**Example:**

*Request:*

    {
      action: 'listProjects',
      ids: [ ... ],
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      content: [ ... ],
      id: *ID*
    }

### <a name="list_project_items" id="list_project_items"></a>`listProjectItems`

`AUTH`

This call returns a list of users or tasks associated with a project.

*Note: Using `true` for the `tasks` parameter will return the project's associated tasks while using `false` will return the project's associated users.*

**Example:**

*Request:*

    {
      action: 'listProjectItems',
      tasks: true,
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      content: [ ... ],
      id: *ID*
    }

### <a name="resolve_short_code" id="resolve_short_code"></a>`resolveShortCode`

`AUTH`

This call returns the ID and type of entity associated with a short code.

**Example:**

*Request:*

    {
      action: 'resolveShortCode',
      code: *SHORT CODE*,
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      content: {
        ...
      },
      id: *ID*
    }

### <a name="search" id="search"></a>`search`

`AUTH`

This call can be used to search for tasks and users.

*Note: The `filters` parameter is optional.*

**Example:**

*Request:*

    {
      action: 'search',
      query: *SEARCH QUERY*,
      filters: {
          tags: [ ... ],
          project: *PROJECT*,
          users: [ ... ],
          status: true,
          date: *NEWER THAN DATE*
      },
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      results: [ ... ],
      relatedUsers: [ ... ],
      id: *ID*
    }

### <a name="suggestions" id="suggestions"></a>`suggestions`

`AUTH`

This call can be used to find suggestions for a provided incomplete search phrase.

**Example:**

*Request:*

    {
      action: 'search',
      query: *SEARCH QUERY*,
      filters: {
          tags: [ ... ],
          project: *PROJECT*,
          users: [ ... ],
          status: true,
          date: *NEWER THAN DATE*
      },
      JWT: *JWT TOKEN*,
      id: *ID*
    }

*Response:*

    {
      type: 'response',
      status: 'success',
      content: [ ... ],
      id: *ID*
    }

### <a name="events" id="events"></a>`events`

`AUTH` `SPECIAL`

This special connection can be used to listen for events, such as the creation or update of a task, modification of a users, or an added comment.

Upon connection, the client must first send the following message to indicate a special connection:

    events

Following this, the client must send their authentication token.

After the connection has been authenticated, the connection will receive notifications of events for any `EID` the client sends.

For example, sending the following message:

    user:test

Will notify the client every time the user with username `test` has updated their account or created a new task or comment.

A connection can be registered to any number of `EID`s, and will receive notifications for all of them.

A client can register to any of the following `EID`s:

    tasks
    user:*USERNAME*
    task:*TASK ID*
    tag:*TAG*
    project:*PROJECT ID*

### <a name="transfer" id="transfer"></a>Uploading and Downloading Files

`SPECIAL`

File can be uploaded and downloaded using the File Transfer Server. This server accepts HTTP POST connections to upload files and HTTP GET connections for file downloads. The respective functions above are `createUpload` and `createDownload`, both of which return an ID that must be used as the filename when connecting to the transfer server.

## <a name="the_modules" id="the_modules"></a>The Modules
The modules are APIs which receive requests and complete the corresponding action. They are separated by their functions, which makes the backend simple, modular, and easily maintainable.

A subset of the APIs, called Daemons, have special core functionality required by the other modules. They are therefore started separately from the other modules. Below, the Daemons are distinguished from other modules with the `DAEMON` tag.

### <a name="indexjs" id="indexjs"></a>Index.js

`DAEMON`

This is the base module. Starting the server requires running this file. It starts an Express.js HTTP server and begins to route API requests to the correlating API.

*Configuration*

* `usePort` (int) - what port should the HTTP server run on?
* `freqBlock` (obj) - prevent Denial-Of-Service (DOS) attacks
  * `messagesAllowedPerSecond` (int) - number of messages allowed per second for each connection
  * `blockTime` (int) - time in milliseconds (1/1000ths of a second) to block requests from offending connections
* `connectionDelay` (int) - time in milliseconds to wait before accepting any new connections
* `requireModules` (object) - modules to require into the index script
* `apiRoutes` (obj) - list of API routes
* `specialConnections` (obj) - list of special connections

### <a name="logger" id="logger"></a>Logger

`DAEMON`

This module provides logging functionality. It is used to log information and errors to the console and to a log file.

*Configuration*

* `console` (object) - configuration for console logging
  * `logging` (boolean) - log to console?
  * `logLevel` (int) - what messages to log? (1: fatal error messages only, 2: error messages, 3: important status messages only, 4: status messages, 5: debug messages, 6: all messages)
* `logPatters` (obj) - format for logging ($M is replaced by the message, $E is replaced by the log level, $N is replaced by the module name, $L is replaced by the line number, $F is replaced by the file name, $T is replaced by the current time)

### <a name="api_responses" id="api_responses"></a>API Responses

`DAEMON`

This module provides a number of commonly used API responses.

*Configuration*

* `responses` (object) - a list of responses

### <a name="mongo_connect" id="mongo_connect"></a>Mongo Connect

`DAEMON`

This module is responsible for connecting to the MongoDB database.

*Configuration*

* `dbAddress` (string) - the address of the database instance
* `dbPort` (int) - the port of the database instance
* `useDB` (string) - the name of the database to use
* `auth` (obj) - database authentication information
* `DBCheck` (obj) - periodic check to ensure successful connection to the database
* `indexes` (array) - a list of database indexes to create and maintain

### <a name="notify" id="notify"></a>Notify

`DAEMON`

This module sends notifications to all intended users.

### <a name="events" id="events"></a>Events

This module allows clients to subscribe to updates on tasks, users and projects.

### <a name="file_storage" id="file_storage"></a>File Storage

This module stores, and transfers files to clients.

*Configuration*

* `directoryLocation` (string) - the directory where files are stored
* `fileTransferPort` (int) - the network port at which to bind the file transfer server to
* `downloadExpiration` (int) - the maximum time a download stays valid

### <a name="projects" id="projects"></a>Projects

This module is used for creating and modifying projects.

### <a name="search" id="search"></a>Search

This module is used for searching for users and tasks.

*Configuration*

* `searchDepth` (int) - how many of the most recent tasks to search through
* `maxResults` (int) - the maximum number of results to send to the server

### <a name="short_codes" id="short_codes"></a>Short Codes

This module maps Short Codes (generally 5-character codes) to their associated project, or task.

### <a name="tasks" id="tasks"></a>Tasks

This module is used to create, modify, update and remove tasks.

### <a name="users" id="users"></a>Users

This module manages the collection of users.

*Configuration*

* `signingKeyFiles` (obj) - the location of files containing a cryptographic key pair to sign authentication tokens (see `keys/README` for details on generating these keys)
* `passwordFailedTimeout` (int) - the amount of time to delay sending an failed authentication response

*Last updated 03.25.2017*
