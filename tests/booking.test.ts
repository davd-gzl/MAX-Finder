import { describe, it, expect } from "vitest";
import { generateBookingUrl } from "../src/util/booking";

describe("generateBookingUrl", () => {
  it("builds an SNCF Connect search deep link with date + time", () => {
    const url = generateBookingUrl("Paris", "Lyon", "2026-06-29", "17:00");
    const input = new URL(url).searchParams.get("userInput");
    expect(url.startsWith("https://www.sncf-connect.com/home/search?")).toBe(true);
    expect(input).toBe("Paris Lyon 29/06/2026 17h00"); // DD/MM/YYYY + HHhMM
  });

  it("omits the time when none is given", () => {
    const input = new URL(generateBookingUrl("Paris", "Lyon", "2026-06-29")).searchParams.get("userInput");
    expect(input).toBe("Paris Lyon 29/06/2026");
  });

  it("url-encodes accented station names", () => {
    const url = generateBookingUrl("Besançon Viotte", "Marne-la-Vallée", "2026-07-01", "08:06");
    expect(url).toContain("Besan%C3%A7on");
    expect(decodeURIComponent(new URL(url).searchParams.get("userInput")!)).toBe(
      "Besançon Viotte Marne-la-Vallée 01/07/2026 08h06",
    );
  });
});
