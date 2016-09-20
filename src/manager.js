"use strict";


var _ = require('lodash'),
  debug = require('debug')('robe'),
  Class = require('class-extend'),
  Q = require('bluebird'),
  monk = require('monk'),
  Database = require('./database');


// Original monk.onOpen callback does not handle errors
monk.prototype.onOpen = function (err, db) {
  this.emit('open', err, db);
};

/**
 * All db connections.
 * @type {Array}
 */
var dbConnections = [];


/**
 * Overall database manager and entry point to Robe.
 */
class Manager {
  /**
   * Connect to given database.
   * @param {String|Array} url Either db URL or array of replica set URLs.
   * @param {Object} options Connection options.
   * @param {Number} options.timeout Connection timeout in milliseconds. Default is 3000.
   * @return {Promise} which resolves to a database connection if successful.
   */
  static connect (url, options = {}) {
    if (!Array.isArray(url)) {
      url = [url];
    }

    _.defaults(options, Manager.DEFAULT_CONNECTION_OPTIONS);

    debug('connect to ' + url.join(', '));

    return new Q(function checkConnection(resolve, reject) {
      var monkOptions = {connectTimeoutMS: options.timeout};
      var db = monk.call(null, url, monkOptions, function monkCallback(err, val) {
        if (err) {
          return reject(err);
        }

        var instance = new Database(db);
        dbConnections.push(instance);

        resolve(instance);
      });
    });
  }


  /**
   * Close all opened db connections.
   * @return {Promise}
   */
  static closeAll () {
    debug('close all connections: ' + dbConnections.length);

    return Q.map(dbConnections, function(db) {
      return db.close();
    })
      .then(function() {
        dbConnections = [];
      });
  }
}

/**
 * Default connection options.
 * @type {Object}
 */
Manager.DEFAULT_CONNECTION_OPTIONS = {
  timeout: 3000
};

Manager.extend = Class.extend;



module.exports = Manager;
