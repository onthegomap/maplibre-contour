import generateIsolines from "./isolines";
import { DemSource } from "./dem-source";
import { decodeParsedImage } from "./decode-image";
import { LocalDemManager } from "./local-dem-manager";
import CONFIG from "./config";
import { HeightTile } from "./height-tile";
import {
  findPressureCentersInTiles,
  mercatorPixelToLngLat,
} from "./pressure-centers";

const exported = {
  generateIsolines,
  DemSource,
  HeightTile,
  LocalDemManager,
  decodeParsedImage,
  findPressureCentersInTiles,
  mercatorPixelToLngLat,
  set workerUrl(url: string) {
    CONFIG.workerUrl = url;
  },
  get workerUrl() {
    return CONFIG.workerUrl;
  },
};
export default exported;
