import axios from 'axios';

/**
 * Finds the most relevant media URL based on the given parameters.
 * For 'uploaded' (no setUrl), queries Azure AI Search (stub).
 * For 'online', queries Bing Image Search API.
 * Returns the best matching image URL or undefined if not found.
 */
export async function findRelevantMedia({
  mediaType,
  quote,
  templateDescription,
  brandDescription
}: {
  mediaType: string;
  quote: string;
  templateDescription?: string;
  brandDescription?: string;
}): Promise<string | undefined> {
  if (mediaType === 'uploaded') {
    // TODO: Implement Azure AI Search query against CosmosDB media collection
    // For now, return undefined to indicate not found
    // Example: Use Azure Cognitive Search SDK to query with quote, templateDescription, brandDescription
    return undefined;
  }
  if (mediaType === 'online') {
    // Use Bing Image Search API (Azure Cognitive Services)
    const apiKey = process.env.BING_IMAGE_SEARCH_KEY;
    if (!apiKey) return undefined;
    const endpoint = process.env.BING_IMAGE_SEARCH_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/images/search';
    // Build query string
    let q = quote;
    if (templateDescription) q += ' ' + templateDescription;
    if (brandDescription) q += ' ' + brandDescription;
    try {
      const response = await axios.get(endpoint, {
        params: {
          q,
          imageType: 'Photo',
          license: 'Public',
          safeSearch: 'Strict',
          count: 1
        },
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey
        }
      });
      const images = response.data.value;
      if (images && images.length > 0) {
        return images[0].contentUrl;
      }
    } catch (e) {
      // Ignore errors, fallback to undefined
    }
    return undefined;
  }
  return undefined;
}
