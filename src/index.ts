import generateIsolines from "./isolines";
import { DemSource } from "./protocol";
import CONFIG from "./config";
const exported = {
  generateIsolines,
  DemSource,
  set workerUrl(url: string) {
    CONFIG.workerUrl = url;
  },
  get workerUrl() {
    return CONFIG.workerUrl;
  },
};
export default exported;
