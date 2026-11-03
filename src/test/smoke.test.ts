import { describe, it, expect } from "vitest";

describe("Vitest setup", () => {
  it("runs correctly with DOM environment", () => {
    expect(window).toBeDefined();
    expect(document).toBeDefined();
    const div = document.createElement("div");
    div.textContent = "ByteX Download Manager";
    expect(div.textContent).toBe("ByteX Download Manager");
  });
});
