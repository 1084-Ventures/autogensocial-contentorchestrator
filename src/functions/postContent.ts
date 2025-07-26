// Main entry point for posting content to all social platforms
// postDoc.socialAccounts is now an array of SocialAccountEntry { platform, account }
export async function postContent(postDoc: any, brandDoc: any, context: any): Promise<{ success: boolean; message: string }> {
  const socialAccounts: any[] = postDoc.socialAccounts || [];
  if (!Array.isArray(socialAccounts) || socialAccounts.length === 0) {
    context.log('[postContent] No social accounts specified.');
    return { success: false, message: 'No social accounts specified.' };
  }
  let lastResult: { success: boolean; message: string } = { success: false, message: 'No platforms posted.' };
  for (const [idx, entry] of socialAccounts.entries()) {
    const platform = entry.platform;
    const account = entry.account || {};
    if (!platform) {
      context.error(`[postContent] Missing platform in socialAccounts entry`, { index: idx, entry });
      lastResult = { success: false, message: `Missing platform in socialAccounts entry at index ${idx}.` };
      continue;
    }
    if (!account || Object.keys(account).length === 0) {
      context.error(`[postContent] Missing account details for platform: ${platform}`, { index: idx, entry });
      lastResult = { success: false, message: `Missing account details for platform: ${platform} at index ${idx}.` };
      continue;
    }
    context.log(`[postContent] Posting to platform: ${platform}`, { account });
    if (platform === 'instagram') {
      const accessToken = account.accessToken;
      const businessId = account.platformAccountId || account.username;
      if (!accessToken || !businessId) {
        context.error('[postContent] Missing Instagram credentials.', { accessToken, businessId });
        lastResult = { success: false, message: 'Missing Instagram credentials.' };
        continue;
      }
      // Always import InstagramClient from shared
      const { InstagramClient } = await import('../shared/instagramClient');
      const instagramClient = new InstagramClient(accessToken, businessId, context);
      lastResult = await postContentToInstagram(postDoc, instagramClient, context);
    }
    // Add more platforms here as needed
  }
  return lastResult;
}

// Instagram dispatcher: decides between post and carousel
export async function postContentToInstagram(postDoc: any, brandDoc: any, context: any): Promise<{ success: boolean; message: string }> {
  // brandDoc is now InstagramClient
  const imageUrls = postDoc.imageUrls || [];
  const videoUrl = postDoc.videoUrl || '';
  const comment = postDoc.contentResponse?.comment || '';
  const hashtags = postDoc.contentResponse?.hashtags || [];
  context.log('[postContentToInstagram] Dispatching Instagram post', { imageUrlsCount: imageUrls.length, hasVideo: !!videoUrl });

  if (videoUrl) {
    context.log('[postContentToInstagram] Video detected, posting as reel.');
    if (typeof brandDoc.postReel === 'function') {
      return await brandDoc.postReel(videoUrl, comment, hashtags);
    } else {
      context.error('[postContentToInstagram] InstagramClient missing postReel method.');
      return { success: false, message: 'InstagramClient missing postReel method.' };
    }
  } else if (imageUrls.length === 1) {
    context.log('[postContentToInstagram] Single image detected, posting as regular post.');
    return await brandDoc.postImage(imageUrls[0], comment, hashtags);
  } else if (imageUrls.length > 1) {
    context.log('[postContentToInstagram] Multiple images detected, posting as carousel.');
    return await brandDoc.postCarousel(imageUrls, comment, hashtags);
  } else {
    context.error('[postContentToInstagram] No images or video to post to Instagram.');
    return { success: false, message: 'No images or video to post to Instagram.' };
  }
}

// Single-image Instagram post
// ...existing code...


