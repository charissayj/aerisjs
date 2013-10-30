define([
  'aeris/util',
  'aeris/errors/invalidconfigerror',
  'aeris/builder/options/appbuilderoptions'
], function(_, InvalidConfigError, BaseOptions) {
  /**
   * @typedef {Array.<string|Object>} MapObjectOptions
   *
   * MapExtensionObject options (eg. layers, markers) are defined as an
   * array of any mix of the following:
   *
   * - The name of the MapExtensionObject class, eg:
   *    ['AerisSatellite', 'AerisRadar']
   *
   * - An object, eg:
   *    [{
   *      name: 'StormReportMarkers',
   *      default: true,                            // If true, object will be immediately set to the map.
   *      filters: ['hail', 'wind']                 // These filters will be on, by default
   *    }, { ... }]
   *
   * Note that if controls for the map object are turned off, the
   * map object will be set to the map by default. Otherwise, the object
   * will only be immediately set to a map if the `default` option is set to true,
   * as in the example above.
   */
  /**
   * @typedef {AppBuilderOptions} MapAppBuilderOptions
   *
   * @property {HTMLElement}      el
   *                              Element where the application
   *                              should be inserted.
   *
   * @property {Object=}          map
   *                              Map options.
   *
   * @property {Function}         onload
   *                              This callback is passed the active
   *                              {aeris.maps.Map} object as the
   *                              first argument.
   *
   * @property {aeris.maps.layers.GoogleMapType}
   *                              map.baseLayer
   *                              Base layer constructor.
   *                              Defaults to {aeris.maps.layers.GoogleRoadMap}.
   *
   * @property {number=}          map.zoom
   *                              Zoom level of map. Default is 12.
   *
   * @property {Array.<number>=}  map.center
   *                              LatLon coordinates on which to center the map.
   *
   * @property {Boolean=}         map.scrollZoom
   *                              Whether to allow map zooming
   *                              with the mouse scroll wheel.
   *                              Default is true.
   *
   * @property {MapObjectOptions} layers
   *                              Overlay layers.
   *
   * @property {MapObjectOptions} markers
   *                              Point data marker collection.
   *
   *
   * @property {Boolean=}         autoAnimate
   *                              If true, layer animations will begin as soon
   *                              as the app loads.
   *
   * @property {Object=|Boolean=} controls
   *                              Options for UI controls to interact with the map.
   *
   * @property {Boolean=}         controls.layers
   *                              Set to true to display layer controls
   *
   * @property {Boolean=}         controls.markers
   *                              Set to true to display marker controls
   *
   * @property {Boolean=}         controls.animation
   *                              Set to true to display animation controls
   */

  /**
   * Builder configuration options for the MapAppBuilder
   *
   * @class aeris.builder.options.MapAppBuilderOptions
   * @extends aeris.builder.options.AppBuilderOptions
   *
   * @constructor
   *
   * @param {MapAppBuilderOptions=} opt_attrs
   *
   * @param {Array.<string>} opt_options.mapObjectTypes
   */
  var MapAppBuilderOptions = function(opt_attrs, opt_options) {
    var options = _.defaults(opt_options || {}, {
      mapObjectTypes: []
    });

    /**
     * Valid map objected configuration keys.
     *
     * @type {Array.<string>}
     * @private
     */
    this.mapObjectTypes_ = options.mapObjectTypes;

    BaseOptions.call(this, opt_attrs, options);
  };

  _.inherits(MapAppBuilderOptions, BaseOptions);


  /**
   * @override
   */
  MapAppBuilderOptions.prototype.normalize_ = function(options) {
    options = _.extend({
      controls: {}
    }, options);

    // Default to visible if layer controls off
    layerVisibleDefault = !options.controls.layers;

    // Normalize MapObjectOptions
    _.each(this.mapObjectTypes_, function(configKey) {
      options[configKey] = this.normalizeMapObject_(options[configKey], {
        default: !options.controls[configKey]
      });
    }, this);

    return options;
  };


  /**
   * Normalizes a {MapObjectOptions} array into the form:
   *  [{
   *    name: {String}
   *    default: {Boolean}
   *  }...]
   *
   * @param {MapObjectOptions} mapObjectOptions
   * @param {Object=} opt_options
   * @param {Boolean=} opt_options.default Whether to set default to true, by default.
   * @return {MapObjectOptions}
   *
   * @private
   */
  MapAppBuilderOptions.prototype.normalizeMapObject_ = function(mapObjectOptions, opt_options) {
    var options = _.extend({
      default: true
    }, opt_options);

    // MapObjectOptions default values
    var defaultObj = {
      default: options.default,
      filters: []
    };

    _.each(mapObjectOptions, function(opt, n) {
      var optionObject = _.isString(opt) ? { name: opt } : opt;

      // Set defaults
      mapObjectOptions[n] = _.defaults(optionObject, defaultObj);
    }, this);

    return mapObjectOptions;
  };


  return MapAppBuilderOptions;
});