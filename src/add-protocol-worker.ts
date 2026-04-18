import { LocalDemManager } from "./local-dem-manager";
import { decodeOptions, getOptionsForZoom, parseUrl } from "./utils";
import type { DemManagerRequiredInitializationParameters } from "./types";

(self as any).worker.actor.registerMessageHandler(
  "contour-worker" as any,
  async (
    mapId: string | number,
    params: DemManagerRequiredInitializationParameters,
  ) => {
    const localDemManager = new LocalDemManager({
      demUrlPattern: params.demUrlPattern,
      cacheSize: params.cacheSize ?? 100,
      timeoutMs: params.timeoutMs ?? 10_000,
      encoding: params.encoding,
      maxzoom: params.maxzoom,
      getTile: async (url: string, abortController: AbortController) => {
        const request = {
          url,
          type: "arrayBuffer",
        };
        const { data } = await (self as any).makeRequest(
          request,
          abortController,
        );
        return {
          data: new Blob([data]),
        };
      },
    });

    (self as any).addProtocol(
      "dem-contour",
      async (request: any, abortController: AbortController) => {
        const [z, x, y] = parseUrl(request.url);
        const options = decodeOptions(request.url);
        const data = await localDemManager.fetchContourTile(
          z,
          x,
          y,
          getOptionsForZoom(options, z),
          abortController,
        );
        return { data: data.arrayBuffer };
      },
    );
  },
);

(self as any).worker.actor.sendAsync({
  type: "contour-worker" as any,
  data: "Finished init",
});
