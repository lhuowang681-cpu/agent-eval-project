import { defineConfig } from './src/libs/next/config/define-config';

const isVercel = !!process.env.VERCEL_ENV;
const isStandaloneBuild =
  process.env.NEXT_BUILD_STANDALONE === '1' || process.env.DOCKER === 'true';

const vercelConfig = {
  // Vercel serverless optimization: exclude musl binaries from all routes
  // Vercel uses Amazon Linux (glibc), not Alpine Linux (musl)
  // This saves ~45MB (29MB canvas-musl + 16MB sharp-musl) per serverless function
  outputFileTracingExcludes: {
    '*': [
      'node_modules/.pnpm/@napi-rs+canvas-*-musl*',
      'node_modules/.pnpm/@img+sharp-libvips-*musl*',
      // Exclude SPA/desktop/mobile build artifacts from serverless functions
      'public/spa/**',
      'dist/desktop/**',
      'dist/mobile/**',
      'apps/desktop/**',
      'packages/database/migrations/**',
    ],
  },
};

// Captain / Docker standalone: prevent Next from copying a broken partial
// @ctrip/vampire-schedule pnpm tree. The full runtime closure is materialized by
// scripts/materializeStandaloneInternalScheduler.mts after build.
const standaloneQScheduleTracingExcludes = {
  '*': [
    'node_modules/@ctrip/vampire-schedule/**',
    'node_modules/.pnpm/@ctrip+vampire-schedule@*/**',
    'node_modules/.pnpm/@ctrip+vampire-dubbo@*/**',
    'node_modules/.pnpm/@ctrip+vampire-process-worker@*/**',
    'node_modules/.pnpm/@ctrip+js-dubbo-service@*/**',
    'node_modules/.pnpm/apache-dubbo-common@*/**',
  ],
};

const nextConfig = defineConfig({
  ...(isVercel ? vercelConfig : {}),
  ...(isStandaloneBuild ? { outputFileTracingExcludes: standaloneQScheduleTracingExcludes } : {}),
});

export default nextConfig;
