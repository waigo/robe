"use strict";


var _ = require('lodash'),
  debug = require('debug')('robe'),
  Q = require('bluebird'),
  monk = require('monk'),
  Database = require('./database');



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
   * @param {Object} [options]
   * @param {Number} [options.timeout] Connection timeout in milliseconds. Default is no timeout.
   * @return {Promise} which resolves to a database connection if successful.
   */
  static connect (url, options) {
    debug('connect to ' + url);

    options = _.extend({
      timeout: null
    }, options);

    return new Q((resolve, reject) => {
      let db;

      db = monk(url, options, (err) => {
        if (err) {
          const newErr = new Error(`Failed to connect to db`);
          
          newErr.root = err;
          
          reject(newErr);
        } else {
          let instance = new Database(db);
          
          dbConnections.push(instance);

          resolve(instance);
        }
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





module.exports = Manager;
