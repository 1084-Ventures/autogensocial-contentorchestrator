
// Requires: npm install canvas
import { createCanvas, loadImage, CanvasRenderingContext2D } from 'canvas';
import { components } from '../../generated/models';

type ContentItem = components["schemas"]["ContentItem"];
type VisualStyle = components["schemas"]["VisualStyle"];
type TextStyle = components["schemas"]["TextStyle"];
type AspectRatio = components["schemas"]["AspectRatio"];

interface GenerateImageOptions {
  contentItem: ContentItem;
  quote: string;
}

const ASPECT_RATIOS: Record<string, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1200, height: 628 },
  story: { width: 1080, height: 1920 },
};

function getDimensions(aspectRatio?: AspectRatio) {
  if (aspectRatio && ASPECT_RATIOS[aspectRatio]) {
    return ASPECT_RATIOS[aspectRatio];
  }
  return ASPECT_RATIOS.square;
}


function getFontString(textStyle?: TextStyle) {
  const size = textStyle?.font?.size || '48px';
  const weight = textStyle?.font?.weight || 'normal';
  const style = textStyle?.font?.style || 'normal';
  const family = textStyle?.font?.family || 'Arial';
  return `${style} ${weight} ${size} ${family}`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ');
  let line = '';
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + ' ';
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}

/**
 * Generates an image with a text overlay based on contentItem and quote.
 * Returns a PNG buffer.
 */
export async function generateImage({ contentItem, quote }: GenerateImageOptions): Promise<Buffer> {
  if (!contentItem || contentItem.contentType !== 'image' || !contentItem.imageTemplate) {
    throw new Error('Invalid contentItem for image generation');
  }

  const { aspectRatio, mediaType, setUrl, visualStyleObj } = contentItem.imageTemplate;
  const { width, height } = getDimensions(aspectRatio);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Draw background
  if (mediaType === 'online' && setUrl) {
    try {
      const img = await loadImage(setUrl);
      ctx.drawImage(img, 0, 0, width, height);
    } catch (e) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    }
  } else if (mediaType === 'color' && visualStyleObj?.themes?.[0]?.backgroundColor) {
    ctx.fillStyle = visualStyleObj.themes[0].backgroundColor;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
  }

  // Overlay box (optional)
  const overlay = visualStyleObj?.themes?.[0]?.overlayBox;
  if (overlay) {
    ctx.globalAlpha = overlay.transparency ?? 0.5;
    ctx.fillStyle = overlay.color || '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1.0;
  }

  // Text styling
  const textStyle = visualStyleObj?.themes?.[0]?.textStyle;
  ctx.font = getFontString(textStyle);
  ctx.fillStyle = textStyle?.font?.color || '#fff';
  ctx.textAlign = textStyle?.alignment || 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = textStyle?.transparency ?? 1;

  // Outline (optional)
  if (textStyle?.outline) {
    ctx.strokeStyle = textStyle.outline.color || '#000';
    ctx.lineWidth = textStyle.outline.width || 2;
  }

  // Calculate text position
  const maxTextWidth = width * 0.8;
  const lineHeight = parseInt((textStyle?.font?.size || '48').toString(), 10) * 1.2;
  let x = width / 2;
  let y = height / 2;
  if (overlay?.verticalLocation === 'top') y = height * 0.25;
  if (overlay?.verticalLocation === 'bottom') y = height * 0.75;

  // Draw text (with optional outline)
  if (textStyle?.outline) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = textStyle.outline.color || '#000';
    ctx.lineWidth = textStyle.outline.width || 2;
    wrapText(ctx, quote, x, y, maxTextWidth, lineHeight);
    ctx.restore();
  }
  ctx.save();
  ctx.fillStyle = textStyle?.font?.color || '#fff';
  wrapText(ctx, quote, x, y, maxTextWidth, lineHeight);
  ctx.restore();

  return canvas.toBuffer('image/png');
}
