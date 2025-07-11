
const endpoint = process.env["AZURE_OPENAI_ENDPOINT"];
const apiKey = process.env["AZURE_OPENAI_API_KEY"];

if (!endpoint) {
  throw new Error("AZURE_OPENAI_ENDPOINT environment variable is not set.");
}
if (!apiKey) {
  throw new Error("AZURE_OPENAI_API_KEY environment variable is not set.");
}

// Example: deploymentName = "gpt-35-turbo"
export async function callAzureOpenAI(deploymentName: string, payload: object, apiVersion = "2024-02-15-preview") {
  const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Azure OpenAI API error: ${response.status} ${response.statusText} - ${error}`);
  }
  return response.json();
}

