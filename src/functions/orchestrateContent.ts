
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { cosmosClient } from "./shared/cosmosClient";
import { generateContentFromPromptTemplate } from "./generateContent";
import type { components } from "../../generated/models";
type ContentOrchestratorRequest = components["schemas"]["ContentOrchestratorRequest"];
type ContentGenerationTemplateDocument = components["schemas"]["ContentGenerationTemplateDocument"];

const databaseId = process.env["COSMOS_DB_NAME"] || "cosmos-autogensocial-dev";
const containerId = process.env["COSMOS_DB_CONTAINER_TEMPLATE"] || "templates";


export async function orchestrateContent(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    // Accept brandId and templateId from query or JSON body
    let brandId = request.query.get("brandId");
    let templateId = request.query.get("templateId");
    if (!brandId || !templateId) {
      const body = (await request.json().catch(() => ({}))) as Partial<ContentOrchestratorRequest>;
      brandId = brandId || body.brandId;
      templateId = templateId || body.templateId;
    }
    if (!brandId || !templateId) {
      return {
        status: 400,
        jsonBody: { message: "brandId and templateId are required." }
      };
    }

    context.log("Looking for template", { templateId, brandId, databaseId, containerId });
    const container = cosmosClient.database(databaseId).container(containerId);
    const { resource } = await container.item(templateId, brandId).read<ContentGenerationTemplateDocument>();

    if (!resource) {
      return {
        status: 404,
        jsonBody: { message: "ContentGenerationTemplateDocument not found." }
      };
    }

    // Call generateContentFromPromptTemplate if promptTemplate exists
    const promptTemplate = resource.templateSettings?.promptTemplate;
    if (!promptTemplate) {
      return {
        status: 400,
        jsonBody: { message: "No promptTemplate found in template document." }
      };
    }

    let generatedContent;
    try {
      generatedContent = await generateContentFromPromptTemplate(promptTemplate);
    } catch (err) {
      context.error("Error generating content:", err);
      return {
        status: 500,
        jsonBody: { message: `Failed to generate content: ${err instanceof Error ? err.message : String(err)}` }
      };
    }

    return {
      status: 200,
      jsonBody: generatedContent
    };
  } catch (err: any) {
    context.error("Error in orchestrateContent:", err);
    return {
      status: 500,
      jsonBody: { message: "Internal server error." }
    };
  }
}


app.http("orchestrate-content", {
  methods: ["GET", "POST"],
  authLevel: "function",
  handler: orchestrateContent
});