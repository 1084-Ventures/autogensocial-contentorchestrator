import type { components } from "../../generated/models";
import { callAzureOpenAI } from "../shared/azureOpenAIClient";
import { AppConfigurationClient } from "@azure/app-configuration";

type PromptTemplate = components["schemas"]["PromptTemplate"];

/**
 * Generates content using Azure OpenAI based on the provided prompt template.
 * - Randomizes variables if present and replaces them in the user prompt.
 * - Calls Azure OpenAI and returns the parsed JSON response.
 * @param promptTemplate The prompt template object
 * @returns The parsed JSON object from the OpenAI response
 */
export async function generateContentFromPromptTemplate(
  promptTemplate: PromptTemplate,
  promptConfig: Record<string, any>
): Promise<any> {

  if (!promptTemplate || !promptTemplate.userPrompt) {
    throw new Error("Prompt template and userPrompt are required.");
  }
  if (!promptConfig) {
    throw new Error("promptConfig must be provided by orchestrateContent.");
  }

  let systemPrompt: string | undefined = promptConfig["SystemPrompt"];
  let temperature: number = promptConfig["Temperature"] ? Number(promptConfig["Temperature"]) : 0.7;
  let maxTokens: number = promptConfig["MaxTokens"] ? Number(promptConfig["MaxTokens"]) : 100;
  let model: string = promptConfig["Model"] || "gpt-4.1";

  // Always replace {numImages} in systemPrompt if present
  let numImages: number | undefined = undefined;
  if (typeof promptConfig["numImages"] === "number") {
    numImages = promptConfig["numImages"];
  } else if (
    promptTemplate &&
    (promptTemplate as any).contentItem &&
    (promptTemplate as any).contentItem.imagesTemplate &&
    typeof (promptTemplate as any).contentItem.imagesTemplate.numImages === "number"
  ) {
    numImages = (promptTemplate as any).contentItem.imagesTemplate.numImages;
  } else if (
    promptTemplate && typeof (promptTemplate as any).numImages === "number"
  ) {
    numImages = (promptTemplate as any).numImages;
  }
  if (systemPrompt && systemPrompt.includes("{numImages}")) {
    if (typeof numImages === "number") {
      systemPrompt = systemPrompt.replace(/\{numImages\}/g, String(numImages));
    } else {
      systemPrompt = systemPrompt.replace(/\{numImages\}/g, "1");
    }
  }
  // ...existing code to call Azure OpenAI and return result...

  // Log prompt and config for debugging
  console.log("[generateContent] systemPrompt:", systemPrompt);
  console.log("[generateContent] userPrompt:", promptTemplate.userPrompt);
  console.log("[generateContent] temperature:", temperature);
  console.log("[generateContent] maxTokens:", maxTokens);
  console.log("[generateContent] model:", model);

  // Prepare variables and randomize if needed
  let userPrompt = promptTemplate.userPrompt;
  if (promptTemplate.variables && Array.isArray(promptTemplate.variables)) {
    for (const variable of promptTemplate.variables) {
      if (variable?.name && Array.isArray(variable.values) && variable.values.length > 0) {
        // Randomly select a value
        const randomValue = variable.values[Math.floor(Math.random() * variable.values.length)];
        userPrompt = userPrompt.replace(new RegExp(`{${variable.name}}`, 'g'), randomValue);
      }
    }
  }

  // Build the payload for Azure OpenAI
  const payload = {
    messages: [
      systemPrompt ? { role: "system", content: systemPrompt } : undefined,
      { role: "user", content: userPrompt }
    ].filter(Boolean),
    temperature,
    max_tokens: maxTokens,
    model: model
  };
  console.log("[generateContent] Payload to OpenAI:", JSON.stringify(payload, null, 2));

  try {
    const response = await callAzureOpenAI(payload);
    // Expecting the response in choices[0].message.content
    const content = response?.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content returned from OpenAI.");
    // Parse the JSON response (should be strict JSON)
    return JSON.parse(content);
  } catch (err) {
    // Add logging or error handling as needed
    throw new Error(`Failed to generate content: ${err instanceof Error ? err.message : String(err)}`);
  }
}
