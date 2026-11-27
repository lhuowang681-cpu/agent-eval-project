const registeredScheduleIds = new Set<string>();

export interface RegisterQstashPlatformScheduleOptions {
  cron: string;
  /** When set to `1`, skip registration. */
  disableEnvVar?: string;
  scheduleId: string;
  /** App-relative path, e.g. `/api/workflows/task/schedule-dispatch`. */
  targetPath: string;
}

/**
 * Idempotently register a platform cron via @ctrip/qstash `POST /v1/schedules`.
 * Used at server boot (instrumentation) for builtin jobs — same role as lobehub's
 * Upstash Schedule API calls in `startServer.js` / ops-configured crons.
 */
export async function registerQstashPlatformSchedule(
  options: RegisterQstashPlatformScheduleOptions,
): Promise<void> {
  const { scheduleId, cron, targetPath, disableEnvVar } = options;

  if (registeredScheduleIds.has(scheduleId)) return;
  registeredScheduleIds.add(scheduleId);

  if (disableEnvVar && process.env[disableEnvVar] === '1') {
    console.info(`[bootstrap] QStash schedule "${scheduleId}" disabled (${disableEnvVar}=1).`);
    return;
  }

  if (process.env.VERCEL_ENV) {
    return;
  }

  const token = process.env.ZXQSTASH_TOKEN;
  if (!token) {
    console.warn(`[bootstrap] ZXQSTASH_TOKEN not set — skipping schedule "${scheduleId}".`);
    return;
  }

  const qstashBaseUrl = (process.env.ZXQSTASH_SERVER_URL || '').replace(/\/$/, '');
  if (!qstashBaseUrl) {
    console.warn(`[bootstrap] ZXQSTASH_SERVER_URL not set — skipping schedule "${scheduleId}".`);
    return;
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.warn(`[bootstrap] APP_URL not set — skipping schedule "${scheduleId}".`);
    return;
  }

  // This registration only runs in the internal self-hosted deployment (see the
  // `VERCEL_ENV` early return above) — the callback is a server-to-server hop
  // inside the internal network, and zxqstash's delivery consumer fails TLS
  // verification against our HTTPS ingress there, so force plain http.
  const targetUrl = `${appUrl
    .replace(/\/$/, '')
    .replace(/^https:/, 'http:')}${targetPath.startsWith('/') ? targetPath : `/${targetPath}`}`;

  const scheduleHeaders = {
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
      'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    }),
  };

  try {
    const res = await fetch(`${qstashBaseUrl}/v1/schedules`, {
      body: JSON.stringify({
        body: {},
        cron,
        scheduleId,
        url: targetUrl,
        ...(Object.keys(scheduleHeaders).length > 0 && { headers: scheduleHeaders }),
      }),
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (res.ok) {
      console.info(`[bootstrap] QStash schedule "${scheduleId}" registered (${cron}).`);
      return;
    }

    if (res.status === 409) {
      console.info(`[bootstrap] QStash schedule "${scheduleId}" already exists.`);
      return;
    }

    const text = await res.text();
    console.error(
      `[bootstrap] Failed to register schedule "${scheduleId}". Status ${res.status}: ${text}`,
    );
  } catch (err) {
    console.error(`[bootstrap] Error registering schedule "${scheduleId}":`, err);
  }
}
