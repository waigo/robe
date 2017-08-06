"use strict";


var _ = require('lodash'),
  mongo = require('mongoskin'),
  debug = require('debug')('robe-oplog'),
  EventEmitter = require('eventemitter2').EventEmitter2,
  Q = require('bluebird'),
  url = require('url');



/**
 * Represents the oplog.
 */
class Oplog extends EventEmitter {
  /**
   * Constructor.
   *
   * @param  {Database} robeDb The underlying db.
   */
  constructor (robeDb) {
    super({
      wildcard: true,
      delimiter: ':'
    });

    this.robeDb = robeDb;
    this.paused = false;
    this.active = false;
    this.watchers = [];

    var self = this;
    ['_onData', '_onError', '_onEnded'].forEach(function(m) {
      self[m] = _.bind(self[m], self);
    });
  }



  /**
   * Stop watching oplog.
   *
   * @return {Promise}
   */
  stop () {
    var self = this;

    debug('Stop oplog');

    self.active = false;

    return new Q(function(resolve, reject) {
      if (!self.cursor) {
        return resolve();
      }
      
      self.cursor.close(function(err) {
        if (err) return reject(err);

        resolve();
      });  
    })
      .then(function() {
        self.cursor = null;

        if (self.db) {
          debug('Close db connection');

          return new Q(function(resolve, reject){
            self.db.close(function(err) {
              if (err) return reject(err);

              self.db = null;

              resolve();
            }); 
          });
        }
      });
  }


  _resolveServerDb() {
    var self = this;

    // find out master server
    const masterDoc = self.robeDb.db._db.topology.isMasterDoc;

    if (!masterDoc.ismaster) {
      throw new Error('No MASTER server found for oplog');
    }

    self.auth = url.parse(self.robeDb.db._connectionURI).auth;
    self.databaseName = self.robeDb.db._db.s.databaseName;
    self.hostPort = masterDoc.primary;

    debug('Resolved db: ' + self.hostPort + '/' + self.databaseName);
  }



  /**
   * Connect to master server.
   * @return {Promise}
   */
  _connectToServer () {
    var self = this;

    return Q.try(function() {
      if (self.db) {
        return;
      } else {
        self._resolveServerDb();

        debug('Connect to db ' + self.hostPort);

        var connectionString;
        if (self.auth) {
          connectionString = "mongodb://" + self.auth + "@" + self.hostPort + "/local?authSource=" + self.databaseName;
        } else {
          connectionString = "mongodb://" + self.hostPort + "/local";
        }
        self.db = mongo.db(connectionString, {
          native_parser:true
        });

        return new Q(function(resolve, reject) {
          self.db.open(function(err) {
            if (err) return reject(err);

            resolve();
          });
        });
      }
    });
  }


  /**
   * Pause the oplog.
   */
  pause () {
    debug('Pause oplog');

    this.paused = true;
  }



  /**
   * Resume the oplog.
   */
  resume () {
    debug('Resume oplog');

    this.paused = false;
  }



  /**
   * Start watching the oplog.
   *
   * @see  https://blog.compose.io/the-mongodb-oplog-and-node-js/
   *
   * @return {Promise}
   */
  start () {
    var self = this;

    // already started?
    if (self.active) {
      return Q.resolve();
    } else {
      self.active = true;
    }

    return self._connectToServer()
      .then(function() {
        debug('Start watching oplog');

        var oplog = self.db.collection('oplog.rs');

        // get highest current timestamp
        return Q.promisify(oplog.find, oplog)({}, {
          fields: { 
            ts: 1
          },
          sort: {
            '$natural': -1
          },
          limit: 1
        })
          .then(function(results) {
            var lastOplogTime = _.deepGet(results, '0.ts');

            // if last ts not available then set to current time
            if (!lastOplogTime) {
              lastOplogTime = new mongo.Timestamp(0, Math.floor(Date.now() / 1000 - 1));
            }

            debug('Watching for events newer than ' + lastOplogTime.toString());

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
              timeout: false,
            });

            var stream = self.cursor.stream();

            stream.on('data', self._onData);
            stream.on('error', self._onError);
            stream.on('end', self._onEnded);

            debug('Cursor started');
          });
      });
  }  


  /**
   * Handle error
   */
  _onError (err) {
    debug('Cursor error: ' + err.message);

    this.emit('error', err);
  }


  /** 
   * Handle oplog stream ended.
   */
  _onEnded () {
    var self = this;

    debug('Cursor ended');

    // if cursor still active
    if (self.active) {
      this.cursor = null;

      Q.delay(1000)
        .then(function() {
          debug('Restarting cursor');

          self.start().catch(console.error);
        });
    }
  }


  /**
   * Handle new oplog data.
   */
  _onData (data) {
    debug('Cursor data: ' + JSON.stringify(data));

    if (this.paused) {
      debug('Ignore data because oplog is paused');

      return;
    }

    var ns = data.ns.split('.'),
      dbName = ns[0],
      colName = ns[1];

    // only want events for this db
    if (this.databaseName !== dbName) {
      debug('Ignoring data for db: ' + dbName);
      
      return;
    }

    var opType = null;
    switch (data.op) {
      case 'i':
        opType = 'insert';
        break;
      case 'd':
        opType = 'delete';
        break;
      case 'u':
        opType = 'update';
        break;
      default:
        debug('Ignoring op: ' + data.op);
        return;
    }

    this.emit([colName, opType], colName, opType, data.o, data.o2);
  }
}



module.exports = Oplog;


