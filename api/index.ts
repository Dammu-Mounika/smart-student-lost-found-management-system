import { app, initDatabase } from "../server";

let dbReady: Promise<void> | null = null;

export default async function handler(req: any, res: any) {
  if (!dbReady) {
    dbReady = initDatabase();
  }
  await dbReady;

  // Handle URL normalization in Vercel Serverless Functions
  const forwardedUrl = req.headers["x-forwarded-uri"] || req.headers["x-matched-path"];
  if (forwardedUrl && typeof forwardedUrl === "string") {
    req.url = forwardedUrl;
  } else if (req.url) {
    if (req.url.startsWith("/api/index")) {
      const sub = req.url.replace(/^\/api\/index/, "");
      req.url = `/api${sub.startsWith("/") ? sub : `/${sub}`}`;
    } else if (!req.url.startsWith("/api")) {
      req.url = `/api${req.url.startsWith("/") ? req.url : `/${req.url}`}`;
    }
  }

  // If Vercel already parsed the body as a JSON string, parse it to an object
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      // leave as is
    }
  }

  return app(req, res);
}
