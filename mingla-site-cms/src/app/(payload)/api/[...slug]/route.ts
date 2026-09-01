import config from "@payload-config";
import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from "@payloadcms/next/routes";
// A 40 MP source produces one sanitized master plus five renditions. Keep the
// operation below Vercel's default ceiling while leaving measured pilot-scale
// headroom for cold starts and private-object-store verification.
export const maxDuration = 240;
export const GET = REST_GET(config); export const POST = REST_POST(config); export const DELETE = REST_DELETE(config); export const PATCH = REST_PATCH(config); export const PUT = REST_PUT(config); export const OPTIONS = REST_OPTIONS(config);
