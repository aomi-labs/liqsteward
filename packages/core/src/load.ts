import fixtureJson from "./data/usd0pp-2025.json" with { type: "json" };
import { incidentFixtureSchema } from "./types.js";

export function usd0ppFixture() {
  return incidentFixtureSchema.parse(fixtureJson);
}
