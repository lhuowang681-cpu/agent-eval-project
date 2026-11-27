import { codeInspectorPlugin } from 'code-inspector-plugin';
import { type NextConfig } from 'next';
import { type Header, type Redirect } from 'next/dist/lib/load-custom-routes';

const openCodeInspector = process.env.OPEN_CODE_INSPECTOR === '1';

interface CustomNextConfig {
  experimental?: NextConfig['experimental'];
  headers?: Header[];
  outputFileTracingExcludes?: NextConfig['outputFileTracingExcludes'];
  outputFileTracingIncludes?: NextConfig['outputFileTracingIncludes'];
  redirects?: Redirect[];
  serverExternalPackages?: NextConfig['serverExternalPackages'];
  turbopack?: NextConfig['turbopack'];
}

function mergeOutputFileTracingExcludes(
  ...sources: Array<NextConfig['outputFileTracingExcludes'] | undefined>
): NextConfig['outputFileTracingExcludes'] | undefined {
  const merged: Record<string, string[]> = {};

  for (const source of sources) {
    if (!source) continue;

    for (const [route, patterns] of Object.entries(source)) {
      merged[route] = [...(merged[route] ?? []), ...patterns];
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function defineConfig(config: CustomNextConfig) {
  const isProd = process.env.NODE_ENV === 'production';
  const buildWithDocker = process.env.DOCKER === 'true';

  const shouldUseCSP = process.env.ENABLED_CSP === '1';

  const isTest =
    process.env.NODE_ENV === 'test' || process.env.TEST === '1' || process.env.E2E === '1';

  const isStandaloneMode = buildWithDocker || process.env.NEXT_BUILD_STANDALONE === '1';

  const standaloneConfig: NextConfig = {
    output: 'standalone',

    outputFileTracingIncludes: {
      '*': [
        'public/**/*',
        '.next/static/**/*',

        // Only needed for standalone builds.
        // On Vercel (serverless), including native bindings can easily exceed function size limits.
        ...(isStandaloneMode
          ? [
              // Exclude SPA/desktop/mobile build artifacts from serverless functions
              'public/spa/**',
              'dist/desktop/**',
              'dist/mobile/**',

              'packages/database/migrations/**',

              // Ensure native bindings are included in standalone output.
              // `@napi-rs/canvas` is loaded via dynamic `require()` (see packages/file-loaders),
              // which may not be picked up by Next.js output tracing.
              'node_modules/@napi-rs/canvas/**/*',
              'node_modules/@napi-rs/canvas-*/**/*',
              // pnpm real package locations (including platform-specific bindings with `.node`)
              'node_modules/.pnpm/@napi-rs+canvas*/**/*',
              'node_modules/.pnpm/@napi-rs+canvas-*/**/*',

              // `@ctrip/vampire-core` loads platform-specific native prebuilds at runtime,
              // which may not be picked up by Next.js output tracing.
              // NOTE: vampire-core 通过 CJS require 触达一整条 @ctrip/* 依赖链
              // (runtime-context / foundation-framework / log / log-provider /
              // vampire-common / vampire-request)，standalone 打包时如果只带
              // 上 vampire-core 主包，运行时 require 这些间接依赖会失败，
              // serverHook / catHook / bootstrap 都会挂，triplog 同链路失效。
              'node_modules/@ctrip/vampire-core/**/*',
              'node_modules/@ctrip/node-vampire-cache-prebuild*/**/*',
              'node_modules/@ctrip/node-vampire-locker-prebuild*/**/*',
              // pnpm real package locations for vampire native bindings
              'node_modules/.pnpm/@ctrip+vampire-core*/**/*',
              'node_modules/.pnpm/@ctrip+node-vampire-cache-prebuild*/**/*',
              'node_modules/.pnpm/@ctrip+node-vampire-locker-prebuild*/**/*',
              // vampire-core 的间接 @ctrip/* 依赖 (pnpm real paths)
              'node_modules/.pnpm/@ctrip+vampire-runtime-context*/**/*',
              'node_modules/.pnpm/@ctrip+foundation-framework*/**/*',
              'node_modules/.pnpm/@ctrip+vampire-request*/**/*',
              'node_modules/.pnpm/@ctrip+vampire-common*/**/*',
              'node_modules/.pnpm/@ctrip+log@*/**/*',
              'node_modules/.pnpm/@ctrip+log-provider*/**/*',
              // hoisted 副本 (以防 pnpm 结构变化 tracing 抓到的是这份)
              'node_modules/@ctrip/vampire-runtime-context/**/*',
              'node_modules/@ctrip/foundation-framework/**/*',
              'node_modules/@ctrip/vampire-request/**/*',
              'node_modules/@ctrip/vampire-common/**/*',
              'node_modules/@ctrip/log/**/*',
              'node_modules/@ctrip/log-provider/**/*',
            ]
          : []),
      ],
    },
  };

  const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;
  const mergedTracingExcludes = mergeOutputFileTracingExcludes(config.outputFileTracingExcludes);

  const nextConfig: NextConfig = {
    ...(isStandaloneMode ? standaloneConfig : {}),
    assetPrefix,

    compiler: {
      emotion: true,
    },
    compress: isProd,
    experimental: {
      optimizePackageImports: [
        'emoji-mart',
        '@emoji-mart/react',
        '@emoji-mart/data',
        '@icons-pack/react-simple-icons',
        '@lobehub/ui',
        '@lobehub/icons',
      ],
      // oidc provider depend on constructor.name
      // but swc minification will remove the name
      // so we need to disable it
      // refs: https://github.com/lobehub/lobe-chat/pull/7430
      serverMinification: false,
      webVitalsAttribution: ['CLS', 'LCP'],
      ...config.experimental,
    },
    async headers() {
      const securityHeaders = [
        {
          key: 'x-robots-tag',
          value: 'all',
        },
      ];

      if (shouldUseCSP) {
        securityHeaders.push(
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none';",
          },
        );
      }

      return [
        {
          headers: securityHeaders,
          source: '/:path*',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/icons/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/images/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/videos/(.*).(mp4|webm|ogg|avi|mov|wmv|flv|mkv)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/screenshots/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/og/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/favicon.ico',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/favicon-32x32.ico',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/apple-touch-icon.png',
        },
        // Passkey configuration files for iOS and Android
        {
          headers: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
            {
              key: 'Cache-Control',
              value: 'public, max-age=3600',
            },
          ],
          source: '/.well-known/apple-app-site-association',
        },
        {
          headers: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
            {
              key: 'Cache-Control',
              value: 'public, max-age=3600',
            },
          ],
          source: '/.well-known/assetlinks.json',
        },
        // Vite SPA build artifacts (hashed JS/CSS chunks in assets/, vendor/, i18n/)
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/spa/assets/(.*)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/spa/vendor/(.*)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/spa/i18n/(.*)',
        },
        ...(config.headers ?? []),
      ];
    },
    logging: {
      fetches: {
        fullUrl: true,
        hmrRefreshes: true,
      },
    },
    ...(mergedTracingExcludes && {
      outputFileTracingExcludes: mergedTracingExcludes,
    }),
    ...(config.outputFileTracingIncludes && {
      outputFileTracingIncludes: config.outputFileTracingIncludes,
    }),
    reactStrictMode: true,
    redirects: async () => [
      {
        destination: '/sitemap-index.xml',
        permanent: true,
        source: '/sitemap.xml',
      },
      {
        destination: '/sitemap-index.xml',
        permanent: true,
        source: '/sitemap-0.xml',
      },
      {
        destination: '/sitemap/plugins-1.xml',
        permanent: true,
        source: '/sitemap/plugins.xml',
      },
      {
        destination: '/sitemap/assistants-1.xml',
        permanent: true,
        source: '/sitemap/assistants.xml',
      },
      {
        destination: '/manifest.webmanifest',
        permanent: true,
        source: '/manifest.json',
      },
      {
        destination: '/community/agent',
        permanent: true,
        source: '/community/assistants',
      },
      {
        destination: '/community/plugin',
        permanent: true,
        source: '/community/plugins',
      },
      {
        destination: '/community/model',
        permanent: true,
        source: '/community/models',
      },
      {
        destination: '/community/provider',
        permanent: true,
        source: '/community/providers',
      },
      // Legacy redirects from /discover to /community
      {
        destination: '/community',
        permanent: true,
        source: '/discover',
      },
      {
        destination: '/community/:path*',
        permanent: true,
        source: '/discover/:path*',
      },
      // {
      //   destination: '/settings/common',
      //   permanent: true,
      //   source: '/settings',
      // },
      // we need back /repos url in the further
      {
        destination: '/files',
        permanent: false,
        source: '/repos',
      },
      {
        destination: '/',
        permanent: true,
        source: '/chat',
      },
      // Redirect old Clerk login route to Better Auth signin
      {
        destination: '/signin',
        permanent: true,
        source: '/login',
      },
      ...(config.redirects ?? []),
    ],
    // Vercel serves this via vercel.json's `rewrites`, which only applies on Vercel deployments.
    // Standalone/Docker deployments need the same rewrite defined here to work.
    async rewrites() {
      return [
        {
          destination: '/_dangerous_local_dev_proxy.html',
          source: '/_dangerous_local_dev_proxy',
        },
        {
          destination: '/_dangerous_local_dev_proxy.html',
          source: '/_dangerous_local_dev_proxy/:path*',
        },
      ];
    },
    // when external packages in dev mode with turbopack, this config will lead to bundle error
    // @napi-rs/canvas is a native module that can't be bundled by Turbopack
    // pdfjs-dist uses @napi-rs/canvas for DOMMatrix polyfill in Node.js environment
    serverExternalPackages: config.serverExternalPackages ?? [
      'pdfkit',
      '@napi-rs/canvas',
      '@ctrip/vampire-core',
      '@ctrip/qstash',
      '@ctrip/qworkflow',
      '@ctrip/qshared',
      'discord.js',
      'ffmpeg-static',
      'pdfjs-dist',
      'ajv',
      'oidc-provider',
    ],

    transpilePackages: ['mermaid', 'better-auth-harmony'],
    turbopack: {
      rules: {
        ...(isTest || !openCodeInspector
          ? void 0
          : codeInspectorPlugin({
              bundler: 'turbopack',
              hotKeys: ['altKey', 'ctrlKey'],
            })),
        // builtin-skills import `.md` files (e.g. SKILL.md) as raw strings;
        // Turbopack needs an explicit loader for markdown on the server bundle.
        '*.md': {
          as: '*.js',
          loaders: ['raw-loader'],
        },
      },
      ...config.turbopack,
    },

    typescript: {
      ignoreBuildErrors: true,
    },
  };

  return nextConfig;
}
