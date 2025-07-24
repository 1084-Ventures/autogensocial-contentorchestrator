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
  promptConfig?: Record<string, any>
): Promise<any> {

  if (!promptTemplate || !promptTemplate.userPrompt) {
    throw new Error("Prompt template and userPrompt are required.");
  }

  // Use mapped config values if provided, otherwise fetch from Azure App Configuration
  let systemPrompt: string | undefined;
  let temperature: number = 0.7;
  let maxTokens: number = 100;
  let model: string = "gpt-4.1";

  if (promptConfig) {
    systemPrompt = promptConfig["SystemPrompt"] ?? undefined;
    temperature = promptConfig["Temperature"] ? Number(promptConfig["Temperature"]) : 0.7;
    maxTokens = promptConfig["MaxTokens"] ? Number(promptConfig["MaxTokens"]) : 100;
    model = promptConfig["Model"] || "gpt-4.1";
  } else {
    const appConfigConnectionString = process.env["AZURE_APP_CONFIG_CONNECTION_STRING"];
    const client = new AppConfigurationClient(appConfigConnectionString!);
    const [systemPromptSetting, temperatureSetting, maxTokensSetting, modelSetting] = await Promise.all([
      client.getConfigurationSetting({ key: "PromptDefaults:SystemPrompt" }),
      client.getConfigurationSetting({ key: "PromptDefaults:Temperature" }),
      client.getConfigurationSetting({ key: "PromptDefaults:MaxTokens" }),
      client.getConfigurationSetting({ key: "PromptDefaults:Model" }),
    ]);
    systemPrompt = systemPromptSetting.value;
    temperature = temperatureSetting.value ? Number(temperatureSetting.value) : 0.7;
    maxTokens = maxTokensSetting.value ? Number(maxTokensSetting.value) : 100;
    model = modelSetting.value || "gpt-4.1";
  }

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
