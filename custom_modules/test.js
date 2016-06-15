var logger = require("./logger.daemon.js"),
mongoClient = require('mongodb').MongoClient,
assert = require('assert');
exports.testFunc = (req, res) => {
  var url = "mongodb://localhost:27017/myproject";
  mongoClient.connect(url, (err, db) => {
    assert.equal(null, err);
    logger.log("Correctly connected to MongoDB server", 6, true, "test");
    res.send("SENT? ?_?")
    db.close();
  })
  logger.log("RECIEVED REQUEST", 6, false, "test");
}
