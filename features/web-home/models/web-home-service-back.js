module.exports = function() {
  'use strict';

  DependencyInjection.service('$WebHomeService', function($RealTimeService) {

    return new (function $WebHomeService() {

      var REALTIME_EVENTS = {
            'web-home-cover': {
              call: 'callCover'
            },
            'web-home-metrics': {
              call: 'callMetrics'
            },
            'web-home-tiles': {
              call: 'callTiles'
            }
          },
          MAX_TILES = 30,
          BING_URL = 'http://bing.com',
          BING_SERVICE = 'http://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US',

          request = require('request'),
          async = require('async'),
          _this = this,
          _refreshCoverTries = 0,
          _cover = null,
          _copyright = null,
          _copyrightUrl = null,
          _metrics = [],
          _tilesLoaders = [];

      this.init = function() {
        Object.keys(REALTIME_EVENTS).forEach(function(eventName) {
          if (REALTIME_EVENTS[eventName].call) {
            var call = REALTIME_EVENTS[eventName].call;

            REALTIME_EVENTS[eventName].call = function() {
              _this[call].apply(_this, arguments);
            };
          }
        });

        $RealTimeService.registerEvents(REALTIME_EVENTS);

        _this.refreshCover();
      };

      this.coverDefault = function(thenCall) {
        _cover =  null;
        _copyright = null;
        _copyrightUrl = null;

        if (thenCall) {
          _this.callCover();
        }
      };

      this.refreshCover = function(thenCall) {
        if (process.env.WEB_HOME_BING && process.env.WEB_HOME_BING == 'false') {
          return this.coverDefault();
        }

        _refreshCoverTries++;

        request(BING_SERVICE, function(err, response, body) {
          if (err || !body || typeof body != 'string' || body.trim().substr(0, 1) != '{') {
            if (_refreshCoverTries < 3) {
              setTimeout(function() {
                _this.refreshCover(thenCall);
              }, 1000);

              return;
            }

            _refreshCoverTries = 0;

            this.coverDefault();

            return;
          }

          try {
            body = JSON.parse(body);

            _cover = BING_URL + '/' + body.images[0].url;
            _copyright = body.images[0].copyright;
            _copyrightUrl = body.images[0].copyrightlink;
          }
          catch (ex) {
            return _this.coverDefault();
          }

          var today = new Date(),
              tomorrow = new Date();

          tomorrow.setDate(today.getDate() + 1);

          setTimeout(function() {
            _this.refreshCover(true);
          }, tomorrow.getTime() - today.getTime() + 1000);

          if (thenCall) {
            _this.callCover();
          }
        });
      };

      this.callCover = function($socket, eventName, args, callback) {
        eventName = eventName || 'web-home-cover';

        $RealTimeService.fire(eventName, {
          cover: _cover,
          copyright: _copyright,
          copyrightUrl: _copyrightUrl
        }, $socket || null);

        if (callback) {
          callback();
        }
      };

      this.metric = function(metric, value) {
        var name = typeof metric == 'string' ? metric : metric.name;

        var toAdd = true;

        for (var i = 0; i < _metrics.length; i++) {
          if (_metrics[i].name == name) {
            if (typeof metric == 'string') {
              if (typeof value != 'undefined') {
                _metrics[i].value = value;

                _this.callMetrics();
              }

              return _metrics[i];
            }

            _metrics[i] = metric;
            toAdd = false;

            break;
          }
        }

        if (typeof metric == 'string') {
          return null;
        }

        if (toAdd) {
          _metrics.push(metric);
        }

        _this.callMetrics();
      };

      this.callMetrics = function($socket, eventName, args, callback) {
        eventName = eventName || 'web-home-metrics';

        $RealTimeService.fire(eventName, {
          metrics: _metrics
        }, $socket || null);

        if (callback) {
          callback();
        }
      };

      this.tilesLoader = function(func) {
        _tilesLoaders.push(func);
      };

      this.refreshTiles = function(userId) {
        var sockets = $RealTimeService.userSocketsWithEvent(userId, 'web-home-tiles');

        sockets.forEach(function(socket) {
          _this.callTiles(socket);
        });
      };

      this.callTiles = function($socket, eventName, args, callback) {
        eventName = eventName || 'web-home-tiles';

        if ($socket && !$RealTimeService.socketHasEvent($socket, eventName)) {
          if (callback) {
            callback();
          }

          return;
        }

        var tiles = [];

        async.eachSeries(_tilesLoaders, function(loader, nextLoader) {

          loader($socket, args, function(getTiles) {
            tiles = tiles.concat(getTiles || []);

            nextLoader();
          });

        }, function() {
          tiles.sort(function(a, b) {
            return new Date(b.date) - new Date(a.date);
          });

          tiles = tiles.length > MAX_TILES ? tiles.splice(0, MAX_TILES) : tiles;

          $RealTimeService.fire(eventName, {
            tiles: tiles
          }, $socket || null);

          if (callback) {
            callback();
          }
        });
      };

    })();
  });

};