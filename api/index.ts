import type { IncomingMessage, ServerResponse } from 'node:http';
import { getApp } from '../server';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
