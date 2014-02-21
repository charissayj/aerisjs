define([
  'aeris/util'
], function(_) {
  /**
   * @class MockController
   * @implements aeris.application.controllers.ControllerInterface
   *
   * @constructor
   */
  var MockController = function() {
    var stubbedMethods = [
      'render',
      'close',
      'setElement'
    ];

    _.extend(this, jasmine.createSpyObj('controller', stubbedMethods));
  };


  return MockController;
});
