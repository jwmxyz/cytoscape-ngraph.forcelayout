'use strict';

var Graph = require('ngraph.graph');
var _ = require('underscore');
var Q = require('Q');
var Nlayout = require('ngraph.asyncforce');
// registers the extension on a cytoscape lib ref

var ngraph = function (cytoscape) {

    if (!cytoscape) {
        return;
    } // can't register if cytoscape unspecified

    var defaults = {
        async: {
            // tell layout that we want to compute all at once:
            maxIterations: 1000,
            stepsPerCycle: 30,

            // Run it till the end:
            waitForStep: false
        },
        physics: {
            /**
             * Ideal length for links (springs in physical model).
             */
            springLength: 100,

            /**
             * Hook's law coefficient. 1 - solid spring.
             */
            springCoeff: 0.0008,

            /**
             * Coulomb's law coefficient. It's used to repel nodes thus should be negative
             * if you make it positive nodes start attract each other :).
             */
            gravity: -1.2,

            /**
             * Theta coefficient from Barnes Hut simulation. Ranged between (0, 1).
             * The closer it's to 1 the more nodes algorithm will have to go through.
             * Setting it to one makes Barnes Hut simulation no different from
             * brute-force forces calculation (each node is considered).
             */
            theta: 0.8,

            /**
             * Drag force coefficient. Used to slow down system, thus should be less than 1.
             * The closer it is to 0 the less tight system will be.
             */
            dragCoeff: 0.02,

            /**
             * Default time step (dt) for forces integration
             */
            timeStep: 20,
            iterations: 10000,
            fit: true,

            /**
             * Maximum movement of the system which can be considered as stabilized
             */
            stableThreshold: 0.000009
        },
        iterations: 10000,
        refreshInterval: 16, // in ms
        refreshIterations: 10, // iterations until thread sends an update
        stableThreshold: 2,
        animate: true,
        fit: true
    };

    var extend = Object.assign || function (tgt) {
        for (var i = 1; i < arguments.length; i++) {
            var obj = arguments[i];

            for (var k in obj) {
                tgt[k] = obj[k];
            }
        }
        return tgt;
    };

    function Layout(options) {
        this.options = extend({}, defaults, options);
        this.layoutOptions = extend({}, defaults, options);
        delete this.layoutOptions.cy;
        delete this.layoutOptions.eles;
    }

    Layout.prototype.l = Nlayout;
    Layout.prototype.g = Graph;

    Layout.prototype.run = function () {
        var layout = this;
        layout.trigger({ type: 'layoutstart', layout: layout });
        var options = this.options;
        var layoutOptions = this.layoutOptions;
        var that = this;
        var graph = that.g();
        var cy = options.cy;
        var eles = options.eles;
        var nodes = eles.nodes();
        var parents = nodes.parents();

        // FILTER

        nodes = nodes.difference(parents);

        nodes = nodes.filterFn(function (ele) {
            return ele.connectedEdges().length > 0
        });

        var edges = eles.edges();
        var edgesHash = {};
        var L;


        var firstUpdate = true;

        /*        if (eles.length > 3000) {
         options.iterations = options.iterations - Math.abs(options.iterations / 3); // reduce iterations for big graph
         }*/

        var update = function (nodesJson) {
            /* cy.batch(function () {
             nodesJson.forEach(function(e,k){
             nodes.$('#'+ e.data.id).position(e.position);
             })

             });*/
            nodes.positions(function (i, node) {
                if (typeof i != 'number') {
                    node = i;
                }
                if (!node.data('dragging'))
                    return L.getNodePosition(node.id())
            });

            // if (layoutOptions.async) {
            //     setTimeout(function () {
            //         layout.trigger({ type: 'layoutstop', layout: layout });
            //         layout.trigger({ type: 'layoutready', layout: layout });
            //     }, 500);
            // }

            /* nodes.forEach(function (node) {
             L.getNodePosition(node.id())
             });*/

            // maybe we fit each iteration
            if (layoutOptions.fit) {
                cy.fit(layoutOptions.padding);
            }

            if (firstUpdate) {
                // indicate the initial positions have been set
                layout.trigger('layoutready');
                firstUpdate = false;
            }

        };

        graph.on('changed', function (e) {
            //  console.dir(e);
        });

        _.each(nodes, function (e, k) {
            e.on('tapstart', function (e) {
                e.target.data('dragging', true)
            });
            e.on('tapend', function (e) {
                e.target.removeData('dragging');
            });
            e.on('position', 'node[dragging]', function (e) {
                if (L.setNodePosition && e.target.data('dragging')) {
                    L.setNodePosition(e.target.data().id);
                }
            });
            graph.addNode(e.data().id);
        });

        _.each(edges, function (e, k) {
            if (!edgesHash[e.data().source + ':' + e.data().target] && !edgesHash[e.data().target + ':' + e.data().source]) {
                edgesHash[e.data().source + ':' + e.data().target] = e;
                graph.addLink(e.data().source, e.data().target);
            }
        });

        L = that.l(graph, layoutOptions);

        _.each(nodes, function (e, k) {
            var data = e.data();
            //var pos = e.position();
            if (data.pin) {
                L.pinNode(data.id, true);
                e.removeData('pin');
                e.data('unpin', true);
            } else if (data.unpin) {
                L.pinNode(data.id, false);
                e.removeData('unpin');
            }
            //if (pos.x && pos.y) {
            //  L.setNodePosition(data.id, pos);
            //}
        });

        var left = layoutOptions.iterations;
        if (layoutOptions.async && layoutOptions.async.maxIterations) {
            left = (layoutOptions.async.maxIterations / layoutOptions.async.stepsPerCycle).toFixed(0);
        }

        this.on('layoutstop', function () {
            layoutOptions.iterations = 0;
        });

        L.on('stable', function () {
            console.log('got Stable event');
            left = 0;
        });

        if (!layoutOptions.async) {
            layoutOptions.refreshInterval = 0;
        }
        var updateTimeout;
        L.on('cycle', function (i, stop) {
            if (layoutOptions.animate) {
                update();
            }
            if (stop) {
                update();
                layout.trigger({ type: 'layoutstop', layout: layout });
                layout.trigger({ type: 'layoutready', layout: layout });
                return;
            }
            step(stop);
        });

        // if (layoutOptions.async) {
        //     return this;
        // }

        var step = function (stop) {
            if (left != 0 || !stop  /*condition for stopping layout*/) {
                if (!updateTimeout || left == 0) {
                    //   updateTimeout = setTimeout(function () {
                    left--;
                    //update();
                    updateTimeout = null;
                    var stop = L.step();
                    stop ? left = 0 : false;
                    if (!left) {
                        step();
                    }
                    //   }, layoutOptions.refreshInterval);
                }
            } else {
                update();
                layout.trigger({ type: 'layoutstop', layout: layout });
                layout.trigger({ type: 'layoutready', layout: layout });
            }
        };
        step();
        return this;
    };

    Layout.prototype.stop = function () {
        // TODO: thread actions
        // continuous/asynchronous layout may want to set a flag etc to let
        // run() know to stop


        if (this.thread) {
            this.thread.stop();
        }

        this.trigger('layoutstop');

        return this; // chaining
    };

    Layout.prototype.destroy = function () {
        // clean up here if you create threads etc
        // TODO: thread actions

        if (this.thread) {
            this.thread.stop();
        }

        return this; // chaining
    };

    return Layout;

};

module.exports = function get(cytoscape) {
    return ngraph(cytoscape);
};
