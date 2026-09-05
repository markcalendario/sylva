import { describe, expect, it } from "vitest";
import { VOCAB } from "./words";

describe("vocabulary", () => {
  it("has a word for every theme", () => {
    expect(Object.keys(VOCAB).sort()).toEqual(["forest", "professional"]);
  });

  it("keeps the forest's nouns out of a theme that has no forest", () => {
    const words = VOCAB.professional;
    const forestish = /dryad|forest|grove|clearing/i;
    for (const value of Object.values(words)) expect(value).not.toMatch(forestish);
  });

  it("still names the forest in the forest", () => {
    expect(VOCAB.forest.agent).toBe("dryad");
    expect(VOCAB.forest.workspace).toBe("Forest");
  });
});
