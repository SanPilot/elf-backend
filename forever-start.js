/*

Elf Forever Start
Ensure the backend server is never offline.

*/

var forever = require('forever');
forever.start("./index.js", {});
