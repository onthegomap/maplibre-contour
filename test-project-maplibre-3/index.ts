import mlcontour from "maplibre-contour";
import maplibregl from "maplibre-gl";

const demSource = new mlcontour.DemSource({
  url: "https://acalcutt.github.io/maplibre-contour-pmtiles/pmtiles/terrain-tiles.pmtiles",
  encoding: "mapbox",
  maxzoom: 12,
});

// calls maplibregl.addProtocol for the shared cache and contour protocols
demSource.setupMaplibre(maplibregl);

const map = new maplibregl.Map({
  container: "map",
  zoom: 11.55,
  center: [11.39085, 47.27574],
  hash: true,
  style: {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      dem: {
        type: "raster-dem",
        encoding: "mapbox",
        tiles: [demSource.sharedDemProtocolUrl], // share cached DEM tiles with contour layer
        maxzoom: 12,
        tileSize: 256,
      },
      contours: {
        type: "vector",
        tiles: [
          demSource.contourProtocolUrl({
            // meters to feet
            multiplier: 3.28084,
            thresholds: {
              // zoom: [minor, major]
              11: [200, 1000],
              12: [100, 500],
              13: [100, 500],
              14: [50, 200],
              15: [20, 100],
            },
            elevationKey: "ele",
            levelKey: "level",
            contourLayer: "contours",
          }),
        ],
        maxzoom: 16,
      },
    },
    layers: [
      {
        id: "hills",
        type: "hillshade",
        source: "dem",
        paint: {
          "hillshade-exaggeration": 0.25,
        },
      },
      {
        id: "contours",
        type: "line",
        source: "contours",
        "source-layer": "contours",
        paint: {
          "line-color": "rgba(0,0,0, 50%)",
          "line-width": ["match", ["get", "level"], 1, 1, 0.5],
        },
        layout: {
          "line-join": "round",
        },
      },
      {
        id: "contour-text",
        type: "symbol",
        source: "contours",
        "source-layer": "contours",
        filter: [">", ["get", "level"], 0],
        paint: {
          "text-halo-color": "white",
          "text-halo-width": 1,
        },
        layout: {
          "symbol-placement": "line",
          "text-anchor": "center",
          "text-size": 10,
          "text-field": ["concat", ["number-format", ["get", "ele"], {}], "'"],
          "text-font": ["Noto Sans Bold"],
        },
      },
    ],
  },
});

console.log(map);
