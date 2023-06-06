import generateIsolines from "./isolines";
import { DemSource } from "./dem-source";
import CONFIG from "./config";
import { HeightTile } from "./height-tile";

const exported = {
  generateIsolines,
  DemSource,
  HeightTile,
  set workerUrl(url: string) {
    CONFIG.workerUrl = url;
  },
  get workerUrl() {
    return CONFIG.workerUrl;
  },
};
export default exported;
