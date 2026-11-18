import { getApp } from '../dist/server/server.js';
import '../dist/server/entry-server.js';

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
