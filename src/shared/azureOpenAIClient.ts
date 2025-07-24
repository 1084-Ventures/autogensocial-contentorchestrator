
const endpoint = process.env["AZURE_OPENAI_ENDPOINT"];
const apiKey = process.env["AZURE_OPENAI_KEY"];
const deploymentName = process.env["AZURE_OPENAI_DEPLOYMENT_NAME"] || "gpt-4-1";
const apiVersion = process.env["AZURE_OPENAI_API_VERSION"] || "2025-01-01-preview";

if (!endpoint) {
  throw new Error("AZURE_OPENAI_ENDPOINT environment variable is not set.");
}
if (!apiKey) {
  throw new Error("AZURE_OPENAI_KEY environment variable is not set.");
}

// Example: deploymentName = "gpt-35-turbo"
export async function callAzureOpenAI(payload: object) {
  const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
  console.log("[AzureOpenAI] Calling endpoint:", url);
  console.log("[AzureOpenAI] Payload:", JSON.stringify(payload, null, 2));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify(payload)
  });
  console.log("[AzureOpenAI] Response status:", response.status, response.statusText);
  const responseBody = await response.text();
  console.log("[AzureOpenAI] Response body:", responseBody);
  if (!response.ok) {
    throw new Error(`Azure OpenAI API error: ${response.status} ${response.statusText} - ${responseBody}`);
  }
  return JSON.parse(responseBody);
}

