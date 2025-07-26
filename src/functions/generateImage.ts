import { createCanvas, loadImage, CanvasRenderingContext2D, Image } from 'canvas';
import { downloadBlobToBuffer } from '../shared/blobClient';
import { components } from '../../generated/models';
import { findRelevantMedia } from '../shared/findRelevantMedia';

type ImageTemplate = components["schemas"]["ImageTemplate"];
type VisualStyle = components["schemas"]["VisualStyle"];
type TextStyle = components["schemas"]["TextStyle"];
type AspectRatio = components["schemas"]["AspectRatio"];

interface GenerateImageOptions {
  imageTemplate: ImageTemplate;
  quote: string;
  blobConnectionString?: string; // Optional, but required for blob download
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
  let size = textStyle?.font?.size || '48px';
  if (typeof size === 'number') size = `${size}px`;
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
 * Generates an image with a text overlay based on a single imageTemplate and quote.
 * Returns a PNG buffer.
 */
// Accept blobConnectionString as an option
export async function generateImage({ imageTemplate, quote, blobConnectionString }: GenerateImageOptions): Promise<Buffer> {
  // Log setUrl value
  console.log('[generateImage] setUrl:', imageTemplate?.setUrl);
  if (!imageTemplate?.setUrl) {
    console.log('[generateImage] setUrl is missing or empty');
  }

  // Debug: log received imageTemplate and quote
  // Use console.log for visibility in most environments
  console.log('[generateImage] Received imageTemplate:', JSON.stringify(imageTemplate, null, 2));
  console.log('[generateImage] Received quote:', quote);

  const { aspectRatio, mediaType, setUrl, visualStyleObj, description: templateDescription, brandDescription } = imageTemplate as any;
  console.log('[generateImage] aspectRatio:', aspectRatio, 'mediaType:', mediaType, 'setUrl:', setUrl);
  console.log('[generateImage] visualStyleObj:', JSON.stringify(visualStyleObj, null, 2));

  const { width, height } = getDimensions(aspectRatio);
  console.log('[generateImage] Calculated dimensions:', { width, height });
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Randomly select a theme (VisualStyle) from visualStyleObj.themes
  let selectedTheme = undefined;
  if (visualStyleObj?.themes && Array.isArray(visualStyleObj.themes) && visualStyleObj.themes.length > 0) {
    const idx = Math.floor(Math.random() * visualStyleObj.themes.length);
    selectedTheme = visualStyleObj.themes[idx];
    console.log('[generateImage] Selected theme:', JSON.stringify(selectedTheme, null, 2));
  } else {
    console.log('[generateImage] No valid themes found in visualStyleObj');
  }

  // Find media URL if needed
  let resolvedUrl = setUrl;
  if ((mediaType === 'uploaded' && !setUrl) || mediaType === 'online') {
    resolvedUrl = await findRelevantMedia({
      mediaType,
      quote,
      templateDescription,
      brandDescription
    });
    console.log('[generateImage] Resolved media URL:', resolvedUrl);
  }

  // Draw background
  if ((mediaType === 'uploaded' || mediaType === 'set') && resolvedUrl) {
    try {
      let img: Image;
      // Try to parse resolvedUrl as Azure Blob Storage URL: https://<account>.blob.core.windows.net/<container>/<blob>
      const azureBlobUrlPattern = /^https:\/\/([^.]+)\.blob\.core\.windows\.net\/([^\/]+)\/(.+)$/;
      const match = resolvedUrl.match(azureBlobUrlPattern);
      if (match) {
        const containerName = match[2];
        const blobName = decodeURIComponent(match[3]);
        if (!blobConnectionString) {
          throw new Error('blobConnectionString is required to download from Azure Blob Storage');
        }
        console.log(`[generateImage] Attempting to download blob: container=${containerName}, blob=${blobName}`);
        try {
          const buffer = await downloadBlobToBuffer(blobConnectionString, containerName, blobName);
          console.log(`[generateImage] Blob downloaded, buffer length: ${buffer.length}`);
          img = await loadImage(buffer);
          console.log('[generateImage] Image loaded from buffer');
        } catch (blobErr) {
          console.error('[generateImage] Error downloading or loading blob:', blobErr);
          throw blobErr;
        }
      } else {
        // fallback to public URL
        console.log(`[generateImage] Attempting to load image from public URL: ${resolvedUrl}`);
        try {
          img = await loadImage(resolvedUrl);
          console.log('[generateImage] Image loaded from public URL');
        } catch (urlErr) {
          console.error('[generateImage] Error loading image from public URL:', urlErr);
          throw urlErr;
        }
      }
      // Center-crop the image to fit the canvas without distortion
      const imgAspect = img.width / img.height;
      const canvasAspect = width / height;
      let sx = 0, sy = 0, sWidth = img.width, sHeight = img.height;
      if (imgAspect > canvasAspect) {
        // Image is wider than canvas: crop sides
        sWidth = img.height * canvasAspect;
        sx = (img.width - sWidth) / 2;
      } else if (imgAspect < canvasAspect) {
        // Image is taller than canvas: crop top/bottom
        sHeight = img.width / canvasAspect;
        sy = (img.height - sHeight) / 2;
      }
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, width, height);
      console.log('[generateImage] Drew uploaded image background');
    } catch (e) {
      console.error('[generateImage] Error drawing uploaded image background:', e);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    }
  } else if (mediaType === 'online' && resolvedUrl) {
    try {
      console.log(`[generateImage] Attempting to load online image: ${resolvedUrl}`);
      const img = await loadImage(resolvedUrl);
      console.log('[generateImage] Online image loaded');
      // Center-crop the image to fit the canvas without distortion
      const imgAspect = img.width / img.height;
      const canvasAspect = width / height;
      let sx = 0, sy = 0, sWidth = img.width, sHeight = img.height;
      if (imgAspect > canvasAspect) {
        sWidth = img.height * canvasAspect;
        sx = (img.width - sWidth) / 2;
      } else if (imgAspect < canvasAspect) {
        sHeight = img.width / canvasAspect;
        sy = (img.height - sHeight) / 2;
      }
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, width, height);
      console.log('[generateImage] Drew online image background');
    } catch (e) {
      console.error('[generateImage] Error drawing online image background:', e);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    }
  } else if (mediaType === 'color' && selectedTheme?.backgroundColor) {
    ctx.fillStyle = selectedTheme.backgroundColor;
    ctx.fillRect(0, 0, width, height);
    console.log('[generateImage] Drew color background:', selectedTheme.backgroundColor);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    console.log('[generateImage] Drew default black background');
  }

  // Overlay box (optional, now sized to text with margin and alignment)
  const overlay = selectedTheme?.overlayBox;
  const textStyle = selectedTheme?.textStyle;
  ctx.font = getFontString(textStyle);
  ctx.textAlign = textStyle?.alignment || 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 1.0;

  // Margins
  const marginX = width * 0.05;
  const marginY = height * 0.05;
  const maxTextWidth = width * 0.9;
  const lineHeight = parseInt((textStyle?.font?.size || '48').toString(), 10) * 1.2;

  // Calculate wrapped text lines
  const words = quote.split(' ');
  let lines: string[] = [];
  let line = '';
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxTextWidth && n > 0) {
      lines.push(line.trim());
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line.trim());

  // Find the widest line
  let textBoxWidth = 0;
  lines.forEach(l => {
    const w = ctx.measureText(l).width;
    if (w > textBoxWidth) textBoxWidth = w;
  });
  textBoxWidth = Math.min(textBoxWidth, maxTextWidth);
  const textBoxHeight = lines.length * lineHeight;

  // Calculate text block anchor (x) so the block is visually centered or aligned as a block
  let xBlock: number;
  let yStart: number;
  let blockAlign: CanvasTextAlign;
  if (overlay?.horizontalLocation === 'left') {
    xBlock = marginX;
    blockAlign = 'left';
  } else if (overlay?.horizontalLocation === 'right') {
    xBlock = width - marginX;
    blockAlign = 'right';
  } else {
    xBlock = width / 2;
    blockAlign = 'center';
  }

  // Vertical alignment for the block
  if (overlay?.verticalLocation === 'top') {
    yStart = marginY + lineHeight / 2;
  } else if (overlay?.verticalLocation === 'bottom') {
    yStart = height - marginY - textBoxHeight + lineHeight / 2;
  } else {
    yStart = height / 2 - textBoxHeight / 2 + lineHeight / 2;
  }

  // Draw overlay box sized to text
  if (overlay) {
    ctx.save();
    ctx.globalAlpha = overlay.transparency ?? 0.5;
    ctx.fillStyle = overlay.color || '#000';
    let overlayX = xBlock;
    if (blockAlign === 'left') {
      overlayX = xBlock;
    } else if (blockAlign === 'right') {
      overlayX = xBlock - textBoxWidth;
    } else {
      overlayX = xBlock - textBoxWidth / 2;
    }
    ctx.fillRect(
      overlayX - 16,
      yStart - lineHeight / 2 - 8,
      textBoxWidth + 32,
      textBoxHeight + 16
    );
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  // Text styling (reuse variables above)
  ctx.font = getFontString(textStyle);
  ctx.fillStyle = textStyle?.font?.color || '#fff';
  ctx.textAlign = blockAlign;
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = textStyle?.transparency ?? 1;

  // Outline (optional)
  if (textStyle?.outline) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = textStyle.outline.color || '#000';
    ctx.lineWidth = textStyle.outline.width || 2;
    // Draw each line with outline
    lines.forEach((l, i) => {
      ctx.strokeText(l, xBlock, yStart + i * lineHeight);
    });
    ctx.restore();
  }
  ctx.save();
  ctx.fillStyle = textStyle?.font?.color || '#fff';
  // Draw each line
  lines.forEach((l, i) => {
    ctx.fillText(l, xBlock, yStart + i * lineHeight);
  });
  ctx.restore();

  return canvas.toBuffer('image/png');
}
