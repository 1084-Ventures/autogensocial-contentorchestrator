import { app } from "@azure/functions";
import { orchestrateContent } from "./functions/orchestrateContent";

app.http("orchestrateContent", {
  methods: ["POST"],
  authLevel: "function",
  handler: orchestrateContent,
});
