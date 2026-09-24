/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV === 'development';
const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDevelopment ? ' ws: http: https:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "manifest-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    ...(isDevelopment ? [] : ['upgrade-insecure-requests']),
].join('; ');

const browserSecurityHeaders = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'Origin-Agent-Cluster', value: '?1' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    ...(process.env.SECURITY_HSTS_ENABLED === 'true'
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
        : []),
];

const nextConfig = {
    serverExternalPackages: ['playwright', '@prisma/client', 'nodemailer', 'libxml2-wasm'],
    outputFileTracingIncludes: {
        '/api/*': ['./resources/fiscal/xsd/1.01/*.xsd', './resources/fiscal/xsd/manifest.json', './node_modules/libxml2-wasm/lib/*'],
    },
    poweredByHeader: false,
    async headers() {
        return [
            {
                source: '/:path*',
                headers: browserSecurityHeaders
            },
            {
                source: '/admin/:path*',
                headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }]
            },
            {
                source: '/cliente/:path*',
                headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }]
            },
            {
                source: '/configuracoes/:path*',
                headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }]
            },
            {
                source: '/seguranca/:path*',
                headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }]
            },
            {
                source: '/privacidade/:path*',
                headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }]
            },
            {
                source: '/emitir/:path*',
                headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }]
            },
            {
                source: '/relatorios/:path*',
                headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }]
            },
            {
                source: '/contador/:path*',
                headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }]
            },
            {
                source: '/aceite-legal/:path*',
                headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }]
            }
        ];
    }
};

export default nextConfig;
