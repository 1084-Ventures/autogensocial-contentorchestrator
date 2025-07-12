// postContent.ts
// Function to post an image to Instagram using the post document info
// This is a stub for actual Instagram API integration (e.g., via Facebook Graph API)
// You will need to provide access tokens and permissions for real posting


interface PostDocument {
  imageUrl: string;
  comment: string;
  hashtags?: string[];
  // ...other fields as needed
}

interface BrandDocument {
  socialAccounts?: {
    instagram?: {
      enabled?: boolean;
      username?: string; // Instagram Business Account ID
      accessToken?: string; // Instagram access token
    }
    // ...other social accounts
  };
  // ...other fields as needed
}

/**
 * Posts content to Instagram as an image post using the Facebook Graph API.
 * @param post The post document containing imageUrl, comment, and hashtags.
 * @param brand The brand document containing Instagram API credentials.
 * @returns Promise<{ success: boolean; message: string; }>
 */
export async function postContentToInstagram(
  post: PostDocument,
  brand: BrandDocument
): Promise<{ success: boolean; message: string; }>
{
  const hashtagsString = post.hashtags && post.hashtags.length > 0
    ? post.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')
    : '';
  const caption = hashtagsString
    ? `${post.comment}\n\n${hashtagsString}`
    : post.comment;

  // Step 1: Upload the image to Instagram (create media object)
  // Step 2: Publish the media object
  // Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing/
  const igAccount = brand.socialAccounts?.instagram;
  const accessToken = igAccount?.accessToken;
  const igUserId = igAccount?.username; // business account id
  if (!accessToken || !igUserId) {
    return { success: false, message: 'Missing Instagram API credentials in brand document.' };
  }

  try {
    // 1. Create media object (image upload)
    const createMediaRes = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: post.imageUrl,
          caption,
          access_token: accessToken,
        })
      }
    );
    const createMediaData = await createMediaRes.json();
    if (!createMediaRes.ok || !createMediaData.id) {
      return { success: false, message: `Failed to create media: ${JSON.stringify(createMediaData)}` };
    }
    const creationId = createMediaData.id;

    // 2. Publish the media object
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: accessToken,
        })
      }
    );
    const publishData = await publishRes.json();
    if (!publishRes.ok || !publishData.id) {
      return { success: false, message: `Failed to publish media: ${JSON.stringify(publishData)}` };
    }

    return {
      success: true,
      message: `Successfully posted to Instagram. Media ID: ${publishData.id}`
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Instagram API error: ${err.message || err}`
    };
  }
}
