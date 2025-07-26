import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { cosmosClient } from "../shared/cosmosClient";
import { generateContentFromPromptTemplate } from "./generateContent";
import { generateImage } from "./generateImage";
import * as blobClient from "../shared/blobClient";
import { postContentToInstagram } from "./postContent";
import { AppConfigurationClient } from "@azure/app-configuration";
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
  context.log("orchestrateContent function started");
  let brandDoc: any = undefined;
  try {
    // Accept brandId and templateId from query or JSON body
    context.log("Parsing request for brandId and templateId");
    let brandId = request.query.get("brandId");
    let templateId = request.query.get("templateId");
    if (!brandId || !templateId) {
      const body = (await request.json().catch(() => ({}))) as Partial<ContentOrchestratorRequest>;
      brandId = brandId || body.brandId;
      templateId = templateId || body.templateId;
    }
    if (!brandId || !templateId) {
      context.log("WARN: Missing brandId or templateId", { brandId, templateId });
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
      context.log("WARN: ContentGenerationTemplateDocument not found", { templateId, brandId });
      return {
        status: 404,
        jsonBody: { message: "ContentGenerationTemplateDocument not found." }
      };
    }

    // Build SocialAccountEntry[] for postDoc: for each platform in templateInfo.socialAccounts, get credentials from brandDoc
    const templateSocialAccounts = resource.templateInfo?.socialAccounts || [];
    // Query brands container for brand document to get credentials
    const brandsContainerId = process.env["COSMOS_DB_CONTAINER_BRAND"] || "brands";
    const brandsContainer = cosmosClient.database(databaseId).container(brandsContainerId);
    const querySpec = {
      query: "SELECT * FROM c WHERE c.id = @brandId",
      parameters: [{ name: "@brandId", value: brandId }]
    };
    const { resources: brandDocs } = await brandsContainer.items.query(querySpec).fetchAll();
    // brandDoc is declared at the top of the function
    context.log("Brand document lookup result", { found: brandDocs.length > 0 });
    brandDoc = brandDocs[0];
    context.log("Full brandDoc:", brandDoc);
    context.log("Full template resource:", resource);
    // Compose SocialAccountEntry[] for postDoc, filter out entries without a valid platform, then filter out entries without credentials
    context.log("Template socialAccounts before mapping:", templateSocialAccounts);
    context.log("BrandDoc socialAccounts:", brandDoc?.socialAccounts);
    let socialAccounts = templateSocialAccounts
      .filter((platform: string) => !!platform)
      .map((platform: string) => {
        let account = {};
        let found = undefined;
        if (Array.isArray(brandDoc?.socialAccounts)) {
          found = brandDoc.socialAccounts.find((a: any) => a.platform === platform);
          if (found) account = found.account || {};
        }
        context.log("Mapping social account:", { platform, found, account });
        return { platform, account };
      })
      // Only keep entries with a non-empty account object (has at least one key)
      .filter((sa: any) => sa.account && Object.keys(sa.account).length > 0);
    context.log("Final mapped socialAccounts for posting:", socialAccounts);
    if (socialAccounts.length === 0) {
      context.warn("No social accounts mapped for posting. Check brandDoc and templateSocialAccounts structure and credentials.");
    }

    // Only use credentials from brandDoc; do not fallback to environment variables
    // If no valid Instagram credentials, log a warning
    const hasInstagram = socialAccounts.some(sa => {
      if (sa.platform !== 'instagram' || !sa.account) return false;
      const acc = sa.account as any;
      return acc.accessToken && (acc.platformAccountId || acc.username);
    });
    if (!hasInstagram) {
      context.log('No valid Instagram credentials found in brandDoc for this brand/template. Posting will be skipped for Instagram.');
    }

    const postDoc = {
      id: postId,
      brandId,
      templateId,
      socialAccounts,
      status: "generating_content",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    context.log("Full postDoc before posting:", postDoc);
    try {
      await postsContainer.items.create(postDoc);
      context.log("Created post document", { postId, brandId, templateId });
    } catch (err) {
      context.log("ERROR: Failed to create post document", err);
      return {
        status: 500,
        jsonBody: { message: "Failed to create post document." }
      };
    }

    // Call generateContentFromPromptTemplate if promptTemplate exists
    const promptTemplate = resource.templateSettings?.promptTemplate;
    if (!promptTemplate) {
      context.log("WARN: No promptTemplate found in template document", { templateId });
      return {
        status: 400,
        jsonBody: { message: "No promptTemplate found in template document." }
      };
    }

    let generatedContent;
    let imageUrls: string[] = [];
    let postResult: { success: boolean; message: string } | undefined = undefined;
    try {
      // Fetch mapped keys from Azure App Configuration based on content type
      const contentItem = resource.templateSettings?.contentItem;
      const contentType = contentItem?.contentType || "text";
      const appConfigConnectionString = process.env.AZURE_APP_CONFIG_CONNECTION_STRING;
      const appConfigClient = new AppConfigurationClient(appConfigConnectionString);
      async function getPromptConfig(contentType: string) {
        const keys = ["SystemPrompt", "MaxTokens", "Model", "Temperature"];
        const config: Record<string, any> = {};
        for (const key of keys) {
          const configKey = `PromptDefaults:${key}:${contentType}`;
          try {
            const setting = await appConfigClient.getConfigurationSetting({ key: configKey });
            config[key] = setting.value;
          } catch (err) {
            context.log(`Config key not found: ${configKey}`, err);
          }
        }
        return config;
      }

      context.log("Fetching prompt config", { contentType });
      const promptConfig = await getPromptConfig(contentType);
      context.log("Prompt config fetched", promptConfig);

      // Replace {numImages} in SystemPrompt with value from template if present
      let numImages: number | undefined = undefined;
      if (contentItem && contentItem.imagesTemplate && typeof contentItem.imagesTemplate.numImages === "number") {
        numImages = contentItem.imagesTemplate.numImages;
      }
      if (typeof promptConfig["SystemPrompt"] === "string" && promptConfig["SystemPrompt"].includes("{numImages}")) {
        if (typeof numImages === "number") {
          promptConfig["SystemPrompt"] = promptConfig["SystemPrompt"].replace(/\{numImages\}/g, String(numImages));
          context.log("SystemPrompt after {numImages} replacement:", promptConfig["SystemPrompt"]);
        } else {
          // fallback to 1 if not found
          promptConfig["SystemPrompt"] = promptConfig["SystemPrompt"].replace(/\{numImages\}/g, "1");
          context.log("SystemPrompt after {numImages} fallback replacement:", promptConfig["SystemPrompt"]);
        }
      }

      generatedContent = await generateContentFromPromptTemplate(promptTemplate, promptConfig);
      context.log("Generated content", generatedContent);

      // Multi-image support: generate and upload each image
      if (contentItem?.contentType === 'images' && Array.isArray(generatedContent?.images)) {
        const userId = brandDoc?.userId || 'unknownUser';
        const blobConnectionString = process.env.PUBLIC_BLOB_CONNECTION_STRING;
        if (!blobConnectionString) throw new Error('Missing PUBLIC_BLOB_CONNECTION_STRING');
        const containerName = 'images';
        // Ensure container exists
        const containerClient = blobClient.getContainerClient(blobConnectionString, containerName);
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
          // Log the contents of visualStyleObj.themes for debugging
          if (imageTemplate.visualStyleObj && Array.isArray(imageTemplate.visualStyleObj.themes)) {
            context.log('visualStyleObj.themes for image', { index: i, themes: imageTemplate.visualStyleObj.themes });
          } else {
            context.log('visualStyleObj.themes missing or not an array', { index: i, visualStyleObj: imageTemplate.visualStyleObj });
          }
          context.log('Generating image', { index: i, quote, imageTemplate });
          // Use AZURE_STORAGE_CONNECTION_STRING for blob download in generateImage
          const azureStorageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
          if (!azureStorageConnectionString) throw new Error('Missing AZURE_STORAGE_CONNECTION_STRING');
          const imageBuffer = await generateImage({ imageTemplate, quote, blobConnectionString: azureStorageConnectionString });
          const blobName = `${userId}/${brandId}/${postId}/${postId}-${i + 1}.png`;
          await blobClient.uploadBufferToBlob(blobConnectionString, containerName, blobName, imageBuffer, 'image/png');
          const blockBlobClient = blobClient.getBlockBlobClient(blobConnectionString, containerName, blobName);
          imageUrls.push(blockBlobClient.url);
          context.log('Uploaded image to blob storage', { index: i, blobUrl: blockBlobClient.url });
        }
      }

      // Post to all social platforms selected in the template, using credentials from brandDoc
      if (imageUrls.length > 0 && brandDoc) {
        context.log("Posting to social platforms", { imageUrlsCount: imageUrls.length });
        // Compose postDoc for posting (add imageUrls and contentResponse)
        const postForPlatforms = {
          ...postDoc,
          imageUrls,
          contentResponse: generatedContent,
        };
        // Pass through to postContent, which will dispatch by platform using SocialAccountEntry[]
        postResult = await import("./postContent").then(m => m.postContent(postForPlatforms, brandDoc, context));
      }

      // Update post document with contentResponse, imageUrls, status, and posting result
      context.log("Updating post document with results", { postId, brandId });
      await postsContainer.item(postId, brandId).replace({
        ...postDoc,
        contentResponse: generatedContent,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        status: postResult?.success ? "posted" : (imageUrls.length > 0 ? "generated" : "posting"),
        postResult,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      context.log("ERROR: Error generating content:", err);
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
    context.log("ERROR: Error in orchestrateContent:", err);
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