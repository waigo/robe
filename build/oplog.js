"use strict";


var _prototypeProperties = function (child, staticProps, instanceProps) { if (staticProps) Object.defineProperties(child, staticProps); if (instanceProps) Object.defineProperties(child.prototype, instanceProps); };

var _get = function get(object, property, receiver) { var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { return get(parent, property, receiver); } } else if ("value" in desc && desc.writable) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } };

var _inherits = function (subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) subClass.__proto__ = superClass; };

var _classCallCheck = function (instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } };

var _ = require("lodash"),
    mongo = require("mongoskin"),
    debug = require("debug")("robe-oplog"),
    EventEmitter = require("eventemitter2").EventEmitter2,
    Q = require("bluebird"),
    url = require("url");



/**
 * Represents the oplog.
 */
var Oplog = (function (EventEmitter) {
  /**
   * Constructor.
   *
   * @param  {Database} robeDb The underlying db.
   */
  function Oplog(robeDb) {
    _classCallCheck(this, Oplog);

    _get(Object.getPrototypeOf(Oplog.prototype), "constructor", this).call(this, {
      wildcard: true,
      delimiter: ":"
    });

    this.robeDb = robeDb;
    this.paused = false;
    this.active = false;
    this.watchers = [];

    var self = this;
    ["_onData", "_onError", "_onEnded"].forEach(function (m) {
      self[m] = _.bind(self[m], self);
    });
  }

  _inherits(Oplog, EventEmitter);

  _prototypeProperties(Oplog, null, {
    stop: {



      /**
       * Stop watching oplog.
       *
       * @return {Promise}
       */
      value: function stop() {
        var self = this;

        debug("Stop oplog");

        self.active = false;

        return new Q(function (resolve, reject) {
          if (!self.cursor) {
            return resolve();
          }

          self.cursor.close(function (err) {
            if (err) return reject(err);

            resolve();
          });
        }).then(function () {
          self.cursor = null;

          if (self.db) {
            debug("Close db connection");

            return new Q(function (resolve, reject) {
              self.db.close(function (err) {
                if (err) return reject(err);

                self.db = null;

                resolve();
              });
            });
          }
        });
      },
      writable: true,
      configurable: true
    },
    _connectToServer: {


      /**
       * Connect to master server.
       * @return {Promise}
       */
      value: function _connectToServer() {
        var self = this;

        return Q["try"](function () {
          if (self.db) {
            return;
          } else {
            self.databaseName = self.robeDb.db._db.s.databaseName;
            var connectionUrl = url.parse(self.robeDb.db._connectionURI, true);
            connectionUrl.pathname = "/local";
            if (connectionUrl.auth) {
              connectionUrl.query.authSource = self.databaseName;
            }

            self.db = mongo.db(url.format(connectionUrl), {
              native_parser: true
            });

            return new Q(function (resolve, reject) {
              self.db.open(function (err) {
                if (err) return reject(err);

                resolve();
              });
            });
          }
        });
      },
      writable: true,
      configurable: true
    },
    pause: {


      /**
       * Pause the oplog.
       */
      value: function pause() {
        debug("Pause oplog");

        this.paused = true;
      },
      writable: true,
      configurable: true
    },
    resume: {



      /**
       * Resume the oplog.
       */
      value: function resume() {
        debug("Resume oplog");

        this.paused = false;
      },
      writable: true,
      configurable: true
    },
    start: {



      /**
       * Start watching the oplog.
       *
       * @see  https://blog.compose.io/the-mongodb-oplog-and-node-js/
       *
       * @return {Promise}
       */
      value: function start() {
        var self = this;

        // already started?
        if (self.active) {
          return Q.resolve();
        } else {
          self.active = true;
        }

        return self._connectToServer().then(function () {
          debug("Start watching oplog");

          var oplog = self.db.collection("oplog.rs");

          // get highest current timestamp
          return Q.promisify(oplog.find, oplog)({}, {
            fields: {
              ts: 1
            },
            sort: {
              $natural: -1
            },
            limit: 1
          }).then(function (results) {
            var lastOplogTime = _.deepGet(results, "0.ts");

            // if last ts not available then set to current time
            if (!lastOplogTime) {
              lastOplogTime = new mongo.Timestamp(0, Math.floor(Date.now() / 1000 - 1));
            }

            debug("Watching for events newer than " + lastOplogTime.toString());

            // use oplog.col._native to access lower-level native collection object
            var cursor = self.cursor = oplog.find({
              ts: {
                $gte: lastOplogTime
              }
            }, {
              tailable: true,
              awaitdata: true,
              oplogReplay: true,
              numberOfRetries: -1,
              timeout: false });

            var stream = self.cursor.stream();

            stream.on("data", self._onData);
            stream.on("error", self._onError);
            stream.on("end", self._onEnded);

            debug("Cursor started");
          });
        });
      },
      writable: true,
      configurable: true
    },
    _onError: {


      /**
       * Handle error
       */
      value: function _onError(err) {
        debug("Cursor error: " + err.message);

        this.emit("error", err);
      },
      writable: true,
      configurable: true
    },
    _onEnded: {


      /** 
       * Handle oplog stream ended.
       */
      value: function _onEnded() {
        var self = this;

        debug("Cursor ended");

        // if cursor still active
        if (self.active) {
          this.cursor = null;

          Q.delay(1000).then(function () {
            debug("Restarting cursor");

            self.start()["catch"](console.error);
          });
        }
      },
      writable: true,
      configurable: true
    },
    _onData: {


      /**
       * Handle new oplog data.
       */
      value: function _onData(data) {
        debug("Cursor data: " + JSON.stringify(data));

        if (this.paused) {
          debug("Ignore data because oplog is paused");

          return;
        }

        var ns = data.ns.split("."),
            dbName = ns[0],
            colName = ns[1];

        // only want events for this db
        if (this.databaseName !== dbName) {
          debug("Ignoring data for db: " + dbName);

          return;
        }

        var opType = null;
        switch (data.op) {
          case "i":
            opType = "insert";
            break;
          case "d":
            opType = "delete";
            break;
          case "u":
            opType = "update";
            break;
          default:
            debug("Ignoring op: " + data.op);
            return;
        }

        this.emit([colName, opType], colName, opType, data.o, data.o2);
      },
      writable: true,
      configurable: true
    }
  });

  return Oplog;
})(EventEmitter);





module.exports = Oplog;