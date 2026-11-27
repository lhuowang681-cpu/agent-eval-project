/**
 * Upload sandbox file bytes to a pre-signed S3 PUT URL from the app server.
 * Avoids relying on curl inside the sandbox image.
 */
export async function uploadToPresignedUrl(
  body: Buffer,
  uploadUrl: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(uploadUrl, {
      body,
      method: 'PUT',
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const snippet = detail ? `: ${detail.slice(0, 300)}` : '';
      return {
        error: `S3 upload failed (HTTP ${response.status})${snippet}`,
        success: false,
      };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
