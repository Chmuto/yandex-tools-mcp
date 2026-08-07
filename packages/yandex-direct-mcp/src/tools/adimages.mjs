import { z } from 'zod';
import { listResult, writeResult } from '../format.mjs';

const IMAGE_FIELDS = ['AdImageHash', 'Name', 'Type', 'Subtype', 'Associated', 'OriginalUrl', 'PreviewUrl'];

export function registerAdImageTools(server, client) {
  server.registerTool(
    'upload-ad-image',
    {
      title: 'Upload Ad Image',
      description:
        'WRITE — uploads an image into the account image library and returns an AdImageHash for use in create-text-ad. ' +
        'Provide exactly one of image_base64 or image_url. Affects the SANDBOX account unless YANDEX_DIRECT_LIVE=1. ' +
        'Only REGULAR and WIDE type images can be attached to text ads.',
      inputSchema: {
        name: z.string().max(255).describe('Label for the image in the account library (does not need to be unique)'),
        image_base64: z
          .string()
          .optional()
          .describe('Raw image bytes, base64-encoded. Mutually exclusive with image_url.'),
        image_url: z.string().optional().describe('URL to fetch the image from. Mutually exclusive with image_base64.'),
        type: z
          .enum(['REGULAR', 'WIDE', 'FIXED_IMAGE', 'AUTO'])
          .optional()
          .describe('Image type; AUTO (default) lets Direct detect it from dimensions'),
      },
    },
    async ({ name, image_base64, image_url, type }) => {
      if (!image_base64 && !image_url) {
        throw new Error('Provide either image_base64 or image_url.');
      }
      if (image_base64 && image_url) {
        throw new Error('Provide only one of image_base64 or image_url, not both.');
      }

      let imageData = image_base64;
      if (image_url) {
        const response = await fetch(image_url);
        if (!response.ok) {
          throw new Error(`Failed to fetch image_url (${response.status}): ${image_url}`);
        }
        imageData = Buffer.from(await response.arrayBuffer()).toString('base64');
      }

      const result = await client.directRequest('adimages', 'add', {
        AdImages: [{ Name: name, ImageData: imageData, ...(type ? { Type: type } : {}) }],
      });
      return writeResult('Upload ad image', result);
    },
  );

  server.registerTool(
    'list-ad-images',
    {
      title: 'List Ad Images',
      description:
        'READ. Lists images already uploaded to the account image library, with their hash and attachment status.',
      inputSchema: {
        associated: z
          .enum(['YES', 'NO'])
          .optional()
          .describe('Filter to images already attached to an ad (YES) or unattached (NO)'),
        hashes: z.array(z.string()).optional().describe('Filter to specific AdImageHash values'),
        limit: z.number().min(1).max(10000).optional().describe('Max images to return (default 100)'),
      },
    },
    async ({ associated, hashes, limit = 100 }) => {
      const SelectionCriteria = {};
      if (associated) SelectionCriteria.Associated = associated;
      if (hashes?.length) SelectionCriteria.AdImageHashes = hashes;
      const result = await client.directRequest('adimages', 'get', {
        SelectionCriteria,
        FieldNames: IMAGE_FIELDS,
        Page: { Limit: limit },
      });
      const lines = (result.AdImages || []).map(
        (img) =>
          `- ${img.AdImageHash} — "${img.Name}", ${img.Type}${img.Subtype && img.Subtype !== 'NONE' ? ` (${img.Subtype})` : ''}, associated: ${img.Associated}`,
      );
      return listResult('image', lines, result);
    },
  );
}
