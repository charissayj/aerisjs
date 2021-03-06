define([
  'aeris/util',
  'aeris/maps/animations/abstractanimation',
  'aeris/promise',
  'aeris/errors/invalidargumenterror',
  'aeris/util/findclosest'
], function(_, AbstractAnimation, Promise, InvalidArgumentError, findClosest) {
  /**
   * Animates a single {aeris.maps.layers.AerisTile} layer.
   *
   * @publicApi
   * @class aeris.maps.animations.TileAnimation
   * @constructor
   * @extends aeris.maps.animations.AbstractAnimation
   *
   * @param {aeris.maps.layers.AerisTile} layer The layer to animate.
   * @param {aeris.maps.animations.options.AnimationOptions} opt_options
   * @param {number} opt_options.timestep Time between animation frames, in milliseconds.
   * @param {aeris.maps.animations.helpers.AnimationLayerLoader=} opt_options.animationLayerLoader
   */
  var TileAnimation = function(layer, opt_options) {
    var options = opt_options || {};

    AbstractAnimation.call(this, options);


    /**
     * The original layer object, which will serve as
     * the 'master' for all animation layer "frames."
     *
     * @type {aeris.maps.layers.AerisTile}
     * @private
     * @property masterLayer_
     */
    this.masterLayer_ = layer;


    /**
     * @property currentLayer_
     * @private
     * @type {?aeris.maps.layers.AerisTile}
     */
    this.currentLayer_ = null;


    /**
     * A hash of {aeris.maps.layers.AerisTile},
     * listed by timestamp.
     *
     * @type {Object.<number,aeris.maps.layers.AerisTile>}
     * @private
     * @property layersByTime_
     */
    this.layersByTime_ = {};


    /**
     * An array of available timestamps.
     *
     * @type {Array.number}
     * @private
     * @property times_
     */
    this.times_ = [];


    // Convert the master layer into a "dummy" view model,
    // with no bound rendering behavior.
    //
    // This will allow the client to manipulate the master layer
    // as a proxy for all other animation frames, without actually
    // showing the layer on the map.
    //
    this.masterLayer_.removeStrategy();

    // Load all the tile layers for the animation
    this.loadAnimationLayers();

    // Reload layers, when our bounds change
    this.listenTo(this, 'change:to change:from', function() {
      this.loadAnimationLayers();
    });

    // Make sure the current layer is loaded, when the masterLayer get a map
    this.listenTo(this.masterLayer_, 'map:set', function() {
      this.preloadLayer_(this.getCurrentLayer());
    });
  };
  _.inherits(TileAnimation, AbstractAnimation);

  /**
   * @property DEFAULT_TIME_TOLERANCE_
   * @static
   * @type {number}
   * @private
   */
  TileAnimation.DEFAULT_TIME_TOLERANCE_ = 1000 * 60 * 60 * 2; // 2 hours

  /**
   * Load the tile layers for the animation.
   *
   * @return {aeris.Promise} Promise to load all layers.
   * @method loadAnimationLayers
   */
  TileAnimation.prototype.loadAnimationLayers = function() {
    var prevCurrentTime = this.getCurrentTime();
    var prevLayersByTime = this.layersByTime_;

    // Create new layers
    var nextTimes = getTimeRange(this.from_, this.to_, this.limit_);
    var nextLayers = nextTimes.reduce(function(lyrs, time) {
      lyrs[time] = this.masterLayer_.clone({
        time: new Date(time),
        map: null,
        autoUpdate: false
      });
      return lyrs;
    }.bind(this), {});

    // Wait for new current layer to load
    var nextCurrentTime = this.getClosestTime_(prevCurrentTime, nextTimes);
    var nextCurrentLayer = nextLayers[nextCurrentTime];

    this.times_ = nextTimes;
    this.layersByTime_ = nextLayers;
    this.bindLayerLoadEvents_();

    this.trigger('load:times', this.times_.slice(0));

    // If there's already layers loaded,
    // preload the new layers, before transitioning.
    // This prevents a "flash" when change bounds
    // (eg. when AIM autoUpdate triggers)
    var transition = (function() {
      this.goToTime(this.getCurrentTime());
      // Remove old layers
      _.each(prevLayersByTime, function(lyr) {
        lyr.destroy();
      });
    }.bind(this));
    if (this.getCurrentLayer()) {
      this.preloadLayer_(nextCurrentLayer)
        .always(function() {
          setTimeout(transition, 1000);
        }, this);
    }
    else {
      transition();
    }
  };

  TileAnimation.prototype.bindLayerLoadEvents_ = function() {
    var triggerLoadReset = _.debounce(function() {
      this.trigger('load:reset', this.getLoadProgress());
    }.bind(this), 15);

    var triggerLoadProgress = (function() {
      var progress = this.getLoadProgress();
      if (progress === 1) {
        this.trigger('load:complete', progress);
      }

      this.trigger('load:progress', progress);
    }.bind(this));

    _.each(this.layersByTime_, function(lyr) {
      lyr.on({
        'load': triggerLoadProgress,
        'load:reset': triggerLoadReset
      });
    }.bind(this));
  };

  /**
   * @method preload
   */
  TileAnimation.prototype.preload = function() {
    var promiseToPreload = new Promise();

    var layers = _.values(this.layersByTime_);

    // Then preload the rest
    var layersToPreload = [this.getCurrentLayer()].concat(_.shuffle(layers));
    Promise.map(layersToPreload, this.preloadLayer_, this)
      .done(promiseToPreload.resolve)
      .fail(promiseToPreload.reject);

    return promiseToPreload;
  };


  /**
   * Preloads a single tile layer.
   *
   * @method preloadLayer_
   * @private
   * @param {aeris.maps.layers.AerisTile} layer
   * @return {aeris.Promise} Promise to load the layer
   */
  TileAnimation.prototype.preloadLayer_ = function(layer) {
    var promiseToPreload = new Promise();

    var doPreload = (function() {
      // Add the layer to the map
      // with opacity 0 (to trigger loading)
      layer.set({
        map: this.masterLayer_.getMap(),
        opacity: layer === this.getCurrentLayer() ? this.masterLayer_.getOpacity() : 0
      });

      // Resolve once we're done loading
      layer.once('load', promiseToPreload.resolve);

      // Give up after a while, so we're not blocking the animation
      setTimeout(function() {
        if (promiseToPreload.getState() === 'pending') {
          // Just call the layer loaded (show whatever we've got)
          layer.trigger('load');
        }
      }.bind(this), 2000);
    }.bind(this));


    // Wait for the last layer to preload,
    // before preloading the next one
    this.lastPromiseToPreload_ || (this.lastPromiseToPreload_ = Promise.resolve());
    this.lastPromiseToPreload_
      .always(function() {
        // If the layer is already loaded, no more work to do.
        if (layer.isLoaded()) {
          promiseToPreload.resolve();
        }
        // Wait for a map to be set, before preloading
        else if (!this.masterLayer_.getMap()) {
          this.masterLayer_.once('map:set', doPreload);
        }
        else {
          doPreload();
        }
      }, this);

    this.lastPromiseToPreload_ = promiseToPreload;
    return promiseToPreload;
  };



  /**
   * @method refreshCurrentLayer_
   * @private
   */
  TileAnimation.prototype.refreshCurrentLayer_ = function() {
    this.goToTime(this.getCurrentTime());
  };

  TileAnimation.prototype.start = function() {
    AbstractAnimation.prototype.start.call(this);
    // preload on start
    // (this gives a little better ux than allowing layers to preload
    //  as we hit them, because `preload()` shuffles the layer order)
    this.preload();
  };


  /**
   * Animates to the layer at the next available time,
   * or loops back to the start.
   * @method next
   */
  TileAnimation.prototype.next = function() {
    var nextTime = this.getNextTime_();

    if (!nextTime) {
      return;
    }

    this.goToTime(nextTime);
  };


  /**
   * Animates to the previous layer,
   * or loops back to the last layer.
   * @method previous
   */
  TileAnimation.prototype.previous = function() {
    var prevTime = this.getPreviousTime_();

    if (!prevTime) {
      return;
    }

    this.goToTime(prevTime);
  };


  /**
   * Animates to the layer at the specified time.
   *
   * If no layer exists at the exact time specified,
   * will use the closest available time.
   *
   * @param {number|Date} time UNIX timestamp or date object.
   * @method goToTime
   */
  TileAnimation.prototype.goToTime = function(time) {
    var nextLayer;
    var currentLayer;
    var haveTimesBeenLoaded = !!this.getTimes().length;

    time = _.isDate(time) ? time.getTime() : time;

    if (!_.isNumeric(time)) {
      throw new InvalidArgumentError('Invalid animation time: time must be a Date or a timestamp (number).');
    }

    currentLayer = this.getCurrentLayer();
    // Note that we may not be able to find a layer in the same tense,
    // in which case this value is null.
    nextLayer = this.getLayerForTimeInSameTense_(time) || null;

    // Set the new layer
    this.currentTime_ = time;

    if (nextLayer === currentLayer) {
      return;
    }

    // If no time layers have been created
    // wait for time layers to be created,
    // then try again. Otherwise, our first
    // frame will  never show.
    if (!haveTimesBeenLoaded) {
      this.listenToOnce(this, 'load:times', function() {
        this.goToTime(this.getCurrentTime());
      });
    }

    if (nextLayer) {
      this.transition_(currentLayer, nextLayer);
    }
    else if (currentLayer) {
      this.transitionOut_(currentLayer);
    }

    this.currentLayer_ = nextLayer;
    this.trigger('change:time', new Date(this.currentTime_));
  };


  /**
   * @return {number} Percentage complete loading tile (1.0 is 100% complete).
   * @method getLoadProgress
   */
  TileAnimation.prototype.getLoadProgress = function() {
    var totalCount = _.keys(this.layersByTime_).length;
    var loadedCount = 0;

    if (!totalCount) {
      return 0;
    }

    _.each(this.layersByTime_, function(layer) {
      if (layer.isLoaded()) {
        loadedCount++;
      }
    }, 0);


    return Math.min(loadedCount / totalCount, 1);
  };


  /**
   * @method hasMap
   */
  TileAnimation.prototype.hasMap = function() {
    return this.masterLayer_.hasMap();
  };


  /**
   * Destroys the tile animation object,
   * clears animation frames from memory.
   *
   *
   * @method destroy
   */
  TileAnimation.prototype.destroy = function() {
    _.invoke(this.layersByTime_, 'destroy');
    this.layersByTime_ = {};
    this.times_.length = 0;

    this.stopListening();

    this.masterLayer_.resetStrategy();
  };


  /**
   * Returns available times.
   * Note that times are loaded asynchronously from the
   * Aeris Interactive Tiles API, so they will not be immediately
   * available.
   *
   * Wait for the 'load:times' event to fire before attempting
   * to grab times.
   *
   * @return {Array.<number>} An array timestamps for which
   *                          they are available tile frames.
   * @method getTimes
   */
  TileAnimation.prototype.getTimes = function() {
    return _.clone(this.times_);
  };


  /**
   * @method getLayerForTimeInSameTense_
   * @private
   * @param {Number} time
   * @return {aeris.maps.layers.AerisTile}
   */
  TileAnimation.prototype.getLayerForTimeInSameTense_ = function(time) {
    return this.layersByTime_[this.getClosestTimeInSameTense_(time)];
  };


  /**
   * Returns the closes available time.
   *
   * @param {number} targetTime UNIX timestamp.
   * @param {Array.<Number>} opt_times Defaults to loaded animation times.
   * @return {number}
   * @private
   * @method getClosestTime_
   */
  TileAnimation.prototype.getClosestTime_ = function(targetTime, opt_times) {
    var times = opt_times || this.times_;
    return findClosest(targetTime, times);
  };


  /**
   * Returns the closes available time.
   *
   * If provided time is in the past, will return
   * the closest past time (and vice versa);
   *
   * @method getClosestTimeInSameTense_
   * @private
   *
   * @param {number} targetTime UNIX timestamp.
   * @param {Array.<Number>} opt_times Defaults to loaded animation times.
   * @return {number}
   */
  TileAnimation.prototype.getClosestTimeInSameTense_ = function(targetTime, opt_times) {
    var isTargetInFuture = targetTime > Date.now();
    var times = opt_times || this.times_;

    // Only look at times that are in the past, if
    // the target is in the past, and vice versa.
    var timesInSameTense = times.filter(function(time) {
      var isTimeInFuture = time > Date.now();
      var isTimeInSameTenseAsTarget = isTimeInFuture && isTargetInFuture || !isTimeInFuture && !isTargetInFuture;

      return isTimeInSameTenseAsTarget;
    });

    return findClosest(targetTime, timesInSameTense);
  };


  /**
   * Transition from one layer to another.
   *
   * @param {?aeris.maps.layers.AerisTile} opt_oldLayer
   * @param {aeris.maps.layers.AerisTile} newLayer
   * @private
   * @method transition_
   */
  TileAnimation.prototype.transition_ = function(opt_oldLayer, newLayer) {


    // If the new layer is not yet loaded,
    // wait to transition until it is.
    // This prevents displaying an "empty" tile layer,
    // and makes it easier to start animations before all
    // layers are loaded.
    if (!newLayer.isLoaded()) {
      this.preloadLayer_(newLayer);
      this.transitionWhenLoaded_(opt_oldLayer, newLayer);
    }


    // Hide all the layers
    // Sometime we have trouble with old layers sticking around.
    // especially when we need to reload layers for new bounds.
    // This a fail-proof way to handle that issue.
    _.without(this.layersByTime_, newLayer).
      forEach(this.transitionOut_, this);

    this.transitionInClosestLoadedLayer_(newLayer);
  };


  /**
   * @param {aeris.maps.layers.AerisTile} layer
   * @method transitionIn_
   * @private
   */
  TileAnimation.prototype.transitionIn_ = function(layer) {
    this.syncLayerToMaster_(layer);
  };


  /**
   * @param {aeris.maps.layers.AerisTile} layer
   * @method transitionOut_
   * @private
   */
  TileAnimation.prototype.transitionOut_ = function(layer) {
    layer.stopListening(this.masterLayer_);
    layer.setOpacity(0);
  };


  /**
   * Handle transition for a layer which has not yet
   * been loaded
   *
   * @param {?aeris.maps.layers.AerisTile} opt_oldLayer
   * @param {aeris.maps.layers.AerisTile} newLayer
   * @method transitionWhenLoaded_
   * @private
   */
  TileAnimation.prototype.transitionWhenLoaded_ = function(opt_oldLayer, newLayer) {
    // Clear any old listeners from this transition
    // (eg. if transition is called twice for the same layer)
    this.stopListening(newLayer, 'load');
    this.listenToOnce(newLayer, 'load', function() {
      if (this.getCurrentLayer() === newLayer) {
        this.transition_(opt_oldLayer, newLayer);
      }
    });
  };


  /**
   * @method transitionInClosestLoadedLayer_
   * @private
   */
  TileAnimation.prototype.transitionInClosestLoadedLayer_ = function(layer) {
    var loadedTimes = _.keys(this.layersByTime_).filter(function(time) {
      return this.layersByTime_[time].isLoaded();
    }, this);
    var closestLoadedTime = this.getClosestTimeInSameTense_(layer.get('time').getTime(), loadedTimes);

    if (!closestLoadedTime) {
      return;
    }


    this.transitionIn_(this.layersByTime_[closestLoadedTime]);
  };


  /**
   * Update the attributes of the provided layer
   * to match those of the master layer.
   *
   * @method syncLayerToMaster_
   * @private
   * @param  {aeris.maps.layers.AerisTile} layer
   */
  TileAnimation.prototype.syncLayerToMaster_ = function(layer) {
    var boundAttrs = [
      'map',
      'opacity',
      'zIndex'
    ];

    // clear any old bindings
    layer.stopListening(this.masterLayer_);

    layer.bindAttributesTo(this.masterLayer_, boundAttrs);
  };


  TileAnimation.prototype.getCurrentLayer = function() {
    return this.currentLayer_;
  };


  TileAnimation.prototype.getNextTime_ = function() {
    return this.isCurrentLayerLast_() ?
      this.times_[0] : this.times_[this.getLayerIndex_() + 1];
  };


  TileAnimation.prototype.getPreviousTime_ = function() {
    var lastTime = _.last(this.times_);
    return this.isCurrentLayerFirst_() ?
      lastTime : this.times_[this.getLayerIndex_() - 1];
  };

  /**
   * @method isCurrentLayer_
   * @private
   * @param {aeris.maps.layers.AerisTile} layer
   * @return {Boolean}
   */
  TileAnimation.prototype.isCurrentLayer_ = function(layer) {
    return layer === this.getCurrentLayer();
  };


  /**
   * @return {boolean} True, if the current layer is the first frame.
   * @private
   * @method isCurrentLayerFirst_
   */
  TileAnimation.prototype.isCurrentLayerFirst_ = function() {
    return this.getLayerIndex_() === 0;
  };


  /**
   * @return {boolean} True, if the current layer is the last frame.
   * @private
   * @method isCurrentLayerLast_
   */
  TileAnimation.prototype.isCurrentLayerLast_ = function() {
    return this.getLayerIndex_() === this.times_.length - 1;
  };


  /**
   * Returns the index of the current layer
   * within this.times_.
   *
   * @return {number}
   * @private
   * @method getLayerIndex_
   */
  TileAnimation.prototype.getLayerIndex_ = function(layer) {
    layer || (layer = this.getCurrentLayer());
    return this.times_.indexOf(layer.get('time').getTime());
  };

  function getTimeRange(from, to, limit) {
    var animationDuration = to - from;
    var MIN_INTERVAL = 1000 * 60;
    var animationInterval = Math.max(Math.floor(animationDuration / limit), MIN_INTERVAL);

    return _.range(from, to, animationInterval);
  }


  return _.expose(TileAnimation, 'aeris.maps.animations.TileAnimation');
});
