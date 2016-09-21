var _ = require('lodash'),
  Q = require('bluebird');


var utils = require('../testutils'),
  assert = utils.assert,
  expect = utils.expect,
  should = utils.should,
  sinon = utils.sinon;

var Robe = utils.Robe,
  Database = Robe.Database;



var test = utils.createTest(module);


test.afterEach = function*() {
  yield Robe.closeAll();
}


test['default options'] = function*() {
  Robe.DEFAULT_CONNECTION_OPTIONS.should.eql({
    timeout: 3000
  });
};


test['connect'] = {
  'valid': function*() {
    var db = yield Robe.connect('127.0.0.1/robe-test');

    db.should.be.instanceOf(Robe.Database);
  },
  /**
   * TODO: Fix
   *
   * Test completes successfully but process hangs because handles not yet 
   * cleaned up...why not!? Initial investigation points to something in either 
   * Monk or mongodb node.js package - needs looking into
   */
  'timeout': {
    'default': function*() {
      console.log('TODO');
  //     this.timeout(Robe.DEFAULT_CONNECTION_OPTIONS.timeout * 2);

  //     try {
  //       yield Robe.connect('127.123.121.233');

  //       throw new Error('Should not be here');
  //     } catch (err) {
  //       err.message.should.eql('Timed out connecting to db');
  //     }
    },
    'custom': function*() {
      console.log('TODO');
  //     try {
  //       yield Robe.connect('127.123.121.233', {
  //         timeout: 100
  //       });

  //       throw new Error('Should not be here');
  //     } catch (err) {
  //       err.message.should.eql('Timed out connecting to db');
  //     }
    },
  },
  'replica set': function*() {
    var db = yield Robe.connect(['127.0.0.1/robe-test','localhost/robe-test']);

    db.should.be.instanceOf(Robe.Database);
  },
};




