import { app, initDatabase } from "../server";

let dbReady: Promise<void> | null = null;

export default async function handler(req: any, res: any) {
  if (!dbReady) {
    dbReady = initDatabase();
  }
  await dbReady;
  return app(req, res);
}
