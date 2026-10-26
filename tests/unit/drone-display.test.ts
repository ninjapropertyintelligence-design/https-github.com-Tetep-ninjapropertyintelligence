import { describe, expect, it } from "vitest";
import { displayFilename, guessOutputType, isBrowserImage } from "@/lib/drone-display";

describe("drone exports", () => {
  it("files each DroneDeploy export as the layer it is", () => {
    expect(guessOutputType("Store 1052 Orthomosaic.tif")).toBe("ORTHOMOSAIC");
    expect(guessOutputType("store-1052_ortho.jpg")).toBe("ORTHOMOSAIC");
    expect(guessOutputType("Store 1052 Elevation.tif")).toBe("DSM");
    expect(guessOutputType("site_dsm.tif")).toBe("DSM");
    expect(guessOutputType("site_DTM.tif")).toBe("DTM");
    expect(guessOutputType("points.las")).toBe("POINT_CLOUD");
    expect(guessOutputType("cloud.xyz")).toBe("POINT_CLOUD");
    expect(guessOutputType("model.obj")).toBe("MESH_3D");
    expect(guessOutputType("Store 1052 3D Model.zip")).toBe("MESH_3D");
    // Not an elevation model just because the name starts with "dem".
    expect(guessOutputType("demo-ortho.tif")).toBe("ORTHOMOSAIC");
  });

  it("shows only what a browser can display, and names files the way the vendor did", () => {
    expect(isBrowserImage("org/abc-map.jpg")).toBe(true);
    expect(isBrowserImage("org/abc-map.tif")).toBe(false);
    expect(displayFilename("org1/0b4f6e7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b-Store_Ortho.tif")).toBe("Store_Ortho.tif");
  });
});
