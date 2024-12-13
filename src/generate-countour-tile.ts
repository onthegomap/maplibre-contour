import { writeFileSync } from "fs";
import { LocalDemManager } from "./dem-manager";

let manager = new LocalDemManager(
    "https://example/{z}/{x}/{y}.png",
    100,
    "mapbox",
    12,
    10000
);

manager.fetchContourTile(12,2446,1655, {levels: [10]}, new AbortController()).then((tile) => {
    writeFileSync("12-2446-1655.mvt", Buffer.from(tile.arrayBuffer));
});
