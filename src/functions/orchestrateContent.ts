
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { cosmosClient } from "./shared/cosmosClient";
import { generateContentFromPromptTemplate } from "./generateContent";
import { generateImage } from "./generateImage";
import { BlobServiceClient } from "@azure/storage-blob";
import { postContentToInstagram } from "./postContent";
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


    // 1. Look up the template first
    const postId = uuidv4();
    const postsContainer = cosmosClient.database(databaseId).container(postsContainerId);
    context.log("Looking for template", { templateId, brandId, databaseId, templateContainerId });
    const templateContainer = cosmosClient.database(databaseId).container(templateContainerId);
    const { resource } = await templateContainer.item(templateId, brandId).read<ContentGenerationTemplateDocument>();

    if (!resource) {
      return {
        status: 404,
        jsonBody: { message: "ContentGenerationTemplateDocument not found." }
      };
    }

    // Now create the post document with socialAccounts from template
    const socialAccounts = resource.templateInfo?.socialAccounts || [];
    const postDoc = {
      id: postId,
      brandId,
      templateId,
      socialAccounts,
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

    // Call generateContentFromPromptTemplate if promptTemplate exists
    const promptTemplate = resource.templateSettings?.promptTemplate;
    if (!promptTemplate) {
      return {
        status: 400,
        jsonBody: { message: "No promptTemplate found in template document." }
      };
    }

    let generatedContent;
    let imageUrls: string[] = [];
    let postResult: { success: boolean; message: string } | undefined = undefined;
    let brandDoc: any = undefined;
    try {
      generatedContent = await generateContentFromPromptTemplate(promptTemplate);

      // Multi-image support: generate and upload each image
      const contentItem = resource.templateSettings?.contentItem;
      if (contentItem?.contentType === 'images' && Array.isArray(generatedContent?.images)) {
        // Query brands container for brand document to get userId
        const brandsContainerId = process.env["COSMOS_DB_CONTAINER_BRAND"] || "brands";
        const brandsContainer = cosmosClient.database(databaseId).container(brandsContainerId);
        const querySpec = {
          query: "SELECT * FROM c WHERE c.id = @brandId",
          parameters: [{ name: "@brandId", value: brandId }]
        };
        const { resources: brandDocs } = await brandsContainer.items.query(querySpec).fetchAll();
        brandDoc = brandDocs[0];
        const userId = brandDoc?.userId || 'unknownUser';

        const blobConnectionString = process.env.PUBLIC_BLOB_CONNECTION_STRING;
        if (!blobConnectionString) throw new Error('Missing PUBLIC_BLOB_CONNECTION_STRING');
        const blobServiceClient = BlobServiceClient.fromConnectionString(blobConnectionString);
        const containerName = 'images';
        const containerClient = blobServiceClient.getContainerClient(containerName);
        await containerClient.createIfNotExists();

        const imageTemplates = contentItem.imagesTemplate?.imageTemplates || [];
        const maxImages = Math.min(generatedContent.images.length, imageTemplates.length, 20);
        for (let i = 0; i < maxImages; i++) {
          const quote = generatedContent.images[i]?.quote;
          const imageTemplate = imageTemplates[i] || imageTemplates[0];
          if (!quote || !imageTemplate) {
            context.log('Skipping image with missing quote or imageTemplate', { index: i });
            continue;
          }
          context.log('Generating image', { index: i, quote, imageTemplate });
          const imageBuffer = await generateImage({ imageTemplate, quote });
          const blobName = `${userId}/${brandId}/${postId}/${postId}-${i + 1}.png`;
          const blockBlobClient = containerClient.getBlockBlobClient(blobName);
          await blockBlobClient.uploadData(imageBuffer, {
            blobHTTPHeaders: { blobContentType: 'image/png' }
          });
          imageUrls.push(blockBlobClient.url);
          context.log('Uploaded image to blob storage', { index: i, blobUrl: blockBlobClient.url });
        }
      }

      // Post to Instagram if images exist and brandDoc is available (supports both single and multi-image)
      if (imageUrls.length > 0 && brandDoc) {
        // Extract Instagram credentials from brandDoc.socialAccounts.instagram
        let instagramAccessToken, instagramBusinessId;
        if (brandDoc.socialAccounts && brandDoc.socialAccounts.instagram) {
          instagramAccessToken = brandDoc.socialAccounts.instagram.accessToken;
          instagramBusinessId = brandDoc.socialAccounts.instagram.username; // username is actually the IG user ID
        }
        // Compose brandDocForInstagram with credentials for postContent
        const brandDocForInstagram = {
          ...brandDoc,
          instagramAccessToken,
          instagramBusinessId,
        };
        // Compose postDoc for Instagram posting (matches postContentToInstagram signature)
        const postForInstagram = {
          ...postDoc,
          imageUrls,
          contentResponse: generatedContent,
        };
        // Pass context as third argument
        postResult = await postContentToInstagram(postForInstagram, brandDocForInstagram, context);
      }

      // Update post document with contentResponse, imageUrls, status, and posting result
      await postsContainer.item(postId, brandId).replace({
        ...postDoc,
        contentResponse: generatedContent,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        status: postResult?.success ? "posted" : (imageUrls.length > 0 ? "generated" : "posting"),
        postResult,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      context.error("Error generating content:", err);
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
        status: imageUrls.length === 1 ? (postResult?.success ? "posted" : "posting") : (imageUrls.length > 0 ? "generated" : undefined),
        contentResponse: generatedContent,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        postResult
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
  methods: ["POST"],
  authLevel: "function",
  handler: orchestrateContent
});