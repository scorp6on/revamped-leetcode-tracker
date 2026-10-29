import { describe, expect, it } from "vitest";
import { fitWithin } from "./image";

describe("fitWithin", () => {
  it("shrinks so the longest side is 1600 px, keeping the shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 }); // landscape phone photo
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 }); // portrait
  });

  it("never enlarges a small image", () => {
    expect(fitWithin(800, 450)).toEqual({ width: 800, height: 450 });
    expect(fitWithin(1600, 900)).toEqual({ width: 1600, height: 900 });
  });
});
