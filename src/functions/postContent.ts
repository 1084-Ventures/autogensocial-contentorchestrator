// Main entry point for posting content to all social platforms
export async function postContent(postDoc: any, brandDoc: any, context: any): Promise<{ success: boolean; message: string }> {
  const socialAccounts = postDoc.socialAccounts || [];
  let result: { success: boolean; message: string } = { success: false, message: 'No social accounts specified.' };
  for (const account of socialAccounts) {
    if (account === 'instagram') {
      result = await postContentToInstagram(postDoc, brandDoc, context);
    }
    // Add more platforms here as needed
  }
  return result;
}

// Instagram dispatcher: decides between post and carousel
export async function postContentToInstagram(postDoc: any, brandDoc: any, context: any): Promise<{ success: boolean; message: string }> {
  const imageUrls = postDoc.imageUrls || [];
  const comment = postDoc.contentResponse?.comment || '';
  const hashtags = postDoc.contentResponse?.hashtags || [];
  if (imageUrls.length === 1) {
    return await postInstagramPost({ imageUrl: imageUrls[0], comment, hashtags }, brandDoc, context);
  } else if (imageUrls.length > 1) {
    return await postInstagramCarousel({ imageUrls, comment, hashtags }, brandDoc, context);
  } else {
    return { success: false, message: 'No images to post to Instagram.' };
  }
}

// Single-image Instagram post
export async function postInstagramPost(
  { imageUrl, comment, hashtags }: { imageUrl: string; comment: string; hashtags: string[] },
  brandDoc: any,
  context: any
): Promise<{ success: boolean; message: string }> {
  // Instagram Graph API endpoint for media publishing
  // See: https://developers.facebook.com/docs/instagram-api/guides/content-publishing/
  const accessToken = brandDoc?.instagramAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN;
  const instagramBusinessId = brandDoc?.instagramBusinessId || process.env.INSTAGRAM_BUSINESS_ID;
  if (!accessToken || !instagramBusinessId) {
    context.error('Missing Instagram access token or business account ID.');
    return { success: false, message: 'Missing Instagram credentials.' };
  }
  try {
    // 1. Create media object (image)
    const createMediaRes = await fetch(`https://graph.facebook.com/v19.0/${instagramBusinessId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: [comment, ...(hashtags || [])].join(' '),
        access_token: accessToken,
      }),
    });
    const createMediaData = await createMediaRes.json();
    if (!createMediaRes.ok || !createMediaData.id) {
      context.error('Failed to create Instagram media object', createMediaData);
      return { success: false, message: 'Failed to create Instagram media object.' };
    }
    context.log('Instagram media object created', createMediaData);
    // 2. Publish media object
    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${instagramBusinessId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: createMediaData.id,
        access_token: accessToken,
      }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok || !publishData.id) {
      context.error('Failed to publish Instagram post', publishData);
      return { success: false, message: 'Failed to publish Instagram post.' };
    }
    context.log('Instagram post published', publishData);
    return { success: true, message: 'Posted single image to Instagram.' };
  } catch (err) {
    context.error('Instagram post error', err);
    return { success: false, message: 'Instagram post error.' };
  }
}

// Multi-image Instagram carousel
export async function postInstagramCarousel(
  { imageUrls, comment, hashtags }: { imageUrls: string[]; comment: string; hashtags: string[] },
  brandDoc: any,
  context: any
): Promise<{ success: boolean; message: string }> {
  // Instagram Graph API endpoint for carousel publishing
  // See: https://developers.facebook.com/docs/instagram-api/guides/content-publishing/#carousel
  const accessToken = brandDoc?.instagramAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN;
  const instagramBusinessId = brandDoc?.instagramBusinessId || process.env.INSTAGRAM_BUSINESS_ID;
  if (!accessToken || !instagramBusinessId) {
    context.error('Missing Instagram access token or business account ID.');
    return { success: false, message: 'Missing Instagram credentials.' };
  }
  try {
    // 1. Create media objects for each image (is_carousel_item: true)
    const children = [];
    for (const imageUrl of imageUrls) {
      const res = await fetch(`https://graph.facebook.com/v19.0/${instagramBusinessId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          is_carousel_item: true,
          access_token: accessToken,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.id) {
        context.error('Failed to create carousel media object', data);
        return { success: false, message: 'Failed to create carousel media object.' };
      }
      children.push(data.id);
    }
    context.log('Carousel media objects created', children);
    // 2. Create carousel container
    const createCarouselRes = await fetch(`https://graph.facebook.com/v19.0/${instagramBusinessId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'CAROUSEL',
        children,
        caption: [comment, ...(hashtags || [])].join(' '),
        access_token: accessToken,
      }),
    });
    const createCarouselData = await createCarouselRes.json();
    if (!createCarouselRes.ok || !createCarouselData.id) {
      context.error('Failed to create carousel container', createCarouselData);
      return { success: false, message: 'Failed to create carousel container.' };
    }
    // 3. Publish carousel
    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${instagramBusinessId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: createCarouselData.id,
        access_token: accessToken,
      }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok || !publishData.id) {
      context.error('Failed to publish Instagram carousel', publishData);
      return { success: false, message: 'Failed to publish Instagram carousel.' };
    }
    context.log('Instagram carousel published', publishData);
    return { success: true, message: 'Posted carousel to Instagram.' };
  } catch (err) {
    context.error('Instagram carousel post error', err);
    return { success: false, message: 'Instagram carousel post error.' };
  }
}
// postContent.ts
// Function to post an image to Instagram using the post document info
// This is a stub for actual Instagram API integration (e.g., via Facebook Graph API)
// You will need to provide access tokens and permissions for real posting


