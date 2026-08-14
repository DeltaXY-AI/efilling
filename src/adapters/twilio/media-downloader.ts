/**
 * Downloads a Twilio-hosted media file (#31 Part D). Twilio's `MediaUrl`
 * values are not public — they require the same Account SID/Auth Token used
 * to authenticate the REST API, sent as HTTP Basic Auth. This is the only
 * place in this codebase that reads from a Twilio `MediaUrl`; everywhere
 * else, media is either rejected (enrolment/complainant workflows) or
 * ignored.
 */
export interface DownloadedMedia {
  buffer: Buffer;
  contentType: string;
}

export interface TwilioMediaDownloader {
  download(mediaUrl: string): Promise<DownloadedMedia>;
}

export function createTwilioMediaDownloader(accountSid: string, authToken: string): TwilioMediaDownloader {
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

  return {
    async download(mediaUrl: string): Promise<DownloadedMedia> {
      const response = await fetch(mediaUrl, { headers: { Authorization: authHeader } });
      if (!response.ok) {
        throw new Error(`Twilio media download failed with HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const arrayBuffer = await response.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer), contentType };
    },
  };
}
