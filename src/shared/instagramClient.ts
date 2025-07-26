// InstagramClient: Handles posting to Instagram (single image and carousel)
// Usage: import and use in postContent.ts

export class InstagramClient {
  private accessToken: string;
  private businessId: string;
  private context: any;

  constructor(accessToken: string, businessId: string, context: any) {
    this.accessToken = accessToken;
    this.businessId = businessId;
    this.context = context;
  }

  async postImage(imageUrl: string, comment: string, hashtags: string[]): Promise<{ success: boolean; message: string }> {
    this.context.log('[InstagramClient] Starting single image post', { imageUrl, comment, hashtags });
    try {
      // 1. Create media object
      this.context.log('[InstagramClient] Creating media object', { imageUrl });
      const createMediaRes = await fetch(`https://graph.facebook.com/v19.0/${this.businessId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          caption: [comment, ...(hashtags || [])].join(' '),
          access_token: this.accessToken,
        }),
      });
      const createMediaData = await createMediaRes.json();
      if (!createMediaRes.ok || !createMediaData.id) {
        this.context.error('[InstagramClient] Failed to create Instagram media object', createMediaData);
        return { success: false, message: 'Failed to create Instagram media object.' };
      }
      this.context.log('[InstagramClient] Media object created', createMediaData);
      // 2. Publish media object
      this.context.log('[InstagramClient] Publishing media object', { creation_id: createMediaData.id });
      const publishRes = await fetch(`https://graph.facebook.com/v19.0/${this.businessId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: createMediaData.id,
          access_token: this.accessToken,
        }),
      });
      const publishData = await publishRes.json();
      if (!publishRes.ok || !publishData.id) {
        this.context.error('[InstagramClient] Failed to publish Instagram post', publishData);
        return { success: false, message: 'Failed to publish Instagram post.' };
      }
      this.context.log('[InstagramClient] Instagram post published', publishData);
      return { success: true, message: 'Posted single image to Instagram.' };
    } catch (err) {
      this.context.error('[InstagramClient] Instagram post error', err);
      return { success: false, message: 'Instagram post error.' };
    }
  }

  async postCarousel(imageUrls: string[], comment: string, hashtags: string[]): Promise<{ success: boolean; message: string }> {
    this.context.log('[InstagramClient] Starting carousel post', { imageUrls, comment, hashtags });
    try {
      // 1. Create media objects for each image
      const children: string[] = [];
      for (const [idx, imageUrl] of imageUrls.entries()) {
        this.context.log(`[InstagramClient] Creating carousel media object [${idx}]`, { imageUrl });
        const res = await fetch(`https://graph.facebook.com/v19.0/${this.businessId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: imageUrl,
            is_carousel_item: true,
            access_token: this.accessToken,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.id) {
          this.context.error(`[InstagramClient] Failed to create carousel media object [${idx}]`, data);
          return { success: false, message: `Failed to create carousel media object for image ${idx + 1}.` };
        }
        children.push(data.id);
      }
      this.context.log('[InstagramClient] Carousel media objects created', children);
      // 2. Create carousel container
      this.context.log('[InstagramClient] Creating carousel container', { children });
      const createCarouselRes = await fetch(`https://graph.facebook.com/v19.0/${this.businessId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          children,
          caption: [comment, ...(hashtags || [])].join(' '),
          access_token: this.accessToken,
        }),
      });
      const createCarouselData = await createCarouselRes.json();
      if (!createCarouselRes.ok || !createCarouselData.id) {
        this.context.error('[InstagramClient] Failed to create carousel container', createCarouselData);
        return { success: false, message: 'Failed to create carousel container.' };
      }
      // 3. Publish carousel
      this.context.log('[InstagramClient] Publishing carousel', { creation_id: createCarouselData.id });
      const publishRes = await fetch(`https://graph.facebook.com/v19.0/${this.businessId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: createCarouselData.id,
          access_token: this.accessToken,
        }),
      });
      const publishData = await publishRes.json();
      if (!publishRes.ok || !publishData.id) {
        this.context.error('[InstagramClient] Failed to publish Instagram carousel', publishData);
        return { success: false, message: 'Failed to publish Instagram carousel.' };
      }
      this.context.log('[InstagramClient] Instagram carousel published', publishData);
      return { success: true, message: 'Posted carousel to Instagram.' };
    } catch (err) {
      this.context.error('[InstagramClient] Instagram carousel post error', err);
      return { success: false, message: 'Instagram carousel post error.' };
    }
  }
}
