
import type { components } from "../../generated/models";
import { callAzureOpenAI } from "./shared/azureOpenAIClient";

type PromptTemplate = components["schemas"]["PromptTemplate"];

/**
 * Generates content using Azure OpenAI based on the provided prompt template.
 * - Randomizes variables if present and replaces them in the user prompt.
 * - Calls Azure OpenAI and returns the parsed JSON response.
 * @param promptTemplate The prompt template object
 * @returns The parsed JSON object from the OpenAI response
 */
export async function generateContentFromPromptTemplate(promptTemplate: PromptTemplate): Promise<any> {
  if (!promptTemplate || !promptTemplate.userPrompt || !promptTemplate.model) {
    throw new Error("Prompt template, userPrompt, and model are required.");
  }

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
      promptTemplate.systemPrompt ? { role: "system", content: promptTemplate.systemPrompt } : undefined,
      { role: "user", content: userPrompt }
    ].filter(Boolean),
    temperature: promptTemplate.temperature ?? 0.7,
    max_tokens: promptTemplate.maxTokens ?? 100,
    // model is used as deploymentName in Azure OpenAI
  };

  try {
    const response = await callAzureOpenAI(promptTemplate.model!, payload);
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
