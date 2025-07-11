
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { cosmosClient } from "./shared/cosmosClient";
import { generateContentFromPromptTemplate } from "./generateContent";
import { generateImage } from "./generateImage";
import { BlobServiceClient } from "@azure/storage-blob";
import type { components } from "../../generated/models";
type ContentOrchestratorRequest = components["schemas"]["ContentOrchestratorRequest"];
type ContentGenerationTemplateDocument = components["schemas"]["ContentGenerationTemplateDocument"];


import { v4 as uuidv4 } from "uuid";

const databaseId = process.env["COSMOS_DB_NAME"] || "cosmos-autogensocial-dev";
const templateContainerId = process.env["COSMOS_DB_CONTAINER_TEMPLATE"] || "templates";
const postsContainerId = process.env["COSMOS_DB_CONTAINER_POSTS"] || "posts";


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


    // 1. Create a new post document in the posts container
    const postId = uuidv4();
    const postsContainer = cosmosClient.database(databaseId).container(postsContainerId);
    const postDoc = {
      id: postId,
      brandId,
      templateId,
      status: "generating_content",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await postsContainer.items.create(postDoc);
      context.log("Created post document", { postId, brandId, templateId });
    } catch (err) {
      context.error("Failed to create post document", err);
      return {
        status: 500,
        jsonBody: { message: "Failed to create post document." }
      };
    }

    // 2. Look up the template
    context.log("Looking for template", { templateId, brandId, databaseId, templateContainerId });
    const templateContainer = cosmosClient.database(databaseId).container(templateContainerId);
    const { resource } = await templateContainer.item(templateId, brandId).read<ContentGenerationTemplateDocument>();

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
    let imageUrl;
    try {
      generatedContent = await generateContentFromPromptTemplate(promptTemplate);

      // If contentType is image, generate image and upload to blob storage
      const contentItem = resource.templateSettings?.contentItem;
      if (contentItem?.contentType === 'image' && generatedContent?.quote) {
        // Generate image buffer
        const imageBuffer = await generateImage({ contentItem, quote: generatedContent.quote });

        // Query brands container for brand document to get userId
        const brandsContainerId = process.env["COSMOS_DB_CONTAINER_BRAND"] || "brands";
        const brandsContainer = cosmosClient.database(databaseId).container(brandsContainerId);
        const querySpec = {
          query: "SELECT * FROM c WHERE c.id = @brandId",
          parameters: [{ name: "@brandId", value: brandId }]
        };
        const { resources: brandDocs } = await brandsContainer.items.query(querySpec).fetchAll();
        const brandDoc = brandDocs[0];
        const userId = brandDoc?.userId || 'unknownUser';

        const blobConnectionString = process.env.PUBLIC_BLOB_CONNECTION_STRING;
        if (!blobConnectionString) throw new Error('Missing PUBLIC_BLOB_CONNECTION_STRING');
        const blobServiceClient = BlobServiceClient.fromConnectionString(blobConnectionString);
        const containerName = 'images';
        const containerClient = blobServiceClient.getContainerClient(containerName);
        await containerClient.createIfNotExists();
        const blobName = `${userId}/${brandId}/${postId}.png`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.uploadData(imageBuffer, {
          blobHTTPHeaders: { blobContentType: 'image/png' }
        });
        imageUrl = blockBlobClient.url;
      }

      // Update post document with contentResponse, imageUrl (if any), and status
      await postsContainer.item(postId, brandId).replace({
        ...postDoc,
        contentResponse: generatedContent,
        imageUrl,
        status: "posting",
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      context.error("Error generating content:", err);
      // Update post document with error status
      await postsContainer.item(postId, brandId).replace({
        ...postDoc,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: new Date().toISOString(),
      });
      return {
        status: 500,
        jsonBody: { message: `Failed to generate content: ${err instanceof Error ? err.message : String(err)}` }
      };
    }

    return {
      status: 200,
      jsonBody: {
        postId,
        status: "posting",
        contentResponse: generatedContent,
        imageUrl
      }
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